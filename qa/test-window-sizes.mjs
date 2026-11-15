import fs from 'fs';

function testWindows(wavPath, targetFreq) {
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

  console.log(`\n=== Testing Window Sizes for ${wavPath} (${targetFreq} Hz) ===`);
  for (let winMs of [50, 100, 150, 200, 250]) {
    const winSize = Math.round((winMs / 1000) * 8000);
    const step = Math.max(1, Math.floor(winSize / 4));
    let maxSnr = -100;
    let bestIdx = 0;

    for (let start = 0; start <= sampleCount - winSize; start += step) {
      let winTotPower = 0;
      for (let i = 0; i < winSize; i++) winTotPower += samples[start + i] * samples[start + i];
      winTotPower /= winSize;
      if (winTotPower < 1e-5) continue; // silence

      const k = Math.round((winSize * targetFreq) / 8000);
      const coeff = 2.0 * Math.cos((2.0 * Math.PI * k) / winSize);
      let s0 = 0, s1 = 0, s2 = 0;
      for (let i = 0; i < winSize; i++) {
        s0 = samples[start + i] + coeff * s1 - s2;
        s2 = s1;
        s1 = s0;
      }
      const tonePower = ((s1 * s1 + s2 * s2 - coeff * s1 * s2) * 2.0) / (winSize * winSize);
      const noisePower = Math.max(1e-12, winTotPower - tonePower);
      const snr = 10.0 * Math.log10(tonePower / noisePower);
      if (snr > maxSnr) {
        maxSnr = snr;
        bestIdx = start;
      }
    }
    console.log(`  Window ${winMs}ms (${winSize} samples): Max SNR = ${maxSnr.toFixed(2)} dB (at sample ${bestIdx})`);
  }
}

testWindows('qa/recordings/qa-caller-0a06cf5b-e951-493e-bad5-4ac0a442960a.wav', 1500);
testWindows('qa/recordings/qa-buyer-0a06cf5b-e951-493e-bad5-4ac0a442960a.wav', 1000);
