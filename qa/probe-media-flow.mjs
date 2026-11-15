// qa/probe-media-flow.mjs
const ARI_BASE = 'http://127.0.0.1:8088';
const USER = 'callflow_qa';
const PASS = 'cfqa_ari_1f044860de198dfa6fd829c7a40f23cbe9ae09b6';
const AUTH = 'Basic ' + Buffer.from(`${USER}:${PASS}`).toString('base64');
const APP = 'callflow-qa';

async function ari(path, method = 'GET', body = null) {
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

async function probeMedia() {
  console.log('Connecting WS...');
  const wsUrl = `ws://127.0.0.1:8088/ari/events?app=${encodeURIComponent(APP)}&api_key=${encodeURIComponent(USER)}:${encodeURIComponent(PASS)}`;
  const ws = new WebSocket(wsUrl);
  const events = [];
  ws.onmessage = (event) => {
    try {
      const evt = JSON.parse(event.data);
      events.push(evt);
      if (['StasisStart', 'PlaybackStarted', 'PlaybackFinished', 'RecordingStarted', 'RecordingFinished'].includes(evt.type)) {
        console.log(`[EVENT] ${evt.type}: ch=${evt.channel?.id} rec=${evt.recording?.name} pb=${evt.playback?.id}`);
      }
    } catch {}
  };
  await new Promise(r => { ws.onopen = r; });

  const bridge = await ari('/ari/bridges?type=mixing', 'POST');
  console.log('Bridge created:', bridge.id);

  const chCaller = await ari('/ari/channels?endpoint=Local/caller1@from-telnyx-buyer&app=callflow-qa&appArgs=probe,caller1', 'POST');
  const chBuyer = await ari('/ari/channels?endpoint=Local/buyer1@from-telnyx-buyer&app=callflow-qa&appArgs=probe,buyer1', 'POST');

  await new Promise(r => setTimeout(r, 1000));

  await ari(`/ari/bridges/${bridge.id}/addChannel?channel=${chCaller.id},${chBuyer.id}`, 'POST');
  console.log('Channels added to bridge.');

  // Test recording on bridge directly
  const bridgeRecName = `test-bridge-rec-${Date.now()}`;
  console.log('Testing bridge recording:', bridgeRecName);
  const brRec = await ari(`/ari/bridges/${bridge.id}/record?name=${bridgeRecName}&format=wav&maxDurationSeconds=5&ifExists=overwrite`, 'POST');
  console.log('Bridge recording response:', brRec.name, brRec.state);

  // Play 700 Hz on caller channel
  console.log('Playing 700 Hz on caller channel...');
  const pb = await ari(`/ari/channels/${chCaller.id}/play?media=sound:/var/lib/asterisk/sounds/qa/qa-caller1-700hz`, 'POST');
  console.log('Playback started:', pb.id);

  await new Promise(r => setTimeout(r, 3500));

  console.log('Stopping bridge recording...');
  await ari(`/ari/recordings/live/${bridgeRecName}/stop`, 'POST').catch(() => {});

  await new Promise(r => setTimeout(r, 1000));

  // Check stored recording
  const recFileRes = await fetch(`${ARI_BASE}/ari/recordings/stored/${bridgeRecName}/file`, { headers: { Authorization: AUTH } });
  const recBuf = Buffer.from(await recFileRes.arrayBuffer());
  console.log(`Bridge recording WAV bytes: ${recBuf.length} (Magic: ${recBuf.toString('ascii', 0, 4)})`);

  // Cleanup
  await ari(`/ari/channels/${chCaller.id}`, 'DELETE').catch(() => {});
  await ari(`/ari/channels/${chBuyer.id}`, 'DELETE').catch(() => {});
  await ari(`/ari/bridges/${bridge.id}`, 'DELETE').catch(() => {});
  await ari(`/ari/recordings/stored/${bridgeRecName}`, 'DELETE').catch(() => {});

  ws.close();
  console.log('Probe media completed successfully!');
}

probeMedia().catch(e => {
  console.error('Probe media error:', e);
  process.exit(1);
});
