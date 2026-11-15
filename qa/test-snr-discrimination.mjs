import fs from 'fs';

function calculateWindowedSnr(samples, sampleRate, targetFreq) {
  const N = samples.length;
  if (N < 32 || sampleRate <= 0) return 0;

  // Total signal power across entire file
  let fullTotalPower = 0.0;
  for (let i = 0; i < N; i++) fullTotalPower += samples[i] * samples[i];
  fullTotalPower /= N;
  if (fullTotalPower <= 1e-12) return 0.0;

  // 1. Full-file Goertzel
  const kFull = Math.round((N * targetFreq) / sampleRate);
  const omegaFull = (2.0 * Math.PI * kFull) / N;
  const coeffFull = 2.0 * Math.cos(omegaFull);
  let fs0 = 0.0, fs1 = 0.0, fs2 = 0.0;
  for (let i = 0; i < N; i++) {
    fs0 = samples[i] + coeffFull * fs1 - fs2;
    fs2 = fs1;
    fs1 = fs0;
  }
  const fullTonePower = ((fs1 * fs1 + fs2 * fs2 - coeffFull * fs1 * fs2) * 2.0) / (N * N);
  const fullNoisePower = Math.max(1e-12, fullTotalPower - fullTonePower);
  const fullSnr = 10.0 * Math.log10(Math.max(1e-3, fullTonePower / fullNoisePower));

  // 2. Windowed Goertzel (100ms window, 25ms hop)
  const winSize = Math.min(N, Math.round(sampleRate * 0.1)); // 100ms
  if (winSize < 32) return fullSnr;

  const hopSize = Math.max(1, Math.round(winSize / 4)); // 25ms
  const kWin = Math.round((winSize * targetFreq) / sampleRate);
  const omegaWin = (2.0 * Math.PI * kWin) / winSize;
  const coeffWin = 2.0 * Math.cos(omegaWin);

  let maxWinSnr = -100.0;
  let activeWindows = 0;

  for (let start = 0; start <= N - winSize; start += hopSize) {
    let winTotPower = 0.0;
    for (let i = 0; i < winSize; i++) {
      winTotPower += samples[start + i] * samples[start + i];
    }
    winTotPower /= winSize;

    // Skip silent windows (< -50 dBFS = 1e-5)
    if (winTotPower < 1e-5) continue;
    activeWindows++;

    let ws0 = 0.0, ws1 = 0.0, ws2 = 0.0;
    for (let i = 0; i < winSize; i++) {
      ws0 = samples[start + i] + coeffWin * ws1 - ws2;
      ws2 = ws1;
      ws1 = ws0;
    }
    const winTonePower = ((ws1 * ws1 + ws2 * ws2 - coeffWin * ws1 * ws2) * 2.0) / (winSize * winSize);
    const winNoisePower = Math.max(1e-12, winTotPower - winTonePower);
    const winSnr = 10.0 * Math.log10(Math.max(1e-3, winTonePower / winNoisePower));

    if (winSnr > maxWinSnr) {
      maxWinSnr = winSnr;
    }
  }

  // If no active windows found (entire file below silence floor), return fullSnr
  if (activeWindows === 0) {
    return fullSnr;
  }

  // Return the maximum of windowed SNR and full-file SNR
  return Math.max(fullSnr, maxWinSnr);
}

function loadSamples(wavPath) {
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
  return samples;
}

const callerSamples = loadSamples('qa/recordings/qa-caller-0a06cf5b-e951-493e-bad5-4ac0a442960a.wav');
const buyerSamples = loadSamples('qa/recordings/qa-buyer-0a06cf5b-e951-493e-bad5-4ac0a442960a.wav');

console.log('Caller recording testing for 1500 Hz (CORRECT):', calculateWindowedSnr(callerSamples, 8000, 1500).toFixed(2), 'dB');
console.log('Caller recording testing for 1000 Hz (WRONG):  ', calculateWindowedSnr(callerSamples, 8000, 1000).toFixed(2), 'dB');
console.log('Caller recording testing for 440 Hz (WRONG):   ', calculateWindowedSnr(callerSamples, 8000, 440).toFixed(2), 'dB');

console.log('Buyer recording testing for 1000 Hz (CORRECT): ', calculateWindowedSnr(buyerSamples, 8000, 1000).toFixed(2), 'dB');
console.log('Buyer recording testing for 1500 Hz (WRONG):   ', calculateWindowedSnr(buyerSamples, 8000, 1500).toFixed(2), 'dB');
console.log('Buyer recording testing for 440 Hz (WRONG):    ', calculateWindowedSnr(buyerSamples, 8000, 440).toFixed(2), 'dB');
