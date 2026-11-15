// Node 24 native WebSocket is global
const ARI_BASE = 'http://127.0.0.1:8088';
const USER = 'callflow_qa';
const PASS = 'cfqa_ari_1f044860de198dfa6fd829c7a40f23cbe9ae09b6';
const AUTH = 'Basic ' + Buffer.from(`${USER}:${PASS}`).toString('base64');
const APP = 'callflow-qa';

async function ariRequest(path, method = 'GET', body = null) {
  const url = `${ARI_BASE}${path}`;
  const options = {
    method,
    headers: {
      Authorization: AUTH,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  };
  const res = await fetch(url, options);
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`ARI ${method} ${path} failed ${res.status}: ${txt}`);
  }
  if (res.status === 204) return null;
  return res.json().catch(() => null);
}

async function runSnoopTest() {
  console.log('--- 1. Connecting WebSocket to Asterisk ARI ---');
  const wsUrl = `ws://127.0.0.1:8088/ari/events?app=${encodeURIComponent(APP)}&api_key=${encodeURIComponent(USER)}:${encodeURIComponent(PASS)}`;
  const ws = new WebSocket(wsUrl);

  const events = [];
  ws.onmessage = (event) => {
    try {
      const evt = JSON.parse(event.data);
      events.push(evt);
      console.log(`[ARI EVENT] type=${evt.type} channelId=${evt.channel?.id} channelName=${evt.channel?.name} appArgs=${JSON.stringify(evt.args)}`);
    } catch {}
  };

  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  console.log('WebSocket connected successfully.');

  console.log('\n--- 2. Originating local channel into Stasis ---');
  // Originate a local channel into from-telnyx-buyer which executes Stasis(callflow-qa,buyer,...)
  const originateRes = await ariRequest('/ari/channels?endpoint=Local/test@from-telnyx-buyer&app=callflow-qa&appArgs=caller,test-run-10u', 'POST');
  console.log('Main channel originated:', originateRes.id, originateRes.name);
  const mainChannelId = originateRes.id;

  // Wait for main channel StasisStart
  console.log('Awaiting StasisStart for main channel...');
  let mainStasis = null;
  for (let i = 0; i < 30; i++) {
    mainStasis = events.find(e => e.type === 'StasisStart' && e.channel?.id === mainChannelId);
    if (mainStasis) break;
    await new Promise(r => setTimeout(r, 100));
  }
  console.log('Main channel StasisStart received:', !!mainStasis);

  console.log('\n--- 3. Testing Snoop Channel Creation ---');
  // Endpoint: POST /ari/channels/{channelId}/snoop
  const snoopPath = `/ari/channels/${encodeURIComponent(mainChannelId)}/snoop?app=${encodeURIComponent(APP)}&spy=in&whisper=none&appArgs=snoop,caller,test-run-10u`;
  const snoopRes = await ariRequest(snoopPath, 'POST');
  console.log('Snoop channel created:', snoopRes.id, snoopRes.name, snoopRes.state);
  const snoopChannelId = snoopRes.id;

  // Check if Asterisk emits StasisStart for the Snoop channel!
  console.log('Awaiting StasisStart for Snoop channel...');
  let snoopStasis = null;
  for (let i = 0; i < 30; i++) {
    snoopStasis = events.find(e => e.type === 'StasisStart' && e.channel?.id === snoopChannelId);
    if (snoopStasis) break;
    await new Promise(r => setTimeout(r, 100));
  }
  console.log('Snoop channel StasisStart received:', !!snoopStasis, 'args:', snoopStasis?.args);

  console.log('\n--- 4. Starting recording on Snoop channel ---');
  const recName = 'native-snoop-test-rec';
  const recRes = await ariRequest(`/ari/channels/${encodeURIComponent(snoopChannelId)}/record?name=${encodeURIComponent(recName)}&format=wav&maxDurationSeconds=10&maxSilenceSeconds=0`, 'POST');
  console.log('Snoop recording response:', recRes);

  let recStarted = null;
  for (let i = 0; i < 30; i++) {
    recStarted = events.find(e => e.type === 'RecordingStarted' && e.recording?.name === recName);
    if (recStarted) break;
    await new Promise(r => setTimeout(r, 100));
  }
  console.log('RecordingStarted event received:', !!recStarted, 'target_uri:', recStarted?.recording?.target_uri);

  console.log('\n--- 5. Triggering playMedia on Main Channel CONCURRENTLY ---');
  const playStart = Date.now();
  const playRes = await ariRequest(`/ari/channels/${encodeURIComponent(mainChannelId)}/play?media=sound:/var/lib/asterisk/sounds/qa/qa-caller-marker`, 'POST');
  console.log('PlayMedia response:', playRes);

  let playFinished = null;
  for (let i = 0; i < 50; i++) {
    playFinished = events.find(e => e.type === 'PlaybackFinished' && e.playback?.id === playRes?.id);
    if (playFinished) break;
    await new Promise(r => setTimeout(r, 100));
  }
  const playDuration = Date.now() - playStart;
  console.log('PlaybackFinished event received:', !!playFinished, `after ${playDuration}ms`);

  console.log('\n--- 6. Stopping Snoop recording & retrieving WAV ---');
  await ariRequest(`/ari/recordings/live/${encodeURIComponent(recName)}/stop`, 'POST');
  let recFinished = null;
  for (let i = 0; i < 30; i++) {
    recFinished = events.find(e => e.type === 'RecordingFinished' && e.recording?.name === recName);
    if (recFinished) break;
    await new Promise(r => setTimeout(r, 100));
  }
  console.log('RecordingFinished event received:', !!recFinished);

  // Retrieve stored recording file
  const wavUrl = `${ARI_BASE}/ari/recordings/stored/${encodeURIComponent(recName)}/file`;
  const wavRes = await fetch(wavUrl, { headers: { Authorization: AUTH } });
  const wavBuf = Buffer.from(await wavRes.arrayBuffer());
  console.log(`Downloaded WAV buffer: ${wavBuf.length} bytes`);
  if (wavBuf.length >= 44) {
    const magic = wavBuf.toString('ascii', 0, 4);
    const format = wavBuf.toString('ascii', 8, 12);
    console.log(`Header Magic: ${magic}/${format}`);
  }

  console.log('\n--- 7. Cleanup channels & recordings ---');
  await ariRequest(`/ari/channels/${encodeURIComponent(mainChannelId)}`, 'DELETE').catch(() => {});
  await ariRequest(`/ari/channels/${encodeURIComponent(snoopChannelId)}`, 'DELETE').catch(() => {});
  await ariRequest(`/ari/recordings/stored/${encodeURIComponent(recName)}`, 'DELETE').catch(() => {});

  ws.close();
  console.log('Test completed successfully!');
}

runSnoopTest().catch(err => {
  console.error('Snoop test error:', err);
  process.exit(1);
});
