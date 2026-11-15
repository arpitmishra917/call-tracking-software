// qa/preflight-qa-2e.mjs
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

async function main() {
  console.log('--- 1. Asterisk Info ---');
  const asterInfo = await ari('/ari/asterisk/info');
  console.log('Asterisk system:', asterInfo.system);
  console.log('Asterisk build:', asterInfo.build);
  console.log('Asterisk status:', asterInfo.status);

  console.log('\n--- 2. Active Channels ---');
  const channels = await ari('/ari/channels');
  console.log(`Active channels count: ${channels.length}`);
  for (const ch of channels) {
    console.log(` - [${ch.id}] ${ch.name} state=${ch.state}`);
  }

  console.log('\n--- 3. Active Bridges ---');
  const bridges = await ari('/ari/bridges');
  console.log(`Active bridges count: ${bridges.length}`);
  for (const br of bridges) {
    console.log(` - [${br.id}] ${br.technology} channels=${JSON.stringify(br.channels)}`);
  }

  console.log('\n--- 4. Endpoints ---');
  const endpoints = await ari('/ari/endpoints');
  console.log(`Total endpoints count: ${endpoints.length}`);
  for (const ep of endpoints) {
    console.log(` - ${ep.technology}/${ep.resource} (${ep.state})`);
  }

  console.log('\n--- 5. Stored Recordings ---');
  const recs = await ari('/ari/recordings/stored');
  console.log(`Stored recordings count: ${recs.length}`);
  for (const r of recs.slice(0, 5)) {
    console.log(` - ${r.name} (${r.format})`);
  }

  console.log('\n--- 6. Sound Files Available ---');
  const sounds = await ari('/ari/sounds');
  const qaSounds = sounds.filter(s => s.id.includes('qa'));
  console.log(`Total sounds: ${sounds.length}, QA sounds:`, qaSounds.map(s => s.id));
}

main().catch(err => {
  console.error('Preflight error:', err);
  process.exit(1);
});
