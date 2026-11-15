// qa/probe-ari-bridge.mjs
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
  console.log('Connecting WS...');
  const wsUrl = `ws://127.0.0.1:8088/ari/events?app=${encodeURIComponent(APP)}&api_key=${encodeURIComponent(USER)}:${encodeURIComponent(PASS)}`;
  const ws = new WebSocket(wsUrl);
  const events = [];
  ws.onmessage = (event) => {
    try {
      const evt = JSON.parse(event.data);
      events.push(evt);
      if (['StasisStart', 'StasisEnd', 'ChannelEnteredBridge', 'ChannelLeftBridge'].includes(evt.type)) {
        console.log(`[EVENT] ${evt.type}: ch=${evt.channel?.id} (${evt.channel?.name}) br=${evt.bridge?.id} args=${JSON.stringify(evt.args)}`);
      }
    } catch {}
  };
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  console.log('WS connected.');

  console.log('Creating mixing bridge...');
  const bridge = await ari('/ari/bridges?type=mixing', 'POST');
  console.log(`Bridge created: id=${bridge.id}, type=${bridge.bridge_type}, tech=${bridge.technology}`);

  console.log('Originating channel A...');
  const chA = await ari(`/ari/channels?endpoint=Local/testA@from-telnyx-buyer&app=callflow-qa&appArgs=probe,A`, 'POST');
  console.log(`Channel A originated: id=${chA.id}, name=${chA.name}`);

  console.log('Originating channel B...');
  const chB = await ari(`/ari/channels?endpoint=Local/testB@from-telnyx-buyer&app=callflow-qa&appArgs=probe,B`, 'POST');
  console.log(`Channel B originated: id=${chB.id}, name=${chB.name}`);

  // Wait for StasisStart
  await new Promise(r => setTimeout(r, 1000));

  console.log('Adding channels to bridge...');
  await ari(`/ari/bridges/${bridge.id}/addChannel?channel=${chA.id},${chB.id}`, 'POST');
  console.log('Added to bridge.');

  await new Promise(r => setTimeout(r, 1000));

  console.log('Checking bridge status...');
  const brStatus = await ari(`/ari/bridges/${bridge.id}`);
  console.log(`Bridge ${bridge.id} channels:`, brStatus.channels);

  console.log('Cleaning up channels and bridge...');
  await ari(`/ari/bridges/${bridge.id}/removeChannel?channel=${chA.id},${chB.id}`, 'POST').catch(() => {});
  await ari(`/ari/channels/${chA.id}`, 'DELETE').catch(() => {});
  await ari(`/ari/channels/${chB.id}`, 'DELETE').catch(() => {});
  await ari(`/ari/bridges/${bridge.id}`, 'DELETE').catch(() => {});

  ws.close();
  console.log('Probe finished successfully!');
}

probe().catch(e => {
  console.error('Probe error:', e);
  process.exit(1);
});
