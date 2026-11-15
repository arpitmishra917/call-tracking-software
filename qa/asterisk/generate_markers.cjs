const fs = require('fs');
const path = require('path');

function createSineWav(freqHz, durationSec, sampleRate = 8000) {
  const numSamples = Math.floor(sampleRate * durationSec);
  const dataSize = numSamples * 2;
  const buffer = Buffer.alloc(44 + dataSize);

  // RIFF chunk descriptor
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);

  // fmt subchunk
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
  buffer.writeUInt16LE(1, 20);  // AudioFormat (1 for PCM)
  buffer.writeUInt16LE(1, 22);  // NumChannels (1 mono)
  buffer.writeUInt32LE(sampleRate, 24); // SampleRate
  buffer.writeUInt32LE(sampleRate * 2, 28); // ByteRate
  buffer.writeUInt16LE(2, 32);  // BlockAlign
  buffer.writeUInt16LE(16, 34); // BitsPerSample

  // data subchunk
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  // write PCM samples
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const sample = Math.sin(2 * Math.PI * freqHz * t) * 16000; // 50% amplitude
    buffer.writeInt16LE(Math.round(sample), 44 + i * 2);
  }

  return buffer;
}

const soundsDir = path.join(__dirname, 'sounds');
if (!fs.existsSync(soundsDir)) {
  fs.mkdirSync(soundsDir, { recursive: true });
}

// Buyer Marker: 1500 Hz tone, 2 seconds
fs.writeFileSync(path.join(soundsDir, 'qa-buyer-marker.wav'), createSineWav(1500, 2));
// Caller Marker: 1000 Hz tone, 2 seconds
fs.writeFileSync(path.join(soundsDir, 'qa-caller-marker.wav'), createSineWav(1000, 2));

console.log('Audio markers successfully generated in:', soundsDir);
