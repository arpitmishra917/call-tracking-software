// qa/probe-snoop-bridge.mjs
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

async function probe() {
  const wsUrl = `ws://127.0.0.1:8088/ari/events?app=${encodeURIComponent(APP)}&api_key=${encodeURIComponent(USER)}:${encodeURIComponent(PASS)}`;
  const ws = new WebSocket(wsUrl);
  const events = [];
  ws.onmessage = (event) => {
    try {
      events.push(JSON.parse(event.data));
    } catch {}
  };
  await new Promise(r => { ws.onopen = r; });

  const bridge = await ari('/ari/bridges?type=mixing', 'POST');
  const chC = await ari('/ari/channels?endpoint=Local/c@from-telnyx-buyer&app=callflow-qa&appArgs=probe,c', 'POST');
  const chB = await ari('/ari/channels?endpoint=Local/b@from-telnyx-buyer&app=callflow-qa&appArgs=probe,b', 'POST');

  await new Promise(r => setTimeout(r, 1000));
  await ari(`/ari/bridges/${bridge.id}/addChannel?channel=${chC.id},${chB.id}`, 'POST');

  // Snoop on Buyer with spy=out (what buyer hears)
  console.log('Attaching snoop on Buyer with spy=out...');
  const snoopB = await ari(`/ari/channels/${chB.id}/snoop?app=${APP}&spy=out&whisper=none&appArgs=snoop,b`, 'POST');
  console.log('Snoop channel on Buyer:', snoopB.id);

  await new Promise(r => setTimeout(r, 500));

  // Record on snoop channel
  const recName = `probe-snoop-out-${Date.now()}`;
  console.log('Starting record on snoop channel:', recName);
  await ari(`/ari/channels/${snoopB.id}/record?name=${recName}&format=wav&maxDurationSeconds=5&ifExists=overwrite`, 'POST');

  // Play 700 Hz on caller channel
  console.log('Playing 700 Hz on caller channel...');
  await ari(`/ari/channels/${chC.id}/play?media=sound:/var/lib/asterisk/sounds/qa/qa-caller1-700hz`, 'POST');

  await new Promise(r => setTimeout(r, 3500));

  console.log('Stopping recording...');
  await ari(`/ari/recordings/live/${recName}/stop`, 'POST').catch(() => {});

  await new Promise(r => setTimeout(r, 1000));

  const recFileRes = await fetch(`${ARI_BASE}/ari/recordings/stored/${recName}/file`, { headers: { Authorization: AUTH } });
  const recBuf = Buffer.from(await recFileRes.arrayBuffer());
  console.log(`Snoop recording WAV bytes: ${recBuf.length} (Magic: ${recBuf.toString('ascii', 0, 4)})`);

  // Cleanup
  await ari(`/ari/channels/${snoopB.id}`, 'DELETE').catch(() => {});
  await ari(`/ari/channels/${chC.id}`, 'DELETE').catch(() => {});
  await ari(`/ari/channels/${chB.id}`, 'DELETE').catch(() => {});
  await ari(`/ari/bridges/${bridge.id}`, 'DELETE').catch(() => {});
  await ari(`/ari/recordings/stored/${recName}`, 'DELETE').catch(() => {});

  ws.close();
  console.log('Probe snoop bridge test finished.');
}

probe().catch(e => {
  console.error('Probe error:', e);
  process.exit(1);
});
