import fs from 'fs';

function analyzeWav(wavPath) {
  const buf = fs.readFileSync(wavPath);
  console.log(`\n=== Analyzing ${wavPath} (${buf.length} bytes) ===`);
  
  // Find data chunk
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

  if (dataOffset === -1) {
    console.log('No data chunk found!');
    return;
  }

  const sampleCount = dataSize / 2;
  const samples = new Int16Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    samples[i] = buf.readInt16LE(dataOffset + i * 2);
  }

  // Calculate RMS
  let sumSq = 0;
  let nonZero = 0;
  for (let s of samples) {
    sumSq += s * s;
    if (s !== 0) nonZero++;
  }
  const rms = Math.sqrt(sumSq / sampleCount);
  const rmsDbfs = 20 * Math.log10(rms / 32767);
  console.log(`Sample Count: ${sampleCount}, Duration: ${(sampleCount / 8000).toFixed(2)}s`);
  console.log(`Non-zero samples: ${nonZero} (${((nonZero / sampleCount) * 100).toFixed(1)}%)`);
  console.log(`RMS: ${rms.toFixed(2)}, RMS dBFS: ${rmsDbfs.toFixed(2)} dBFS`);

  // Scan frequencies with Goertzel from 300 Hz to 3000 Hz in 100 Hz steps
  console.log('--- Frequency Spectrum (Goertzel Power) ---');
  const sampleRate = 8000;
  const results = [];
  for (let freq = 300; freq <= 3000; freq += 100) {
    const k = Math.round((sampleCount * freq) / sampleRate);
    const w = (2 * Math.PI * k) / sampleCount;
    const coeff = 2 * Math.cos(w);
    let s_prev = 0;
    let s_prev2 = 0;
    for (let s of samples) {
      const s_val = s / 32768.0;
      const s0 = s_val + coeff * s_prev - s_prev2;
      s_prev2 = s_prev;
      s_prev = s0;
    }
    const power = s_prev * s_prev + s_prev2 * s_prev2 - coeff * s_prev * s_prev2;
    results.push({ freq, power });
  }

  results.sort((a, b) => b.power - a.power);
  console.log('Top 5 dominant frequencies:');
  for (let i = 0; i < Math.min(5, results.length); i++) {
    console.log(`  ${results[i].freq} Hz: power = ${results[i].power.toFixed(4)}`);
  }
}

analyzeWav('qa/recordings/qa-caller-15f2f1d2-8ada-46a5-a9c8-405d424f552d.wav');
analyzeWav('qa/recordings/qa-buyer-15f2f1d2-8ada-46a5-a9c8-405d424f552d.wav');
