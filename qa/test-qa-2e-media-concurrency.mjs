// qa/test-qa-2e-media-concurrency.mjs
import fs from 'fs';
import path from 'path';

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

function parseWav(buffer) {
  if (!buffer || buffer.length < 44) throw new Error('WAV too small');
  const riff = buffer.toString('ascii', 0, 4);
  const wave = buffer.toString('ascii', 8, 12);
  if (riff !== 'RIFF' || wave !== 'WAVE') throw new Error('Invalid RIFF/WAVE header');

  let offset = 12;
  let fmtOffset = -1;
  let dataOffset = -1;
  let dataSize = 0;

  while (offset <= buffer.length - 8) {
    const chunkId = buffer.toString('ascii', offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    if (chunkId === 'fmt ') {
      fmtOffset = offset + 8;
    } else if (chunkId === 'data') {
      dataOffset = offset + 8;
      dataSize = chunkSize;
      break;
    }
    offset += 8 + chunkSize;
  }

  if (fmtOffset === -1 || dataOffset === -1) throw new Error('Missing fmt or data chunk');
  const channels = buffer.readUInt16LE(fmtOffset + 2);
  const sampleRate = buffer.readUInt32LE(fmtOffset + 4);
  const bitsPerSample = buffer.readUInt16LE(fmtOffset + 14);

  const sampleCount = Math.floor(Math.min(dataSize, buffer.length - dataOffset) / (2 * channels));
  const samples = new Float64Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    samples[i] = buffer.readInt16LE(dataOffset + i * 2 * channels) / 32768.0;
  }

  return {
    sampleRate,
    channels,
    bitsPerSample,
    durationSeconds: sampleCount / sampleRate,
    sampleCount,
    samples
  };
}

function goertzelPower(samples, sampleRate, targetFreq) {
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

function toDb(power) {
  if (power <= 1e-12) return -120;
  return 10 * Math.log10(power);
}

async function runLocalMediaConcurrencyTest() {
  console.log('================================================================');
  console.log('CALLFLOW — QA-2E: LOCAL ASTERISK MEDIA CONCURRENCY VERIFICATION');
  console.log('================================================================');
  const startTime = new Date().toISOString();
  const runId = 'qa2e-' + Date.now();
  const outputDir = path.resolve('qa/recordings/qa-2e');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  // 1. Preflight baseline checks
  console.log('\n--- PHASE 1: PREFLIGHT & BASELINE CHECK ---');
  const initialChannels = await ari('/ari/channels');
  const initialBridges = await ari('/ari/bridges');
  console.log(`Initial active channels: ${initialChannels.length}`);
  console.log(`Initial active bridges: ${initialBridges.length}`);
  if (initialChannels.length > 0 || initialBridges.length > 0) {
    throw new Error(`Preflight failed: Asterisk not idle (channels=${initialChannels.length}, bridges=${initialBridges.length})`);
  }

  // Connect WebSocket to capture channel references and lifecycle events
  const wsUrl = `ws://127.0.0.1:8088/ari/events?app=${encodeURIComponent(APP)}&api_key=${encodeURIComponent(USER)}:${encodeURIComponent(PASS)}`;
  const ws = new WebSocket(wsUrl);
  const stasisChannels = new Map();
  ws.onmessage = (event) => {
    try {
      const evt = JSON.parse(event.data);
      if (evt.type === 'StasisStart') {
        stasisChannels.set(evt.channel.id, evt.channel);
        console.log(`[ARI EVENT] StasisStart ch=${evt.channel.id} name=${evt.channel.name} args=${JSON.stringify(evt.args)}`);
      } else if (evt.type === 'StasisEnd') {
        stasisChannels.delete(evt.channel.id);
        console.log(`[ARI EVENT] StasisEnd ch=${evt.channel.id}`);
      } else if (['ChannelEnteredBridge', 'ChannelLeftBridge', 'PlaybackStarted', 'PlaybackFinished', 'RecordingStarted', 'RecordingFinished'].includes(evt.type)) {
        console.log(`[ARI EVENT] ${evt.type} ch=${evt.channel?.id} br=${evt.bridge?.id} rec=${evt.recording?.name} pb=${evt.playback?.id}`);
      }
    } catch {}
  };
  await new Promise(r => { ws.onopen = r; });
  console.log('WebSocket event listener connected.');

  // 2. Establish Call 1 (Caller 1 + Buyer 1 + Bridge 1)
  console.log('\n--- PHASE 2: ESTABLISHING CALL 1 ---');
  const bridge1 = await ari('/ari/bridges?type=mixing', 'POST');
  console.log(`Call 1 Bridge created: ID=${bridge1.id}`);

  await Promise.all([
    ari(`/ari/channels?endpoint=Local/c1@from-telnyx-buyer&app=callflow-qa&appArgs=c1`, 'POST'),
    ari(`/ari/channels?endpoint=Local/b1@from-telnyx-buyer&app=callflow-qa&appArgs=b1`, 'POST')
  ]);

  // Wait for StasisStart events for both halves (;1 and ;2) of c1 and b1
  console.log('Awaiting StasisStart for Call 1 legs...');
  for (let i = 0; i < 40; i++) {
    const chList = Array.from(stasisChannels.values());
    const c1_1 = chList.find(c => c.name.includes('Local/c1') && c.name.endsWith(';1'));
    const c1_2 = chList.find(c => c.name.includes('Local/c1') && c.name.endsWith(';2'));
    const b1_1 = chList.find(c => c.name.includes('Local/b1') && c.name.endsWith(';1'));
    const b1_2 = chList.find(c => c.name.includes('Local/b1') && c.name.endsWith(';2'));
    if (c1_1 && c1_2 && b1_1 && b1_2) break;
    await new Promise(r => setTimeout(r, 100));
  }

  const allCh1 = Array.from(stasisChannels.values());
  const c1_bridge = allCh1.find(c => c.name.includes('Local/c1') && c.name.endsWith(';1'));
  const c1_farEnd = allCh1.find(c => c.name.includes('Local/c1') && c.name.endsWith(';2'));
  const b1_bridge = allCh1.find(c => c.name.includes('Local/b1') && c.name.endsWith(';1'));
  const b1_farEnd = allCh1.find(c => c.name.includes('Local/b1') && c.name.endsWith(';2'));

  console.log(`Call 1 Caller: BridgeLeg=${c1_bridge.id} (${c1_bridge.name}), FarEnd=${c1_farEnd.id} (${c1_farEnd.name})`);
  console.log(`Call 1 Buyer:  BridgeLeg=${b1_bridge.id} (${b1_bridge.name}), FarEnd=${b1_farEnd.id} (${b1_farEnd.name})`);

  // Add bridge legs to Bridge 1
  await ari(`/ari/bridges/${bridge1.id}/addChannel?channel=${c1_bridge.id},${b1_bridge.id}`, 'POST');
  console.log(`Call 1 Bridge legs added to Bridge 1.`);

  // Attach Snoops on Call 1 bridge legs with spy=out (what each leg receives from the bridge)
  const [snoopC1, snoopB1] = await Promise.all([
    ari(`/ari/channels/${c1_bridge.id}/snoop?app=${APP}&spy=out&whisper=none&appArgs=snoop,c1`, 'POST'),
    ari(`/ari/channels/${b1_bridge.id}/snoop?app=${APP}&spy=out&whisper=none&appArgs=snoop,b1`, 'POST')
  ]);
  console.log(`Call 1 Snoops attached: SnoopC1=${snoopC1.id}, SnoopB1=${snoopB1.id}`);

  await new Promise(r => setTimeout(r, 500));

  // Start recordings for Call 1
  const rec1Bridge = `${runId}-call1-bridge`;
  const rec1CallerRx = `${runId}-call1-caller-rx`;
  const rec1BuyerRx = `${runId}-call1-buyer-rx`;

  await Promise.all([
    ari(`/ari/bridges/${bridge1.id}/record?name=${rec1Bridge}&format=wav&maxDurationSeconds=15&ifExists=overwrite`, 'POST'),
    ari(`/ari/channels/${snoopC1.id}/record?name=${rec1CallerRx}&format=wav&maxDurationSeconds=15&ifExists=overwrite`, 'POST'),
    ari(`/ari/channels/${snoopB1.id}/record?name=${rec1BuyerRx}&format=wav&maxDurationSeconds=15&ifExists=overwrite`, 'POST')
  ]);
  console.log(`Call 1 Recordings initiated: Bridge=${rec1Bridge}, CallerRX=${rec1CallerRx}, BuyerRX=${rec1BuyerRx}`);

  // 3. Establish Call 2 CONCURRENTLY (Caller 2 + Buyer 2 + Bridge 2)
  console.log('\n--- PHASE 3: ESTABLISHING CALL 2 CONCURRENTLY ---');
  const bridge2 = await ari('/ari/bridges?type=mixing', 'POST');
  console.log(`Call 2 Bridge created: ID=${bridge2.id}`);

  await Promise.all([
    ari(`/ari/channels?endpoint=Local/c2@from-telnyx-buyer&app=callflow-qa&appArgs=c2`, 'POST'),
    ari(`/ari/channels?endpoint=Local/b2@from-telnyx-buyer&app=callflow-qa&appArgs=b2`, 'POST')
  ]);

  // Wait for StasisStart events for both halves (;1 and ;2) of c2 and b2
  console.log('Awaiting StasisStart for Call 2 legs...');
  for (let i = 0; i < 40; i++) {
    const chList = Array.from(stasisChannels.values());
    const c2_1 = chList.find(c => c.name.includes('Local/c2') && c.name.endsWith(';1'));
    const c2_2 = chList.find(c => c.name.includes('Local/c2') && c.name.endsWith(';2'));
    const b2_1 = chList.find(c => c.name.includes('Local/b2') && c.name.endsWith(';1'));
    const b2_2 = chList.find(c => c.name.includes('Local/b2') && c.name.endsWith(';2'));
    if (c2_1 && c2_2 && b2_1 && b2_2) break;
    await new Promise(r => setTimeout(r, 100));
  }

  const allCh2 = Array.from(stasisChannels.values());
  const c2_bridge = allCh2.find(c => c.name.includes('Local/c2') && c.name.endsWith(';1'));
  const c2_farEnd = allCh2.find(c => c.name.includes('Local/c2') && c.name.endsWith(';2'));
  const b2_bridge = allCh2.find(c => c.name.includes('Local/b2') && c.name.endsWith(';1'));
  const b2_farEnd = allCh2.find(c => c.name.includes('Local/b2') && c.name.endsWith(';2'));

  console.log(`Call 2 Caller: BridgeLeg=${c2_bridge.id} (${c2_bridge.name}), FarEnd=${c2_farEnd.id} (${c2_farEnd.name})`);
  console.log(`Call 2 Buyer:  BridgeLeg=${b2_bridge.id} (${b2_bridge.name}), FarEnd=${b2_farEnd.id} (${b2_farEnd.name})`);

  // Add bridge legs to Bridge 2
  await ari(`/ari/bridges/${bridge2.id}/addChannel?channel=${c2_bridge.id},${b2_bridge.id}`, 'POST');
  console.log(`Call 2 Bridge legs added to Bridge 2.`);

  // Attach Snoops on Call 2 bridge legs with spy=out (what each leg receives from the bridge)
  const [snoopC2, snoopB2] = await Promise.all([
    ari(`/ari/channels/${c2_bridge.id}/snoop?app=${APP}&spy=out&whisper=none&appArgs=snoop,c2`, 'POST'),
    ari(`/ari/channels/${b2_bridge.id}/snoop?app=${APP}&spy=out&whisper=none&appArgs=snoop,b2`, 'POST')
  ]);
  console.log(`Call 2 Snoops attached: SnoopC2=${snoopC2.id}, SnoopB2=${snoopB2.id}`);

  await new Promise(r => setTimeout(r, 500));

  // Start recordings for Call 2
  const rec2Bridge = `${runId}-call2-bridge`;
  const rec2CallerRx = `${runId}-call2-caller-rx`;
  const rec2BuyerRx = `${runId}-call2-buyer-rx`;

  await Promise.all([
    ari(`/ari/bridges/${bridge2.id}/record?name=${rec2Bridge}&format=wav&maxDurationSeconds=15&ifExists=overwrite`, 'POST'),
    ari(`/ari/channels/${snoopC2.id}/record?name=${rec2CallerRx}&format=wav&maxDurationSeconds=15&ifExists=overwrite`, 'POST'),
    ari(`/ari/channels/${snoopB2.id}/record?name=${rec2BuyerRx}&format=wav&maxDurationSeconds=15&ifExists=overwrite`, 'POST')
  ]);
  console.log(`Call 2 Recordings initiated: Bridge=${rec2Bridge}, CallerRX=${rec2CallerRx}, BuyerRX=${rec2BuyerRx}`);

  // 4. Concurrency & Isolation Audit Snapshot
  console.log('\n--- PHASE 4: CONCURRENCY & ISOLATION SNAPSHOT AUDIT ---');
  const activeBridges = await ari('/ari/bridges');
  const activeChannels = await ari('/ari/channels');
  console.log(`Live Active Bridges: ${activeBridges.length}`);
  console.log(`Live Active Channels: ${activeChannels.length}`);

  const br1Data = await ari(`/ari/bridges/${bridge1.id}`);
  const br2Data = await ari(`/ari/bridges/${bridge2.id}`);
  console.log(`Bridge 1 membership: ${JSON.stringify(br1Data.channels)}`);
  console.log(`Bridge 2 membership: ${JSON.stringify(br2Data.channels)}`);

  // Verify zero cross-connection between Bridge 1 and Bridge 2
  const br1ChSet = new Set(br1Data.channels);
  const br2ChSet = new Set(br2Data.channels);
  const crossConnected = [...br1ChSet].filter(x => br2ChSet.has(x));
  console.log(`Bridge membership intersection: ${JSON.stringify(crossConnected)} (Must be empty)`);
  if (crossConnected.length > 0) {
    throw new Error(`CRITICAL FAILURE: Bridge cross-connection detected! Channels: ${JSON.stringify(crossConnected)}`);
  }

  // 5. Simultaneous Bidirectional Media Injection (Injected via Far-End Channels)
  console.log('\n--- PHASE 5: SIMULTANEOUS BIDIRECTIONAL MEDIA INJECTION ---');
  console.log('Injecting 4 distinguishable synthetic audio markers concurrently via Far-End TX channels:');
  console.log(` - Call 1 Caller TX (FarEnd ${c1_farEnd.id}): 700 Hz (qa-caller1-700hz)`);
  console.log(` - Call 1 Buyer  TX (FarEnd ${b1_farEnd.id}): 1000 Hz (qa-buyer1-1000hz)`);
  console.log(` - Call 2 Caller TX (FarEnd ${c2_farEnd.id}): 1400 Hz (qa-caller2-1400hz)`);
  console.log(` - Call 2 Buyer  TX (FarEnd ${b2_farEnd.id}): 1800 Hz (qa-buyer2-1800hz)`);

  const tPlayStart = Date.now();
  const playbacks = await Promise.all([
    ari(`/ari/channels/${c1_farEnd.id}/play?media=sound:/var/lib/asterisk/sounds/qa/qa-caller1-700hz`, 'POST'),
    ari(`/ari/channels/${b1_farEnd.id}/play?media=sound:/var/lib/asterisk/sounds/qa/qa-buyer1-1000hz`, 'POST'),
    ari(`/ari/channels/${c2_farEnd.id}/play?media=sound:/var/lib/asterisk/sounds/qa/qa-caller2-1400hz`, 'POST'),
    ari(`/ari/channels/${b2_farEnd.id}/play?media=sound:/var/lib/asterisk/sounds/qa/qa-buyer2-1800hz`, 'POST')
  ]);
  console.log(`All 4 playbacks launched: IDs=[${playbacks.map(p => p.id).join(', ')}]`);

  // Await playbacks to finish (3.0s tones)
  console.log('Awaiting playback completion across all concurrent streams...');
  await new Promise(r => setTimeout(r, 4000));
  const playDuration = Date.now() - tPlayStart;
  console.log(`Playback phase elapsed time: ${playDuration}ms`);

  // 6. Staggered Termination Step 1 — Terminate Call 1 while Call 2 remains ACTIVE
  console.log('\n--- PHASE 6: STAGGERED TERMINATION — TERMINATING CALL 1 ---');
  console.log('Stopping Call 1 recordings...');
  await Promise.all([
    ari(`/ari/recordings/live/${rec1Bridge}/stop`, 'POST').catch(() => {}),
    ari(`/ari/recordings/live/${rec1CallerRx}/stop`, 'POST').catch(() => {}),
    ari(`/ari/recordings/live/${rec1BuyerRx}/stop`, 'POST').catch(() => {})
  ]);

  console.log('Tearing down Call 1 channels and bridge...');
  await Promise.all([
    ari(`/ari/channels/${snoopC1.id}`, 'DELETE').catch(() => {}),
    ari(`/ari/channels/${snoopB1.id}`, 'DELETE').catch(() => {})
  ]);
  await Promise.all([
    ari(`/ari/channels/${c1_bridge.id}`, 'DELETE').catch(() => {}),
    ari(`/ari/channels/${b1_bridge.id}`, 'DELETE').catch(() => {})
  ]);
  await ari(`/ari/bridges/${bridge1.id}`, 'DELETE').catch(() => {});
  console.log('Call 1 teardown completed.');

  // 7. Verify Call 2 Independence during Call 1 termination
  console.log('\n--- PHASE 7: CALL 2 RESILIENCE & INDEPENDENCE VERIFICATION ---');
  await new Promise(r => setTimeout(r, 1500));
  const midBridges = await ari('/ari/bridges');
  const midChannels = await ari('/ari/channels');
  console.log(`Post-Call 1 Teardown — Active Bridges: ${midBridges.length} (Expected: 1)`);
  console.log(`Post-Call 1 Teardown — Active Channels: ${midChannels.length}`);

  const br2Remaining = midBridges.find(b => b.id === bridge2.id);
  if (!br2Remaining) {
    throw new Error('CRITICAL FAILURE: Bridge 2 was disrupted or terminated prematurely by Call 1 teardown!');
  }
  console.log(`CONFIRMED: Bridge 2 (${bridge2.id}) is ACTIVE and UNINTERRUPTED with channels: ${JSON.stringify(br2Remaining.channels)}`);

  // 8. Staggered Termination Step 2 — Terminate Call 2
  console.log('\n--- PHASE 8: TERMINATING CALL 2 ---');
  console.log('Stopping Call 2 recordings...');
  await Promise.all([
    ari(`/ari/recordings/live/${rec2Bridge}/stop`, 'POST').catch(() => {}),
    ari(`/ari/recordings/live/${rec2CallerRx}/stop`, 'POST').catch(() => {}),
    ari(`/ari/recordings/live/${rec2BuyerRx}/stop`, 'POST').catch(() => {})
  ]);

  console.log('Tearing down Call 2 channels and bridge...');
  await Promise.all([
    ari(`/ari/channels/${snoopC2.id}`, 'DELETE').catch(() => {}),
    ari(`/ari/channels/${snoopB2.id}`, 'DELETE').catch(() => {})
  ]);
  await Promise.all([
    ari(`/ari/channels/${c2_bridge.id}`, 'DELETE').catch(() => {}),
    ari(`/ari/channels/${b2_bridge.id}`, 'DELETE').catch(() => {})
  ]);
  await ari(`/ari/bridges/${bridge2.id}`, 'DELETE').catch(() => {});
  console.log('Call 2 teardown completed.');

  // 9. Post-test cleanup audit
  console.log('\n--- PHASE 9: POST-TEST RESOURCE CLEANUP AUDIT ---');
  await new Promise(r => setTimeout(r, 1000));
  const finalChannels = await ari('/ari/channels');
  const finalBridges = await ari('/ari/bridges');
  console.log(`Final Active Channels: ${finalChannels.length} (Must be 0)`);
  console.log(`Final Active Bridges: ${finalBridges.length} (Must be 0)`);
  if (finalChannels.length > 0 || finalBridges.length > 0) {
    throw new Error(`Orphaned resources detected! Channels=${finalChannels.length}, Bridges=${finalBridges.length}`);
  }
  console.log('Zero orphaned channels or bridges confirmed.');

  // 10. Download & Forensic Analysis of All 6 Recordings
  console.log('\n--- PHASE 10: FORENSIC AUDIO ANALYSIS & CROSS-CONTAMINATION PROOF ---');
  const recNames = [
    { name: rec1Bridge, label: 'Call 1 Bridge Mix', expectedFreqs: [700, 1000], forbiddenFreqs: [1400, 1800] },
    { name: rec1CallerRx, label: 'Call 1 Caller RX (Hears Buyer 1000 Hz)', expectedFreqs: [1000], forbiddenFreqs: [700, 1400, 1800] },
    { name: rec1BuyerRx, label: 'Call 1 Buyer RX (Hears Caller 700 Hz)', expectedFreqs: [700], forbiddenFreqs: [1000, 1400, 1800] },
    { name: rec2Bridge, label: 'Call 2 Bridge Mix', expectedFreqs: [1400, 1800], forbiddenFreqs: [700, 1000] },
    { name: rec2CallerRx, label: 'Call 2 Caller RX (Hears Buyer 1800 Hz)', expectedFreqs: [1800], forbiddenFreqs: [1400, 700, 1000] },
    { name: rec2BuyerRx, label: 'Call 2 Buyer RX (Hears Caller 1400 Hz)', expectedFreqs: [1400], forbiddenFreqs: [1800, 700, 1000] }
  ];

  const analysisResults = [];
  const freqList = [700, 1000, 1400, 1800];

  for (const r of recNames) {
    console.log(`\nAnalyzing ${r.label} (${r.name})...`);
    const fileRes = await fetch(`${ARI_BASE}/ari/recordings/stored/${r.name}/file`, { headers: { Authorization: AUTH } });
    if (!fileRes.ok) throw new Error(`Failed to download recording ${r.name}: ${fileRes.status}`);

    const wavBuf = Buffer.from(await fileRes.arrayBuffer());
    const diskPath = path.join(outputDir, `${r.name}.wav`);
    fs.writeFileSync(diskPath, wavBuf);
    console.log(` - Saved to disk: ${diskPath} (${wavBuf.length} bytes)`);

    const parsed = parseWav(wavBuf);
    console.log(` - Format: ${parsed.sampleRate}Hz, ${parsed.bitsPerSample}-bit, duration=${parsed.durationSeconds.toFixed(2)}s, samples=${parsed.sampleCount}`);

    const powers = {};
    const powersDb = {};
    for (const f of freqList) {
      const p = goertzelPower(parsed.samples, parsed.sampleRate, f);
      powers[f] = p;
      powersDb[f] = toDb(p);
    }

    console.log(` - Spectral Power Profile:`);
    for (const f of freqList) {
      const isExp = r.expectedFreqs.includes(f) ? '[EXPECTED]' : '[FORBIDDEN]';
      console.log(`   * ${f} Hz: ${powersDb[f].toFixed(1)} dB (Power: ${powers[f].toExponential(3)}) ${isExp}`);
    }

    // Evaluate expected vs forbidden power
    const minExpectedPower = Math.min(...r.expectedFreqs.map(f => powers[f]));
    const maxForbiddenPower = Math.max(...r.forbiddenFreqs.map(f => powers[f]));
    const isolationRatioDb = toDb(minExpectedPower) - toDb(maxForbiddenPower);

    const validDuration = parsed.durationSeconds >= 2.0;
    const tonesPresent = r.expectedFreqs.every(f => powersDb[f] > -40); // Standard detection threshold
    const isolationClean = isolationRatioDb >= 15.0; // At least 15 dB separation from forbidden frequencies

    console.log(` - Metric: Min Expected Tone Power = ${toDb(minExpectedPower).toFixed(1)} dB`);
    console.log(` - Metric: Max Forbidden Power (Cross-talk) = ${toDb(maxForbiddenPower).toFixed(1)} dB`);
    console.log(` - Metric: Isolation / Discrimination Margin = ${isolationRatioDb.toFixed(1)} dB (Pass >= 15 dB)`);

    analysisResults.push({
      recording: r.name,
      label: r.label,
      bytes: wavBuf.length,
      durationSeconds: parsed.durationSeconds,
      powersDb,
      isolationRatioDb,
      validDuration,
      tonesPresent,
      isolationClean,
      passed: validDuration && tonesPresent && isolationClean
    });
  }

  // Cleanup stored recordings on Asterisk
  console.log('\nCleaning up stored recordings from Asterisk container...');
  for (const r of recNames) {
    await ari(`/ari/recordings/stored/${r.name}`, 'DELETE').catch(() => {});
  }

  ws.close();

  // 11. Final Audit Verdict
  console.log('\n================================================================');
  console.log('QA-2E MEDIA CONCURRENCY VERIFICATION SUMMARY');
  console.log('================================================================');
  let allPassed = true;
  for (const res of analysisResults) {
    const status = res.passed ? 'PASS' : 'FAIL';
    if (!res.passed) allPassed = false;
    console.log(`[${status}] ${res.label}: Dur=${res.durationSeconds.toFixed(2)}s, IsoMargin=${res.isolationRatioDb.toFixed(1)}dB`);
  }

  const finalReport = {
    test: 'QA-2E: LOCAL ASTERISK MEDIA CONCURRENCY',
    runId,
    timestamp: startTime,
    activeCallsTested: 2,
    call1: {
      callerBridgeLeg: c1_bridge.id,
      callerFarEnd: c1_farEnd.id,
      buyerBridgeLeg: b1_bridge.id,
      buyerFarEnd: b1_farEnd.id,
      bridgeId: bridge1.id,
      tones: { callerTx: 700, buyerTx: 1000 }
    },
    call2: {
      callerBridgeLeg: c2_bridge.id,
      callerFarEnd: c2_farEnd.id,
      buyerBridgeLeg: b2_bridge.id,
      buyerFarEnd: b2_farEnd.id,
      bridgeId: bridge2.id,
      tones: { callerTx: 1400, buyerTx: 1800 }
    },
    results: analysisResults,
    staggeredTeardownPassed: true,
    zeroOrphanedResources: true,
    verdict: allPassed ? 'PASS' : 'FAIL'
  };

  const auditJsonPath = path.resolve('qa/evidence/qa-2e-concurrency-audit.json');
  fs.writeFileSync(auditJsonPath, JSON.stringify(finalReport, null, 2));
  console.log(`\nAudit JSON saved to: ${auditJsonPath}`);
  console.log(`FINAL VERDICT: ${finalReport.verdict}`);

  if (!allPassed) {
    process.exit(1);
  }
}

runLocalMediaConcurrencyTest().catch(err => {
  console.error('\n[FATAL ERROR in QA-2E]:', err);
  process.exit(1);
});
