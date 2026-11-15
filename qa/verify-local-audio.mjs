import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

// Import compiled QaAudioAnalyzerService
const { QaAudioAnalyzerService } = await import('../apps/api/dist/telephony/qa/qa-audio-analyzer.service.js');
const analyzer = new QaAudioAnalyzerService();

const qaEnv = dotenv.parse(fs.readFileSync('apps/api/.env.qa', 'utf8'));
const ariUser = qaEnv.TELEPHONY_QA_ARI_USERNAME || 'callflow_qa';
const ariPass = qaEnv.TELEPHONY_QA_ARI_PASSWORD || 'cfqa_ari_1f044860de198dfa6fd829c7a40f23cbe9ae09b6';
const ariAuth = Buffer.from(`${ariUser}:${ariPass}`).toString('base64');
const ariBase = 'http://127.0.0.1:8088/ari';
const ariWsUrl = `ws://127.0.0.1:8088/ari/events?app=callflow-qa&api_key=${ariUser}:${ariPass}`;

async function testTone(extension, targetFreq, recName) {
  console.log(`\n--- [TEST] Starting local channel audio verification for ${targetFreq} Hz (exten ${extension}) ---`);
  
  return new Promise(async (resolve, reject) => {
    let ws;
    let channelId = null;
    let recordingStarted = false;

    const timeout = setTimeout(() => {
      if (ws) ws.close();
      reject(new Error(`Test timed out after 15s for ${recName}`));
    }, 15000);

    try {
      ws = new WebSocket(ariWsUrl);

      ws.onopen = async () => {
        console.log(`[WS] Connected to Asterisk ARI WebSocket`);

        // Originate Local channel into Stasis
        console.log(`[ARI] Originating Local/${extension}@local-audio-test into Stasis(callflow-qa)...`);
        const res = await fetch(`${ariBase}/channels?endpoint=Local/${extension}@local-audio-test&app=callflow-qa&appArgs=local-test-${extension}`, {
          method: 'POST',
          headers: { Authorization: `Basic ${ariAuth}` },
        });

        if (!res.ok) {
          const err = await res.text();
          clearTimeout(timeout);
          ws.close();
          return reject(new Error(`Originate failed: HTTP ${res.status}: ${err}`));
        }

        const ch = await res.json();
        channelId = ch.id;
        console.log(`[ARI] Channel created with ID: ${channelId}`);
      };

      ws.onmessage = async (msgEvent) => {
        try {
          const event = JSON.parse(msgEvent.data.toString());

          if (event.type === 'StasisStart' && !recordingStarted) {
            const chId = event.channel?.id;
            console.log(`[ARI Event] StasisStart received on channel ${chId}`);

            // Start recording on this channel
            console.log(`[ARI] Starting recording "${recName}" on channel ${chId}...`);
            const recRes = await fetch(`${ariBase}/channels/${encodeURIComponent(chId)}/record?name=${recName}&format=wav&maxSilenceSeconds=0&beep=false&ifExists=overwrite`, {
              method: 'POST',
              headers: { Authorization: `Basic ${ariAuth}` },
            });

            if (!recRes.ok) {
              const err = await recRes.text();
              console.error(`[ARI] Start record error: ${err}`);
            } else {
              recordingStarted = true;
              console.log(`[ARI] Recording request accepted for "${recName}"`);
            }
          }

          if (event.type === 'RecordingFinished' && event.recording?.name === recName) {
            console.log(`[ARI Event] RecordingFinished for "${recName}": duration=${event.recording.duration}s`);
          }

          if (event.type === 'StasisEnd') {
            console.log(`[ARI Event] StasisEnd on channel ${event.channel?.id}`);
            
            // Wait 1 second for Asterisk to flush file to disk
            await new Promise(r => setTimeout(r, 1000));
            
            // Download stored recording
            console.log(`[ARI] Downloading stored recording "${recName}"...`);
            const dlRes = await fetch(`${ariBase}/recordings/stored/${recName}/file`, {
              headers: { Authorization: `Basic ${ariAuth}` },
            });

            if (!dlRes.ok) {
              const err = await dlRes.text();
              clearTimeout(timeout);
              ws.close();
              return reject(new Error(`Failed to download recording: HTTP ${dlRes.status}: ${err}`));
            }

            const arrayBuf = await dlRes.arrayBuffer();
            const wavBuffer = Buffer.from(arrayBuf);
            console.log(`[WAV] Successfully retrieved WAV buffer: ${wavBuffer.length} bytes`);

            // Save to disk
            const outPath = path.resolve(`qa/recordings/${recName}.wav`);
            fs.writeFileSync(outPath, wavBuffer);
            console.log(`[DISK] Saved WAV to ${outPath}`);

            // Analyze WAV
            const analysis = analyzer.analyzeRecording(wavBuffer, {
              targetFreq,
              minSnrDb: 5.0,
              minDurationSecs: 1.5,
            });

            console.log(`[ANALYSIS RESULT for ${targetFreq} Hz]:`, JSON.stringify(analysis, null, 2));

            clearTimeout(timeout);
            ws.close();
            resolve({
              recName,
              targetFreq,
              bufferSize: wavBuffer.length,
              analysis,
            });
          }
        } catch (msgErr) {
          console.error('[WS Error] Error processing message:', msgErr);
        }
      };

      ws.onerror = (err) => {
        clearTimeout(timeout);
        reject(err);
      };
    } catch (err) {
      clearTimeout(timeout);
      reject(err);
    }
  });
}

async function run() {
  console.log('=== [PHASE 7B-10Q] LOCAL AUDIO & RECORDING LIFECYCLE VALIDATION ===');
  console.log('Zero Carrier Egress — 100% Internal Docker Loopback Test');

  // Test 1: 1000 Hz Caller Marker Loopback
  const res1000 = await testTone('1000', 1000, 'qa-local-test-1000');
  if (!res1000.analysis.passed) {
    throw new Error(`1000 Hz local loopback analysis failed: ${res1000.analysis.reasons.join('; ')}`);
  }
  console.log(`[PASS] 1000 Hz tone successfully captured! Buffer: ${res1000.bufferSize} bytes, SNR: ${res1000.analysis.snrDb.toFixed(1)} dB`);

  // Test 2: 1500 Hz Buyer Marker Loopback
  const res1500 = await testTone('1500', 1500, 'qa-local-test-1500');
  if (!res1500.analysis.passed) {
    throw new Error(`1500 Hz local loopback analysis failed: ${res1500.analysis.reasons.join('; ')}`);
  }
  console.log(`[PASS] 1500 Hz tone successfully captured! Buffer: ${res1500.bufferSize} bytes, SNR: ${res1500.analysis.snrDb.toFixed(1)} dB`);

  // Test 3: Validate strict rejection of empty 44-byte WAVs (Phase 10L and Phase 10P evidence)
  console.log('\n--- [TEST] Validating strict rejection of empty 44-byte WAV recordings ---');
  const emptyWavCandidates = [
    'qa/recordings/qa-caller-9fcded31-e61d-40bc-b4ad-7bd67d46d7a2.wav',
    'qa/evidence/phase-7b-10p/qa-caller-ac62dec0-9be5-4741-9926-8c208f81fcab.wav',
    'qa/evidence/phase-7b-10p/qa-buyer-ac62dec0-9be5-4741-9926-8c208f81fcab.wav',
    'qa/recordings/qa-caller-ac62dec0-9be5-4741-9926-8c208f81fcab.wav',
  ];

  let verifiedEmptyCount = 0;
  for (const emptyPath of emptyWavCandidates) {
    const fullPath = path.resolve(emptyPath);
    if (fs.existsSync(fullPath)) {
      const emptyBuf = fs.readFileSync(fullPath);
      console.log(`Checking ${emptyPath}: ${emptyBuf.length} bytes`);
      if (emptyBuf.length === 44) {
        const emptyAnalysis = analyzer.analyzeRecording(emptyBuf, { targetFreq: 1000 });
        if (emptyAnalysis.passed !== false || !emptyAnalysis.isSilent || emptyAnalysis.durationSeconds !== 0) {
          throw new Error(`Analyzer failed to reject 44-byte empty WAV at ${emptyPath}: passed=${emptyAnalysis.passed}`);
        }
        verifiedEmptyCount++;
        console.log(`[PASS] Verified strict rejection of 44-byte empty WAV: ${emptyPath}`);
      }
    }
  }

  if (verifiedEmptyCount === 0) {
    // Generate synthetic 44-byte empty WAV to ensure check always runs
    const synthetic44Byte = Buffer.from(
      '524946462400000057415645666d74201000000001000100401f0000803e0000020010006461746100000000',
      'hex',
    );
    const emptyAnalysis = analyzer.analyzeRecording(synthetic44Byte, { targetFreq: 1000 });
    if (emptyAnalysis.passed !== false || !emptyAnalysis.isSilent || emptyAnalysis.durationSeconds !== 0) {
      throw new Error('Analyzer failed to reject synthetic 44-byte empty WAV');
    }
    console.log('[PASS] Verified strict rejection of synthetic 44-byte empty WAV');
  } else {
    console.log(`[PASS] Confirmed rejection of ${verifiedEmptyCount} historical 44-byte empty recording(s)!`);
  }

  // Test 4: Validate recording duration and sample count integrity on valid recordings
  console.log('\n--- [TEST] Validating PCM sample count and duration integrity on valid recordings ---');
  const valid1000Buf = fs.readFileSync(path.resolve('qa/recordings/qa-local-test-1000.wav'));
  const parsed1000 = analyzer.parseWav(valid1000Buf);
  console.log(`qa-local-test-1000.wav: sampleRate=${parsed1000.metadata.sampleRate}, sampleCount=${parsed1000.metadata.sampleCount}, duration=${parsed1000.metadata.durationSeconds.toFixed(2)}s`);
  if (parsed1000.metadata.sampleCount <= 0 || parsed1000.metadata.durationSeconds <= 0) {
    throw new Error('Recorded file has invalid zero samples or duration');
  }
  console.log('[PASS] Recording contains valid non-zero PCM samples and duration!');

  console.log('\n=== ALL PHASE 7B-10Q LOCAL AUDIO & RECORDING VALIDATIONS PASSED! ===');
}

run().catch((err) => {
  console.error('[FATAL] Local validation failed:', err);
  process.exit(1);
});
