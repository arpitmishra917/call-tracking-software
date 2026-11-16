/**
 * North American (US) Standard Ringback Tone Generator.
 *
 * PSTN Specifications:
 * - Dual frequency: 440 Hz + 480 Hz sinusoidal waves.
 * - Cadence: 2.0 seconds active ringing tone, 4.0 seconds silence (6.0 seconds total period).
 * - Format: 16-bit linear PCM mono WAV at 8000 Hz.
 * - Total size: 96,044 bytes (44-byte RIFF/WAVE header + 96,000 bytes PCM payload).
 */
export function generateUsRingbackWav(sampleRate = 8000): Buffer {
  const toneDuration = 2.0;
  const totalDuration = 6.0;
  const totalSamples = Math.floor(sampleRate * totalDuration);
  const toneSamples = Math.floor(sampleRate * toneDuration);
  const dataByteLength = totalSamples * 2;
  const buffer = Buffer.alloc(44 + dataByteLength);

  // 1. RIFF Chunk Descriptor
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataByteLength, 4);
  buffer.write('WAVE', 8, 'ascii');

  // 2. "fmt " Subchunk
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16); // Subchunk size (16 for PCM)
  buffer.writeUInt16LE(1, 20); // AudioFormat (1 = Linear PCM)
  buffer.writeUInt16LE(1, 22); // NumChannels (1 = Mono)
  buffer.writeUInt32LE(sampleRate, 24); // SampleRate
  buffer.writeUInt32LE(sampleRate * 2, 28); // ByteRate (sampleRate * channels * bytesPerSample)
  buffer.writeUInt16LE(2, 32); // BlockAlign (channels * bytesPerSample)
  buffer.writeUInt16LE(16, 34); // BitsPerSample (16 bits)

  // 3. "data" Subchunk
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataByteLength, 40);

  // Standard US frequencies: 440 Hz and 480 Hz
  const freq1 = 440;
  const freq2 = 480;
  // Amplitude ~ -10 dBFS peak to avoid clipping while ensuring clear audible level
  const amp = 0.35;

  for (let i = 0; i < totalSamples; i++) {
    let val = 0;
    if (i < toneSamples) {
      const t = i / sampleRate;
      val = amp * Math.sin(2 * Math.PI * freq1 * t) + amp * Math.sin(2 * Math.PI * freq2 * t);
    }
    const intVal = Math.round(val * 32767);
    buffer.writeInt16LE(intVal, 44 + i * 2);
  }

  return buffer;
}
