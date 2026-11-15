// qa/probe-local-far-end.mjs
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

function goertzel(samples, sampleRate, targetFreq) {
  const N = samples.length;
  if (N === 0) return 0;
  const k = Math.round((N * targetFreq) / sampleRate);
  const omega = (2 * Math.PI * k) / N;
  const coeff = 2 * Math.cos(omega);
  let s_prev = 0;
  let s_prev2 = 0;
  for (let i = 0; i < N; i++) {
    const s = samples[i] + coeff * s_prev - s_prev2;
    s_prev2 = s_prev;
    s_prev = s;
  }
  const power = s_prev2 * s_prev2 + s_prev * s_prev - coeff * s_prev * s_prev2;
  return power / (N * N);
}

async function probe() {
  const wsUrl = `ws://127.0.0.1:8088/ari/events?app=${encodeURIComponent(APP)}&api_key=${encodeURIComponent(USER)}:${encodeURIComponent(PASS)}`;
  const ws = new WebSocket(wsUrl);
  const stasisChannels = [];
  ws.onmessage = (event) => {
    try {
      const evt = JSON.parse(event.data);
      if (evt.type === 'StasisStart') {
        stasisChannels.push(evt.channel);
        console.log(`StasisStart: ${evt.channel.id} (${evt.channel.name}) args=${JSON.stringify(evt.args)}`);
      }
    } catch {}
  };
  await new Promise(r => { ws.onopen = r; });

  const bridge = await ari('/ari/bridges?type=mixing', 'POST');
  console.log('Bridge created:', bridge.id);

  // Originate Caller
  const chC1 = await ari(`/ari/channels?endpoint=Local/c1@from-telnyx-buyer&app=callflow-qa&appArgs=caller`, 'POST');
  // Originate Buyer
  const chB1 = await ari(`/ari/channels?endpoint=Local/b1@from-telnyx-buyer&app=callflow-qa&appArgs=buyer`, 'POST');

  await new Promise(r => setTimeout(r, 1000));
  console.log('Stasis channels count:', stasisChannels.length);
  for (const c of stasisChannels) {
    console.log(` - ID=${c.id} Name=${c.name}`);
  }

  // Find ;1 and ;2 for Caller and Buyer
  const caller1 = stasisChannels.find(c => c.name.includes('Local/c1') && c.name.endsWith(';1'));
  const caller2 = stasisChannels.find(c => c.name.includes('Local/c1') && c.name.endsWith(';2'));
  const buyer1 = stasisChannels.find(c => c.name.includes('Local/b1') && c.name.endsWith(';1'));
  const buyer2 = stasisChannels.find(c => c.name.includes('Local/b1') && c.name.endsWith(';2'));

  console.log(`Caller: ;1=${caller1?.id}, ;2=${caller2?.id}`);
  console.log(`Buyer:  ;1=${buyer1?.id}, ;2=${buyer2?.id}`);

  // Put ;1 channels into the bridge
  await ari(`/ari/bridges/${bridge.id}/addChannel?channel=${caller1.id},${buyer1.id}`, 'POST');
  console.log('Put caller ;1 and buyer ;1 into bridge.');

  // Start recording on bridge
  const bridgeRec = `probe-br-${Date.now()}`;
  await ari(`/ari/bridges/${bridge.id}/record?name=${bridgeRec}&format=wav&maxDurationSeconds=5&ifExists=overwrite`, 'POST');

  // Start snoop on buyer1 with spy=out (what buyer hears from bridge)
  const snoopB = await ari(`/ari/channels/${buyer1.id}/snoop?app=${APP}&spy=out&whisper=none&appArgs=snoop`, 'POST');
  const snoopRec = `probe-snoop-${Date.now()}`;
  await ari(`/ari/channels/${snoopB.id}/record?name=${snoopRec}&format=wav&maxDurationSeconds=5&ifExists=overwrite`, 'POST');

  // PLAY on caller2 (;2 - the far-end transmitting into the call!)
  console.log(`Playing 700 Hz on caller ;2 (${caller2.id})...`);
  await ari(`/ari/channels/${caller2.id}/play?media=sound:/var/lib/asterisk/sounds/qa/qa-caller1-700hz`, 'POST');

  await new Promise(r => setTimeout(r, 3500));

  // Stop recordings
  await ari(`/ari/recordings/live/${bridgeRec}/stop`, 'POST').catch(() => {});
  await ari(`/ari/recordings/live/${snoopRec}/stop`, 'POST').catch(() => {});
  await new Promise(r => setTimeout(r, 1000));

  // Analyze bridge recording
  const brWavRes = await fetch(`${ARI_BASE}/ari/recordings/stored/${bridgeRec}/file`, { headers: { Authorization: AUTH } });
  const brBuf = Buffer.from(await brWavRes.arrayBuffer());
  console.log(`Bridge WAV size: ${brBuf.length} bytes`);

  // Analyze snoop recording
  const snWavRes = await fetch(`${ARI_BASE}/ari/recordings/stored/${snoopRec}/file`, { headers: { Authorization: AUTH } });
  const snBuf = Buffer.from(await snWavRes.arrayBuffer());
  console.log(`Snoop WAV size: ${snBuf.length} bytes`);

  // Parse samples
  const sampleCount = Math.floor((brBuf.length - 44) / 2);
  const brSamples = new Float64Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    brSamples[i] = brBuf.readInt16LE(44 + i * 2) / 32768.0;
  }
  const p700Br = goertzel(brSamples, 8000, 700);
  console.log(`Bridge Power at 700 Hz: ${p700Br.toExponential(3)} (${(10 * Math.log10(p700Br || 1e-12)).toFixed(1)} dB)`);

  const snSampleCount = Math.floor((snBuf.length - 44) / 2);
  const snSamples = new Float64Array(snSampleCount);
  for (let i = 0; i < snSampleCount; i++) {
    snSamples[i] = snBuf.readInt16LE(44 + i * 2) / 32768.0;
  }
  const p700Sn = goertzel(snSamples, 8000, 700);
  console.log(`Buyer Snoop Power at 700 Hz: ${p700Sn.toExponential(3)} (${(10 * Math.log10(p700Sn || 1e-12)).toFixed(1)} dB)`);

  // Cleanup
  await ari(`/ari/channels/${snoopB.id}`, 'DELETE').catch(() => {});
  await ari(`/ari/channels/${caller1.id}`, 'DELETE').catch(() => {});
  await ari(`/ari/channels/${buyer1.id}`, 'DELETE').catch(() => {});
  await ari(`/ari/bridges/${bridge.id}`, 'DELETE').catch(() => {});
  await ari(`/ari/recordings/stored/${bridgeRec}`, 'DELETE').catch(() => {});
  await ari(`/ari/recordings/stored/${snoopRec}`, 'DELETE').catch(() => {});

  ws.close();
}

probe().catch(e => {
  console.error('Probe error:', e);
  process.exit(1);
});
