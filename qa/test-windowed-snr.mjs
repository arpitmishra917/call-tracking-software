import fs from 'fs';
import path from 'path';

function testWindowedSnr(wavPath, targetFreq) {
  const buf = fs.readFileSync(wavPath);
  let pos = 12;
  let dataOffset = -1;
  let dataSize = 0;
  while (pos < buf.length - 8) {
    const chunkId = buf.toString('ascii', pos, pos + 4);
    const chunkSize = buf.readUInt32LE(pos + 4);
    if (chunkId === 'data') {
      dataOffset = pos + 8;
      dataSize = chunkSize;
      break;
    }
    pos += 8 + chunkSize;
  }

  const sampleCount = dataSize / 2;
  const samples = new Float64Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    samples[i] = buf.readInt16LE(dataOffset + i * 2) / 32768.0;
  }

  // 1. Full file SNR (current QaAudioAnalyzerService implementation)
  const N = sampleCount;
  let totalPower = 0;
  for (let i = 0; i < N; i++) totalPower += samples[i] * samples[i];
  totalPower /= N;

  const k = Math.round((N * targetFreq) / 8000);
  const coeff = 2.0 * Math.cos((2.0 * Math.PI * k) / N);
  let s0 = 0, s1 = 0, s2 = 0;
  for (let i = 0; i < N; i++) {
    s0 = samples[i] + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  const tonePower = ((s1 * s1 + s2 * s2 - coeff * s1 * s2) * 2.0) / (N * N);
  const noisePower = Math.max(1e-12, totalPower - tonePower);
  const fullSnr = 10.0 * Math.log10(tonePower / noisePower);

  // 2. Active Window SNR (sliding window of 1600 samples / 200ms)
  const winSize = 1600; // 200ms
  let maxWinSnr = -100;
  let bestWindow = 0;
  for (let start = 0; start <= N - winSize; start += 400) {
    let winTotPower = 0;
    for (let i = 0; i < winSize; i++) winTotPower += samples[start + i] * samples[start + i];
    winTotPower /= winSize;
    if (winTotPower < 1e-6) continue;

    const winK = Math.round((winSize * targetFreq) / 8000);
    const winCoeff = 2.0 * Math.cos((2.0 * Math.PI * winK) / winSize);
    let ws0 = 0, ws1 = 0, ws2 = 0;
    for (let i = 0; i < winSize; i++) {
      ws0 = samples[start + i] + winCoeff * ws1 - ws2;
      ws2 = ws1;
      ws1 = ws0;
    }
    const winTonePower = ((ws1 * ws1 + ws2 * ws2 - winCoeff * ws1 * ws2) * 2.0) / (winSize * winSize);
    const winNoise = Math.max(1e-12, winTotPower - winTonePower);
    const winSnr = 10.0 * Math.log10(winTonePower / winNoise);
    if (winSnr > maxWinSnr) {
      maxWinSnr = winSnr;
      bestWindow = start;
    }
  }

  console.log(`\n=== Windowed vs Full Analysis for ${path.basename(wavPath)} ===`);
  console.log(`Target Frequency: ${targetFreq} Hz`);
  console.log(`Full file Goertzel SNR: ${fullSnr.toFixed(2)} dB (diluted by silence)`);
  console.log(`Active Window Goertzel SNR (200ms window @ sample ${bestWindow}): ${maxWinSnr.toFixed(2)} dB`);
}

testWindowedSnr('qa/recordings/qa-caller-0a06cf5b-e951-493e-bad5-4ac0a442960a.wav', 1500);
testWindowedSnr('qa/recordings/qa-buyer-0a06cf5b-e951-493e-bad5-4ac0a442960a.wav', 1000);
