// qa/generate-test-markers.mjs
import fs from 'fs';
import path from 'path';

function createSineWavBuffer(frequency, durationSeconds = 3, sampleRate = 8000, amplitude = 16000) {
  const numSamples = Math.floor(sampleRate * durationSeconds);
  const dataSize = numSamples * 2; // 16-bit mono = 2 bytes per sample
  const buffer = Buffer.alloc(44 + dataSize);

  // RIFF header
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);

  // fmt chunk
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // subchunk1size (16 for PCM)
  buffer.writeUInt16LE(1, 20); // audioFormat (1 = PCM)
  buffer.writeUInt16LE(1, 22); // numChannels (1 = mono)
  buffer.writeUInt32LE(sampleRate, 24); // sampleRate
  buffer.writeUInt32LE(sampleRate * 2, 28); // byteRate (sampleRate * numChannels * bitsPerSample/8)
  buffer.writeUInt16LE(2, 32); // blockAlign
  buffer.writeUInt16LE(16, 34); // bitsPerSample

  // data chunk
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    // Apply smooth 50ms fade-in and fade-out to prevent clicks
    let envelope = 1.0;
    const fadeSamples = Math.floor(sampleRate * 0.05);
    if (i < fadeSamples) {
      envelope = i / fadeSamples;
    } else if (i > numSamples - fadeSamples) {
      envelope = (numSamples - i) / fadeSamples;
    }
    const val = Math.round(amplitude * envelope * Math.sin(2 * Math.PI * frequency * t));
    buffer.writeInt16LE(val, 44 + i * 2);
  }

  return buffer;
}

const soundsDir = path.resolve('qa/asterisk/sounds');
const markers = [
  { name: 'qa-caller1-700hz.wav', freq: 700 },
  { name: 'qa-buyer1-1000hz.wav', freq: 1000 },
  { name: 'qa-caller2-1400hz.wav', freq: 1400 },
  { name: 'qa-buyer2-1800hz.wav', freq: 1800 },
];

for (const m of markers) {
  const filePath = path.join(soundsDir, m.name);
  const wavBuf = createSineWavBuffer(m.freq, 3, 8000, 16000);
  fs.writeFileSync(filePath, wavBuf);
  console.log(`Generated ${m.name}: ${wavBuf.length} bytes (${m.freq} Hz, 3.0s) -> ${filePath}`);
}
