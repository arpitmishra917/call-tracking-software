import { describe, it, expect, beforeEach } from 'vitest';
import { QaAudioAnalyzerService } from './qa-audio-analyzer.service.js';

describe('QaAudioAnalyzerService', () => {
  let service: QaAudioAnalyzerService;

  beforeEach(() => {
    service = new QaAudioAnalyzerService();
  });

  describe('WAV Header & Sample Parsing', () => {
    it('correctly parses valid 16-bit PCM mono WAV generated synthetically', () => {
      const wav = service.generateSyntheticWav({
        durationSeconds: 2.0,
        sampleRate: 8000,
        frequency: 1000,
        amplitude: 0.8,
      });

      const { metadata, samples } = service.parseWav(wav);

      expect(metadata.sampleRate).toBe(8000);
      expect(metadata.channels).toBe(1);
      expect(metadata.bitsPerSample).toBe(16);
      expect(metadata.durationSeconds).toBe(2.0);
      expect(metadata.sampleCount).toBe(16000);
      expect(samples.length).toBe(16000);

      // Verify sample normalization (-1.0 to 1.0)
      for (let i = 0; i < samples.length; i++) {
        expect(samples[i]).toBeGreaterThanOrEqual(-1.0);
        expect(samples[i]).toBeLessThanOrEqual(1.0);
      }
    });

    it('rejects truncated WAV buffer shorter than 44 bytes', () => {
      const truncated = Buffer.alloc(30);
      expect(() => service.parseWav(truncated)).toThrow(/Invalid WAV buffer/);
    });

    it('rejects WAV buffer without RIFF/WAVE magic', () => {
      const invalid = Buffer.alloc(50);
      invalid.write('TEST', 0);
      expect(() => service.parseWav(invalid)).toThrow(/does not match RIFF\/WAVE/);
    });

    it('rejects non-PCM format', () => {
      const buffer = service.generateSyntheticWav({ durationSeconds: 0.5 });
      // Tamper with audioFormat field (offset 20)
      buffer.writeUInt16LE(7, 20); // format 7 = mu-law
      expect(() => service.parseWav(buffer)).toThrow(/only PCM format 1 is supported/);
    });

    it('successfully parses 44-byte empty PCM WAV buffer without throwing', () => {
      const emptyWav = Buffer.from('524946462400000057415645666d74201000000001000100401f0000803e0000020010006461746100000000', 'hex');
      const { metadata, samples } = service.parseWav(emptyWav);
      expect(metadata.sampleRate).toBe(8000);
      expect(metadata.durationSeconds).toBe(0);
      expect(samples.length).toBe(0);

      const analysis = service.analyzeRecording(emptyWav);
      expect(analysis.passed).toBe(false);
      expect(analysis.isSilent).toBe(true);
      expect(analysis.durationSeconds).toBe(0);
    });
  });

  describe('Goertzel Tone & Frequency Detection', () => {
    it('detects strong power at target frequency and discriminates other frequencies', () => {
      const wav = service.generateSyntheticWav({
        durationSeconds: 1.0,
        sampleRate: 8000,
        frequency: 1000,
        amplitude: 0.9,
      });

      const { metadata, samples } = service.parseWav(wav);

      const targetPower = service.goertzel(samples, metadata.sampleRate, 1000);
      const offTargetPower = service.goertzel(samples, metadata.sampleRate, 440);
      const secondHarmonicPower = service.goertzel(samples, metadata.sampleRate, 2000);

      expect(targetPower).toBeGreaterThan(0.2);
      expect(offTargetPower).toBeLessThan(0.005);
      expect(secondHarmonicPower).toBeLessThan(0.005);
      expect(targetPower / Math.max(1e-6, offTargetPower)).toBeGreaterThan(40);
    });
  });

  describe('Signal-to-Noise Ratio (SNR) Calculation', () => {
    it('calculates SNR > 20 dB for clean sine tone', () => {
      const cleanWav = service.generateSyntheticWav({
        durationSeconds: 2.0,
        sampleRate: 8000,
        frequency: 1000,
        amplitude: 0.8,
        noiseAmplitude: 0.0,
      });

      const { metadata, samples } = service.parseWav(cleanWav);
      const snr = service.calculateSnr(samples, metadata.sampleRate, 1000);

      expect(snr).toBeGreaterThan(20.0);
    });

    it('calculates low SNR when heavy noise is present', () => {
      const noisyWav = service.generateSyntheticWav({
        durationSeconds: 2.0,
        sampleRate: 8000,
        frequency: 1000,
        amplitude: 0.1,
        noiseAmplitude: 0.9,
      });

      const { metadata, samples } = service.parseWav(noisyWav);
      const snr = service.calculateSnr(samples, metadata.sampleRate, 1000);

      expect(snr).toBeLessThan(10.0);
    });

    it('returns 0 dB for dead air / silence', () => {
      const silentWav = service.generateSyntheticWav({
        durationSeconds: 1.0,
        amplitude: 0.0,
        noiseAmplitude: 0.0,
      });

      const { metadata, samples } = service.parseWav(silentWav);
      const snr = service.calculateSnr(samples, metadata.sampleRate, 1000);

      expect(snr).toBe(0.0);
    });
  });

  describe('RMS dBFS & Silence Detection', () => {
    it('calculates approximately -4 to -3 dBFS for full-scale sine wave', () => {
      const wav = service.generateSyntheticWav({
        durationSeconds: 1.0,
        frequency: 1000,
        amplitude: 0.95,
      });

      const { samples } = service.parseWav(wav);
      const dbfs = service.calculateRmsDbfs(samples);

      expect(dbfs).toBeGreaterThan(-6.0);
      expect(dbfs).toBeLessThan(0.0);
    });

    it('flags silence when RMS level is below -50 dBFS', () => {
      const silentWav = service.generateSyntheticWav({
        durationSeconds: 1.0,
        frequency: 1000,
        amplitude: 0.0001, // extremely faint signal (-80 dBFS)
      });

      const { samples } = service.parseWav(silentWav);
      const dbfs = service.calculateRmsDbfs(samples);

      expect(dbfs).toBeLessThan(-50.0);
    });
  });

  describe('Clipping Detection', () => {
    it('detects unclipped signal correctly', () => {
      const normalWav = service.generateSyntheticWav({
        durationSeconds: 1.0,
        amplitude: 0.8,
      });

      const { samples } = service.parseWav(normalWav);
      const clipping = service.detectClipping(samples);

      expect(clipping.isClipped).toBe(false);
      expect(clipping.clippingRatio).toBe(0);
    });

    it('detects clipped signal when samples exceed threshold', () => {
      const wav = service.generateSyntheticWav({
        durationSeconds: 1.0,
        amplitude: 1.5, // Overdriven signal that pegs at full-scale
      });

      const { samples } = service.parseWav(wav);
      const clipping = service.detectClipping(samples);

      expect(clipping.isClipped).toBe(true);
      expect(clipping.clippingRatio).toBeGreaterThan(0.05); // > 5% clipped
    });
  });

  describe('End-to-End analyzeRecording', () => {
    it('passes for clean 1000 Hz tone meeting all criteria (SNR > 12 dB, Duration >= 1.5s, no silence, no clipping)', () => {
      const goodWav = service.generateSyntheticWav({
        durationSeconds: 2.0,
        frequency: 1000,
        amplitude: 0.8,
      });

      const result = service.analyzeRecording(goodWav, {
        targetFreq: 1000,
        minSnrDb: 12.0,
        minDurationSecs: 1.5,
      });

      expect(result.passed).toBe(true);
      expect(result.minSnrMet).toBe(true);
      expect(result.minDurationMet).toBe(true);
      expect(result.isSilent).toBe(false);
      expect(result.isClipped).toBe(false);
      expect(result.reasons).toHaveLength(0);
    });

    it('fails if duration is below minimum requirement', () => {
      const shortWav = service.generateSyntheticWav({
        durationSeconds: 1.0, // only 1.0s, required 1.5s
        frequency: 1000,
        amplitude: 0.8,
      });

      const result = service.analyzeRecording(shortWav, {
        targetFreq: 1000,
        minSnrDb: 12.0,
        minDurationSecs: 1.5,
      });

      expect(result.passed).toBe(false);
      expect(result.minDurationMet).toBe(false);
      expect(result.reasons.some((r) => r.includes('Duration'))).toBe(true);
    });

    it('fails if audio is silent', () => {
      const silentWav = service.generateSyntheticWav({
        durationSeconds: 2.0,
        amplitude: 0.0,
      });

      const result = service.analyzeRecording(silentWav, {
        targetFreq: 1000,
        minSnrDb: 12.0,
        minDurationSecs: 1.5,
      });

      expect(result.passed).toBe(false);
      expect(result.isSilent).toBe(true);
      expect(result.reasons.some((r) => r.includes('silent'))).toBe(true);
    });

    it('fails if SNR is below 12 dB due to excessive noise', () => {
      const noisyWav = service.generateSyntheticWav({
        durationSeconds: 2.0,
        frequency: 1000,
        amplitude: 0.2,
        noiseAmplitude: 0.8,
      });

      const result = service.analyzeRecording(noisyWav, {
        targetFreq: 1000,
        minSnrDb: 12.0,
        minDurationSecs: 1.5,
      });

      expect(result.passed).toBe(false);
      expect(result.minSnrMet).toBe(false);
      expect(result.reasons.some((r) => r.includes('Signal-to-Noise Ratio'))).toBe(true);
    });

    it('correctly detects a 1500 Hz tone and passes at minSnrDb = 5.0 dB', () => {
      const wav1500 = service.generateSyntheticWav({
        durationSeconds: 2.0,
        frequency: 1500,
        amplitude: 0.8,
      });

      const result = service.analyzeRecording(wav1500, {
        targetFreq: 1500,
        minSnrDb: 5.0,
        minDurationSecs: 1.5,
      });

      expect(result.passed).toBe(true);
      expect(result.snrDb).toBeGreaterThanOrEqual(5.0);
    });

    it('correctly detects a short tone burst surrounded by silence padding (telephony carrier scenario)', () => {
      // 2.0s file: 1.5s silence + 0.3s tone (1500 Hz) + 0.2s silence
      const sampleRate = 8000;
      const totalSamples = 16000;
      const dataByteLength = totalSamples * 2;
      const buffer = Buffer.alloc(44 + dataByteLength);

      buffer.write('RIFF', 0, 'ascii');
      buffer.writeUInt32LE(36 + dataByteLength, 4);
      buffer.write('WAVE', 8, 'ascii');
      buffer.write('fmt ', 12, 'ascii');
      buffer.writeUInt32LE(16, 16);
      buffer.writeUInt16LE(1, 20);
      buffer.writeUInt16LE(1, 22);
      buffer.writeUInt32LE(sampleRate, 24);
      buffer.writeUInt32LE(sampleRate * 2, 28);
      buffer.writeUInt16LE(2, 32);
      buffer.writeUInt16LE(16, 34);
      buffer.write('data', 36, 'ascii');
      buffer.writeUInt32LE(dataByteLength, 40);

      // Fill samples: 0 to 12000 is silence, 12000 to 14400 is 1500 Hz sine wave, 14400 to 16000 is silence
      for (let i = 0; i < totalSamples; i++) {
        let intVal = 0;
        if (i >= 12000 && i < 14400) {
          const t = (i - 12000) / sampleRate;
          const sample = Math.sin(2.0 * Math.PI * 1500 * t) * 0.8;
          intVal = Math.round(sample * 32767.0);
        }
        buffer.writeInt16LE(intVal, 44 + i * 2);
      }

      const result = service.analyzeRecording(buffer, {
        targetFreq: 1500,
        minSnrDb: 5.0,
        minDurationSecs: 1.5,
      });

      expect(result.passed).toBe(true);
      expect(result.snrDb).toBeGreaterThanOrEqual(20.0); // Windowed SNR should be very high
    });

    it('rejects wrong frequency when tone is at 1000 Hz but testing for 1500 Hz', () => {
      const wav1000 = service.generateSyntheticWav({
        durationSeconds: 2.0,
        frequency: 1000,
        amplitude: 0.8,
      });

      const result = service.analyzeRecording(wav1000, {
        targetFreq: 1500,
        minSnrDb: 5.0,
        minDurationSecs: 1.5,
      });

      expect(result.passed).toBe(false);
      expect(result.minSnrMet).toBe(false);
      expect(result.snrDb).toBeLessThan(0);
    });
  });
});
