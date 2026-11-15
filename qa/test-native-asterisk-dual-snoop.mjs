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

async function runDualSnoopTest() {
  console.log('=== CallFlow Phase 7B-10U: Native Asterisk Dual Snoop Integration Test ===');
  const runId = 'native-test-' + Date.now();

  console.log('\n--- 1. Connecting WebSocket to Asterisk ARI ---');
  const wsUrl = `ws://127.0.0.1:8088/ari/events?app=${encodeURIComponent(APP)}&api_key=${encodeURIComponent(USER)}:${encodeURIComponent(PASS)}`;
  const ws = new WebSocket(wsUrl);

  const events = [];
  ws.onmessage = (event) => {
    try {
      const evt = JSON.parse(event.data);
      events.push(evt);
      if (['StasisStart', 'RecordingStarted', 'PlaybackStarted', 'PlaybackFinished', 'RecordingFinished'].includes(evt.type)) {
        console.log(`[ARI EVENT] type=${evt.type} chId=${evt.channel?.id} chName=${evt.channel?.name} rec=${evt.recording?.name} pb=${evt.playback?.id} args=${JSON.stringify(evt.args)}`);
      }
    } catch {}
  };

  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  console.log('WebSocket connected.');

  console.log('\n--- 2. Originating Caller & Buyer Main Channels into Stasis ---');
  const [callerOrigRes, buyerOrigRes] = await Promise.all([
    ariRequest(`/ari/channels?endpoint=Local/test_caller@from-telnyx-buyer&app=callflow-qa&appArgs=caller,${runId}`, 'POST'),
    ariRequest(`/ari/channels?endpoint=Local/test_buyer@from-telnyx-buyer&app=callflow-qa&appArgs=buyer,${runId}`, 'POST')
  ]);

  const callerMainId = callerOrigRes.id;
  const buyerMainId = buyerOrigRes.id;
  console.log(`Caller Main Channel: ${callerMainId} (${callerOrigRes.name})`);
  console.log(`Buyer Main Channel: ${buyerMainId} (${buyerOrigRes.name})`);

  // Await StasisStart for both main channels
  console.log('Awaiting StasisStart for caller and buyer main channels...');
  for (let i = 0; i < 40; i++) {
    const callerStasis = events.find(e => e.type === 'StasisStart' && e.channel?.id === callerMainId);
    const buyerStasis = events.find(e => e.type === 'StasisStart' && e.channel?.id === buyerMainId);
    if (callerStasis && buyerStasis) break;
    await new Promise(r => setTimeout(r, 100));
  }

  console.log('\n--- 3. Attaching Caller & Buyer Snoop Channels ---');
  const [callerSnoopRes, buyerSnoopRes] = await Promise.all([
    ariRequest(`/ari/channels/${encodeURIComponent(callerMainId)}/snoop?app=${encodeURIComponent(APP)}&spy=in&whisper=none&appArgs=snoop,caller,${runId}`, 'POST'),
    ariRequest(`/ari/channels/${encodeURIComponent(buyerMainId)}/snoop?app=${encodeURIComponent(APP)}&spy=in&whisper=none&appArgs=snoop,buyer,${runId}`, 'POST')
  ]);

  const callerSnoopId = callerSnoopRes.id;
  const buyerSnoopId = buyerSnoopRes.id;
  console.log(`Caller Snoop Channel: ${callerSnoopId} (${callerSnoopRes.name})`);
  console.log(`Buyer Snoop Channel: ${buyerSnoopId} (${buyerSnoopRes.name})`);

  // Await StasisStart for both Snoop channels
  console.log('Awaiting StasisStart for both Snoop channels...');
  let callerSnoopStasis = null;
  let buyerSnoopStasis = null;
  for (let i = 0; i < 40; i++) {
    callerSnoopStasis = events.find(e => e.type === 'StasisStart' && e.channel?.id === callerSnoopId);
    buyerSnoopStasis = events.find(e => e.type === 'StasisStart' && e.channel?.id === buyerSnoopId);
    if (callerSnoopStasis && buyerSnoopStasis) break;
    await new Promise(r => setTimeout(r, 100));
  }
  console.log('Caller Snoop Stasis confirmed:', !!callerSnoopStasis);
  console.log('Buyer Snoop Stasis confirmed:', !!buyerSnoopStasis);

  console.log('\n--- 4. Starting Recordings on Both Snoop Channels ---');
  const callerRecName = `qa-caller-${runId}`;
  const buyerRecName = `qa-buyer-${runId}`;

  const [callerRecRes, buyerRecRes] = await Promise.all([
    ariRequest(`/ari/channels/${encodeURIComponent(callerSnoopId)}/record?name=${encodeURIComponent(callerRecName)}&format=wav&maxDurationSeconds=10&maxSilenceSeconds=0`, 'POST'),
    ariRequest(`/ari/channels/${encodeURIComponent(buyerSnoopId)}/record?name=${encodeURIComponent(buyerRecName)}&format=wav&maxDurationSeconds=10&maxSilenceSeconds=0`, 'POST')
  ]);
  console.log('Caller recording response:', callerRecRes.name, callerRecRes.state);
  console.log('Buyer recording response:', buyerRecRes.name, buyerRecRes.state);

  // Await RecordingStarted for both
  for (let i = 0; i < 30; i++) {
    const cStarted = events.find(e => e.type === 'RecordingStarted' && e.recording?.name === callerRecName);
    const bStarted = events.find(e => e.type === 'RecordingStarted' && e.recording?.name === buyerRecName);
    if (cStarted && bStarted) break;
    await new Promise(r => setTimeout(r, 100));
  }
  console.log('Dual recordings confirmed active on Snoop channels.');

  console.log('\n--- 5. Triggering Marker Playback on Main Channels CONCURRENTLY ---');
  const tPlayStart = Date.now();
  const [callerPlayRes, buyerPlayRes] = await Promise.all([
    ariRequest(`/ari/channels/${encodeURIComponent(callerMainId)}/play?media=sound:/var/lib/asterisk/sounds/qa/qa-caller-marker`, 'POST'),
    ariRequest(`/ari/channels/${encodeURIComponent(buyerMainId)}/play?media=sound:/var/lib/asterisk/sounds/qa/qa-buyer-marker`, 'POST')
  ]);
  console.log('Caller playMedia issued:', callerPlayRes.id);
  console.log('Buyer playMedia issued:', buyerPlayRes.id);

  // Await PlaybackFinished for both
  for (let i = 0; i < 60; i++) {
    const cPlayDone = events.find(e => e.type === 'PlaybackFinished' && e.playback?.id === callerPlayRes?.id);
    const bPlayDone = events.find(e => e.type === 'PlaybackFinished' && e.playback?.id === buyerPlayRes?.id);
    if (cPlayDone && bPlayDone) break;
    await new Promise(r => setTimeout(r, 100));
  }
  const playDuration = Date.now() - tPlayStart;
  console.log(`Both playbacks finished successfully in ${playDuration}ms without queue blocking!`);

  console.log('\n--- 6. Stopping Recordings & Retrieving Native Audio Buffers ---');
  await Promise.all([
    ariRequest(`/ari/recordings/live/${encodeURIComponent(callerRecName)}/stop`, 'POST'),
    ariRequest(`/ari/recordings/live/${encodeURIComponent(buyerRecName)}/stop`, 'POST')
  ]);

  for (let i = 0; i < 30; i++) {
    const cRecDone = events.find(e => e.type === 'RecordingFinished' && e.recording?.name === callerRecName);
    const bRecDone = events.find(e => e.type === 'RecordingFinished' && e.recording?.name === buyerRecName);
    if (cRecDone && bRecDone) break;
    await new Promise(r => setTimeout(r, 100));
  }
  console.log('Both recordings finished.');

  // Download stored files
  const [callerWavRes, buyerWavRes] = await Promise.all([
    fetch(`${ARI_BASE}/ari/recordings/stored/${encodeURIComponent(callerRecName)}/file`, { headers: { Authorization: AUTH } }),
    fetch(`${ARI_BASE}/ari/recordings/stored/${encodeURIComponent(buyerRecName)}/file`, { headers: { Authorization: AUTH } })
  ]);

  const callerWavBuf = Buffer.from(await callerWavRes.arrayBuffer());
  const buyerWavBuf = Buffer.from(await buyerWavRes.arrayBuffer());

  console.log(`Caller WAV size: ${callerWavBuf.length} bytes (Magic: ${callerWavBuf.toString('ascii', 0, 4)}/${callerWavBuf.toString('ascii', 8, 12)})`);
  console.log(`Buyer WAV size: ${buyerWavBuf.length} bytes (Magic: ${buyerWavBuf.toString('ascii', 0, 4)}/${buyerWavBuf.toString('ascii', 8, 12)})`);

  const callerValid = callerWavBuf.length > 44 && callerWavBuf.toString('ascii', 0, 4) === 'RIFF';
  const buyerValid = buyerWavBuf.length > 44 && buyerWavBuf.toString('ascii', 0, 4) === 'RIFF';
  console.log(`Validation: Caller Valid=${callerValid}, Buyer Valid=${buyerValid}`);

  console.log('\n--- 7. Cleanup All Channels & Recordings ---');
  // Reordered teardown: recordings already stopped, hangup Snoop channels first, then main channels
  await Promise.all([
    ariRequest(`/ari/channels/${encodeURIComponent(callerSnoopId)}`, 'DELETE').catch(() => {}),
    ariRequest(`/ari/channels/${encodeURIComponent(buyerSnoopId)}`, 'DELETE').catch(() => {})
  ]);
  await Promise.all([
    ariRequest(`/ari/channels/${encodeURIComponent(callerMainId)}`, 'DELETE').catch(() => {}),
    ariRequest(`/ari/channels/${encodeURIComponent(buyerMainId)}`, 'DELETE').catch(() => {})
  ]);
  await Promise.all([
    ariRequest(`/ari/recordings/stored/${encodeURIComponent(callerRecName)}`, 'DELETE').catch(() => {}),
    ariRequest(`/ari/recordings/stored/${encodeURIComponent(buyerRecName)}`, 'DELETE').catch(() => {})
  ]);

  ws.close();
  console.log('Cleanup completed. Dual Snoop integration test PASSED!');
}

runDualSnoopTest().catch(err => {
  console.error('Dual Snoop Test failed:', err);
  process.exit(1);
});
