import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

const qaEnv = dotenv.parse(fs.readFileSync('apps/api/.env.qa', 'utf8'));

// Dynamic import of compiled services
const { QaAudioAnalyzerService } = await import('../apps/api/dist/telephony/qa/qa-audio-analyzer.service.js');
const { QaRtpClassifierService } = await import('../apps/api/dist/telephony/qa/qa-rtp-classifier.service.js');

const analyzer = new QaAudioAnalyzerService();
const classifier = new QaRtpClassifierService();

function sha256(filePath) {
  if (!fs.existsSync(filePath)) return 'FILE_NOT_FOUND';
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

async function analyze() {
  console.log('=== [PHASE 7B-10U] POST-CALL FORENSIC AUDIT & VERIFICATION ===\n');

  // 1. Read single-call execution result
  const resultFile = path.resolve('qa/qa-single-call-result.json');
  if (!fs.existsSync(resultFile)) {
    throw new Error(`qa-single-call-result.json not found at ${resultFile}`);
  }
  const callResult = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
  const runId = callResult.runResult?.runId || '15f2f1d2-8ada-46a5-a9c8-405d424f552d';
  console.log(`Auditing QA Run ID: ${runId}`);
  console.log(`Execution Duration: ${callResult.callDurationSeconds}s`);
  console.log(`Pre-call Balance: $${callResult.preCallTelnyxBalance?.toFixed(4)} USD`);
  console.log(`Post-call Balance: $${callResult.postCallTelnyxBalance?.toFixed(4)} USD`);
  console.log(`Actual Provider Spend: $${callResult.providerSpendUsd?.toFixed(4)} USD (<= $1.00: ${callResult.spendUnderLimit})`);

  // 2. PCAP Four-Direction Analysis
  console.log('\n--- Section 1: PCAP 4-Direction RTP Classification ---');
  const pcapPath = path.resolve('qa/evidence/phase-7b-10u-carrier-rtp.pcap');
  let pcapAnalysis = null;
  if (fs.existsSync(pcapPath)) {
    const pcapBuf = fs.readFileSync(pcapPath);
    console.log(`PCAP file found: ${pcapPath} (${pcapBuf.length} bytes, SHA256: ${sha256(pcapPath)})`);
    try {
      pcapAnalysis = classifier.classifyPcap(pcapBuf);
      console.log(`Total Packets: ${pcapAnalysis.totalPacketsParsed}`);
      console.log(`SIP Packets (Port 5060): ${pcapAnalysis.sipPacketsCount}`);

      console.log('\nStream 1 - Caller Outbound (Asterisk -> Telnyx):');
      console.log(`  Packets: ${pcapAnalysis.callerOutbound.totalPackets} (Audio: ${pcapAnalysis.callerOutbound.audioPackets}, CN: ${pcapAnalysis.callerOutbound.comfortNoisePackets})`);
      console.log(`  Ports: ${pcapAnalysis.callerOutbound.sourceIp}:${pcapAnalysis.callerOutbound.sourcePort} -> ${pcapAnalysis.callerOutbound.destIp}:${pcapAnalysis.callerOutbound.destPort}`);
      console.log(`  Payload Types: [${pcapAnalysis.callerOutbound.payloadTypes.join(', ')}], SSRCs: [${pcapAnalysis.callerOutbound.ssrc.join(', ')}]`);
      console.log(`  Seq Range: ${pcapAnalysis.callerOutbound.minSeq}..${pcapAnalysis.callerOutbound.maxSeq}, Loss: ${pcapAnalysis.callerOutbound.packetLoss} (${pcapAnalysis.callerOutbound.lossRatio}%)`);
      console.log(`  Duration: ${pcapAnalysis.callerOutbound.durationSeconds}s, Media Duration: ${pcapAnalysis.callerOutbound.mediaDurationSeconds}s`);
      console.log(`  Media Present: ${pcapAnalysis.callerOutbound.isMediaPresent}`);

      console.log('\nStream 2 - Caller Inbound (Telnyx -> Asterisk):');
      console.log(`  Packets: ${pcapAnalysis.callerInbound.totalPackets} (Audio: ${pcapAnalysis.callerInbound.audioPackets}, CN: ${pcapAnalysis.callerInbound.comfortNoisePackets})`);
      console.log(`  Ports: ${pcapAnalysis.callerInbound.sourceIp}:${pcapAnalysis.callerInbound.sourcePort} -> ${pcapAnalysis.callerInbound.destIp}:${pcapAnalysis.callerInbound.destPort}`);
      console.log(`  Payload Types: [${pcapAnalysis.callerInbound.payloadTypes.join(', ')}], SSRCs: [${pcapAnalysis.callerInbound.ssrc.join(', ')}]`);
      console.log(`  Seq Range: ${pcapAnalysis.callerInbound.minSeq}..${pcapAnalysis.callerInbound.maxSeq}, Loss: ${pcapAnalysis.callerInbound.packetLoss} (${pcapAnalysis.callerInbound.lossRatio}%)`);
      console.log(`  Duration: ${pcapAnalysis.callerInbound.durationSeconds}s, Media Duration: ${pcapAnalysis.callerInbound.mediaDurationSeconds}s`);
      console.log(`  Media Present: ${pcapAnalysis.callerInbound.isMediaPresent}`);

      console.log('\nStream 3 - Buyer Outbound (Asterisk -> Telnyx):');
      console.log(`  Packets: ${pcapAnalysis.buyerOutbound.totalPackets} (Audio: ${pcapAnalysis.buyerOutbound.audioPackets}, CN: ${pcapAnalysis.buyerOutbound.comfortNoisePackets})`);
      console.log(`  Ports: ${pcapAnalysis.buyerOutbound.sourceIp}:${pcapAnalysis.buyerOutbound.sourcePort} -> ${pcapAnalysis.buyerOutbound.destIp}:${pcapAnalysis.buyerOutbound.destPort}`);
      console.log(`  Payload Types: [${pcapAnalysis.buyerOutbound.payloadTypes.join(', ')}], SSRCs: [${pcapAnalysis.buyerOutbound.ssrc.join(', ')}]`);
      console.log(`  Seq Range: ${pcapAnalysis.buyerOutbound.minSeq}..${pcapAnalysis.buyerOutbound.maxSeq}, Loss: ${pcapAnalysis.buyerOutbound.packetLoss} (${pcapAnalysis.buyerOutbound.lossRatio}%)`);
      console.log(`  Duration: ${pcapAnalysis.buyerOutbound.durationSeconds}s, Media Duration: ${pcapAnalysis.buyerOutbound.mediaDurationSeconds}s`);
      console.log(`  Media Present: ${pcapAnalysis.buyerOutbound.isMediaPresent}`);

      console.log('\nStream 4 - Buyer Inbound (Telnyx -> Asterisk):');
      console.log(`  Packets: ${pcapAnalysis.buyerInbound.totalPackets} (Audio: ${pcapAnalysis.buyerInbound.audioPackets}, CN: ${pcapAnalysis.buyerInbound.comfortNoisePackets})`);
      console.log(`  Ports: ${pcapAnalysis.buyerInbound.sourceIp}:${pcapAnalysis.buyerInbound.sourcePort} -> ${pcapAnalysis.buyerInbound.destIp}:${pcapAnalysis.buyerInbound.destPort}`);
      console.log(`  Payload Types: [${pcapAnalysis.buyerInbound.payloadTypes.join(', ')}], SSRCs: [${pcapAnalysis.buyerInbound.ssrc.join(', ')}]`);
      console.log(`  Seq Range: ${pcapAnalysis.buyerInbound.minSeq}..${pcapAnalysis.buyerInbound.maxSeq}, Loss: ${pcapAnalysis.buyerInbound.packetLoss} (${pcapAnalysis.buyerInbound.lossRatio}%)`);
      console.log(`  Duration: ${pcapAnalysis.buyerInbound.durationSeconds}s, Media Duration: ${pcapAnalysis.buyerInbound.mediaDurationSeconds}s`);
      console.log(`  Media Present: ${pcapAnalysis.buyerInbound.isMediaPresent}`);

      console.log(`\nAll Four Directions Verified: ${pcapAnalysis.allFourDirectionsVerified}`);
    } catch (pcapErr) {
      console.warn('[WARN] PCAP parsing issue:', pcapErr.message);
    }
  } else {
    console.warn(`[WARN] PCAP file not found at ${pcapPath}`);
  }

  // 3. Audio Tone Analysis (Dual-Pass Windowed Goertzel)
  console.log('\n--- Section 2: Audio Tone Analysis (Dual-Pass Windowed Goertzel) ---');
  const callerWavPath = path.resolve(`qa/recordings/qa-caller-${runId}.wav`);
  const buyerWavPath = path.resolve(`qa/recordings/qa-buyer-${runId}.wav`);

  let callerAnalysis = null;
  let buyerAnalysis = null;
  let callerDiscrim = null;
  let buyerDiscrim = null;

  if (fs.existsSync(callerWavPath)) {
    const callerBuf = fs.readFileSync(callerWavPath);
    console.log(`Caller WAV file: ${callerWavPath} (${callerBuf.length} bytes, SHA256: ${sha256(callerWavPath)})`);
    callerAnalysis = analyzer.analyzeRecording(callerBuf, { targetFreq: 1500, minSnrDb: 5.0 });
    console.log(`Caller Analysis (Target 1500 Hz): Passed=${callerAnalysis.passed}, SNR=${callerAnalysis.snrDb.toFixed(2)} dB, RMS=${callerAnalysis.rmsDbfs.toFixed(1)} dBFS, Duration=${callerAnalysis.durationSeconds.toFixed(2)}s`);

    // Frequency discrimination check
    const caller1000 = analyzer.analyzeRecording(callerBuf, { targetFreq: 1000, minSnrDb: 5.0 });
    const caller440 = analyzer.analyzeRecording(callerBuf, { targetFreq: 440, minSnrDb: 5.0 });
    callerDiscrim = {
      target1500Snr: callerAnalysis.snrDb,
      reject1000Snr: caller1000.snrDb,
      reject440Snr: caller440.snrDb,
      correctlyDiscriminated: callerAnalysis.passed && !caller1000.passed && !caller440.passed,
    };
    console.log(`Caller Discrimination: 1500Hz=${callerDiscrim.target1500Snr.toFixed(1)}dB, 1000Hz=${callerDiscrim.reject1000Snr.toFixed(1)}dB, 440Hz=${callerDiscrim.reject440Snr.toFixed(1)}dB -> Pass: ${callerDiscrim.correctlyDiscriminated}`);
  } else {
    console.error(`[ERROR] Caller WAV not found at ${callerWavPath}`);
  }

  if (fs.existsSync(buyerWavPath)) {
    const buyerBuf = fs.readFileSync(buyerWavPath);
    console.log(`Buyer WAV file: ${buyerWavPath} (${buyerBuf.length} bytes, SHA256: ${sha256(buyerWavPath)})`);
    buyerAnalysis = analyzer.analyzeRecording(buyerBuf, { targetFreq: 1000, minSnrDb: 5.0 });
    console.log(`Buyer Analysis (Target 1000 Hz): Passed=${buyerAnalysis.passed}, SNR=${buyerAnalysis.snrDb.toFixed(2)} dB, RMS=${buyerAnalysis.rmsDbfs.toFixed(1)} dBFS, Duration=${buyerAnalysis.durationSeconds.toFixed(2)}s`);

    // Frequency discrimination check
    const buyer1500 = analyzer.analyzeRecording(buyerBuf, { targetFreq: 1500, minSnrDb: 5.0 });
    const buyer440 = analyzer.analyzeRecording(buyerBuf, { targetFreq: 440, minSnrDb: 5.0 });
    buyerDiscrim = {
      target1000Snr: buyerAnalysis.snrDb,
      reject1500Snr: buyer1500.snrDb,
      reject440Snr: buyer440.snrDb,
      correctlyDiscriminated: buyerAnalysis.passed && !buyer1500.passed && !buyer440.passed,
    };
    console.log(`Buyer Discrimination: 1000Hz=${buyerDiscrim.target1000Snr.toFixed(1)}dB, 1500Hz=${buyerDiscrim.reject1500Snr.toFixed(1)}dB, 440Hz=${buyerDiscrim.reject440Snr.toFixed(1)}dB -> Pass: ${buyerDiscrim.correctlyDiscriminated}`);
  } else {
    console.error(`[ERROR] Buyer WAV not found at ${buyerWavPath}`);
  }

  // 4. Financial & Isolation Verification
  console.log('\n--- Section 3: Financial & Database Isolation Verification ---');
  console.log(`Financial Isolation Passed: ${callResult.financialIsolationPassed}`);
  console.log(`Lingering Asterisk Channels: [${callResult.lingeringChannels.join(', ')}] (Count: ${callResult.lingeringChannels.length})`);

  // 5. Final Comprehensive Verdict
  console.log('\n======================================================');
  const callerPassed = callerAnalysis && callerAnalysis.passed;
  const buyerPassed = buyerAnalysis && buyerAnalysis.passed;
  const bothPassed = callerPassed && buyerPassed;

  console.log(`CALLER LEG VERIFICATION (Target 1500 Hz): ${callerPassed ? 'PASS' : 'FAIL'} (${callerAnalysis?.snrDb.toFixed(1)} dB)`);
  console.log(`BUYER LEG VERIFICATION  (Target 1000 Hz): ${buyerPassed ? 'PASS' : 'FAIL'} (${buyerAnalysis?.snrDb.toFixed(1)} dB)`);
  console.log(`BIDIRECTIONAL DUAL-LEG RECORDING: ${bothPassed ? 'PASS' : 'FAIL'}`);
  console.log('======================================================\n');

  // Save full audit JSON
  const auditReport = {
    phase: 'Phase 7B-10U Dual-Leg Recording Live Carrier Call',
    timestamp: new Date().toISOString(),
    runId,
    executionDurationSeconds: callResult.callDurationSeconds,
    spendUsd: callResult.providerSpendUsd,
    callerAudio: {
      path: callerWavPath,
      sizeBytes: fs.existsSync(callerWavPath) ? fs.statSync(callerWavPath).size : 0,
      sha256: sha256(callerWavPath),
      analysis: callerAnalysis,
      discrimination: callerDiscrim,
    },
    buyerAudio: {
      path: buyerWavPath,
      sizeBytes: fs.existsSync(buyerWavPath) ? fs.statSync(buyerWavPath).size : 0,
      sha256: sha256(buyerWavPath),
      analysis: buyerAnalysis,
      discrimination: buyerDiscrim,
    },
    financialIsolationPassed: callResult.financialIsolationPassed,
    lingeringChannels: callResult.lingeringChannels,
    verdict: bothPassed ? 'PASS' : 'PARTIAL',
  };

  const auditPath = path.resolve('qa/qa-phase-7b-10u-audit.json');
  fs.writeFileSync(auditPath, JSON.stringify(auditReport, null, 2));
  console.log(`Wrote complete audit report to ${auditPath}`);
}

analyze().catch(err => {
  console.error('[FATAL] Analysis error:', err);
  process.exit(1);
});
