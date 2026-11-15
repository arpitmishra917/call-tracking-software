import { Injectable, Logger } from '@nestjs/common';

export interface WavMetadata {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  durationSeconds: number;
  sampleCount: number;
}

export interface ToneDetectionResult {
  frequency: number;
  power: number;
  snrDb: number;
  detected: boolean;
  durationSeconds: number;
}

export interface QaAudioAnalysisResult {
  passed: boolean;
  metadata: WavMetadata;
  targetFrequency: number;
  snrDb: number;
  minSnrMet: boolean;
  durationSeconds: number;
  minDurationMet: boolean;
  isSilent: boolean;
  rmsDbfs: number;
  clippingRatio: number;
  isClipped: boolean;
  reasons: string[];
}

@Injectable()
export class QaAudioAnalyzerService {
  private readonly logger = new Logger(QaAudioAnalyzerService.name);

  /**
   * Parses a standard PCM 16-bit WAV header and extracts normalized audio samples (-1.0 to 1.0).
   */
  public parseWav(buffer: Buffer): { metadata: WavMetadata; samples: Float64Array } {
    if (!buffer || buffer.length < 44) {
      throw new Error(`Invalid WAV buffer: size ${buffer?.length ?? 0} is less than 44-byte RIFF header`);
    }

    const riff = buffer.toString('ascii', 0, 4);
    const wave = buffer.toString('ascii', 8, 12);
    if (riff !== 'RIFF' || wave !== 'WAVE') {
      throw new Error(`Invalid WAV buffer: header magic "${riff}"/"${wave}" does not match RIFF/WAVE`);
    }

    // Locate "fmt " chunk
    let offset = 12;
    let fmtOffset = -1;
    let dataOffset = -1;
    let dataSize = 0;

    while (offset <= buffer.length - 8) {
      const chunkId = buffer.toString('ascii', offset, offset + 4);
      const chunkSize = buffer.readUInt32LE(offset + 4);

      if (chunkId === 'fmt ') {
        fmtOffset = offset + 8;
      } else if (chunkId === 'data') {
        dataOffset = offset + 8;
        dataSize = chunkSize;
        break;
      }

      offset += 8 + chunkSize;
    }

    if (fmtOffset === -1 || dataOffset === -1) {
      throw new Error('Invalid WAV buffer: missing "fmt " or "data" chunk');
    }

    const audioFormat = buffer.readUInt16LE(fmtOffset);
    const channels = buffer.readUInt16LE(fmtOffset + 2);
    const sampleRate = buffer.readUInt32LE(fmtOffset + 4);
    const bitsPerSample = buffer.readUInt16LE(fmtOffset + 14);

    if (audioFormat !== 1) {
      throw new Error(`Unsupported WAV audio format: ${audioFormat} (only PCM format 1 is supported)`);
    }
    if (bitsPerSample !== 16) {
      throw new Error(`Unsupported bits per sample: ${bitsPerSample} (only 16-bit PCM is supported)`);
    }

    const bytesPerSample = bitsPerSample / 8;
    const actualDataBytes = Math.min(dataSize, buffer.length - dataOffset);
    const totalSamples = Math.floor(actualDataBytes / (bytesPerSample * channels));
    const samples = new Float64Array(totalSamples);

    for (let i = 0; i < totalSamples; i++) {
      // If stereo or multi-channel, average the channels to mono
      let sum = 0;
      for (let ch = 0; ch < channels; ch++) {
        const sampleOffset = dataOffset + (i * channels + ch) * bytesPerSample;
        sum += buffer.readInt16LE(sampleOffset);
      }
      samples[i] = (sum / channels) / 32768.0;
    }

    const durationSeconds = totalSamples / sampleRate;

    return {
      metadata: {
        sampleRate,
        channels,
        bitsPerSample,
        durationSeconds,
        sampleCount: totalSamples,
      },
      samples,
    };
  }

  /**
   * Detects single-frequency tone energy using the Goertzel algorithm.
   */
  public goertzel(samples: Float64Array, sampleRate: number, targetFreq: number): number {
    const N = samples.length;
    if (N === 0 || sampleRate <= 0) return 0;

    const k = Math.round((N * targetFreq) / sampleRate);
    const omega = (2.0 * Math.PI * k) / N;
    const coeff = 2.0 * Math.cos(omega);

    let s0 = 0.0;
    let s1 = 0.0;
    let s2 = 0.0;

    for (let i = 0; i < N; i++) {
      s0 = samples[i] + coeff * s1 - s2;
      s2 = s1;
      s1 = s0;
    }

    const power = s1 * s1 + s2 * s2 - coeff * s1 * s2;
    return (power * 2.0) / (N * N);
  }

  /**
   * Calculates Signal-to-Noise Ratio (SNR) in decibels for a target frequency.
   * Uses a dual-pass evaluation:
   * 1. Full-file Goertzel analysis for continuous tones.
   * 2. Sliding window Goertzel analysis (100ms window, 25ms step) to accurately evaluate
   *    tone bursts embedded in telephony recordings without dilution by carrier pre-roll
   *    or post-playback silence.
   * Returns the maximum valid SNR between full-file and active-window evaluations.
   */
  public calculateSnr(samples: Float64Array, sampleRate: number, targetFreq: number): number {
    const N = samples.length;
    if (N < 32 || sampleRate <= 0) return 0;

    // Total signal power (variance of samples)
    let totalPower = 0.0;
    for (let i = 0; i < N; i++) {
      totalPower += samples[i] * samples[i];
    }
    totalPower /= N;

    if (totalPower <= 1e-12) {
      return 0.0; // Dead air / zero signal
    }

    // 1. Full-file Goertzel evaluation
    const tonePower = this.goertzel(samples, sampleRate, targetFreq);
    const noisePower = Math.max(1e-12, totalPower - tonePower);
    const snrLinear = tonePower / noisePower;
    const fullFileSnr = 10.0 * Math.log10(Math.max(1e-3, snrLinear));

    // 2. Sliding-window evaluation (100ms window = 0.1s * sampleRate)
    const winSize = Math.min(N, Math.round(sampleRate * 0.1));
    if (winSize < 32) {
      return fullFileSnr;
    }

    const hopSize = Math.max(1, Math.round(winSize / 4)); // 25ms hop (75% overlap)
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

    if (activeWindows === 0) {
      return fullFileSnr;
    }

    return Math.max(fullFileSnr, maxWinSnr);
  }

  /**
   * Calculates RMS signal level in dBFS.
   * Full scale square wave = 0 dBFS; full scale sine wave = -3.01 dBFS.
   */
  public calculateRmsDbfs(samples: Float64Array): number {
    const N = samples.length;
    if (N === 0) return -100;

    let sumSquares = 0.0;
    for (let i = 0; i < N; i++) {
      sumSquares += samples[i] * samples[i];
    }
    const rms = Math.sqrt(sumSquares / N);
    if (rms <= 1e-6) return -120; // Silence floor

    return 20.0 * Math.log10(rms);
  }

  /**
   * Detects sample clipping (samples pegged at >= 99.9% of full scale).
   */
  public detectClipping(samples: Float64Array, threshold: number = 0.999): { clippingRatio: number; isClipped: boolean } {
    const N = samples.length;
    if (N === 0) return { clippingRatio: 0, isClipped: false };

    let clippedCount = 0;
    for (let i = 0; i < N; i++) {
      if (Math.abs(samples[i]) >= threshold) {
        clippedCount++;
      }
    }

    const clippingRatio = clippedCount / N;
    // Considered clipped if more than 0.1% (0.001) of samples are clipped
    return {
      clippingRatio,
      isClipped: clippingRatio > 0.001,
    };
  }

  /**
   * Performs complete end-to-end mathematical audio verification on a WAV recording.
   *
   * Thresholds:
   * - SNR > minSnrDb (default: 12 dB)
   * - Duration >= minDurationSecs (default: 1.5s)
   * - Not silent (RMS >= -50 dBFS)
   * - Not clipped (clippingRatio <= 0.1%)
   */
  public analyzeRecording(
    wavBuffer: Buffer,
    options?: {
      targetFreq?: number;
      minSnrDb?: number;
      minDurationSecs?: number;
      maxClippingRatio?: number;
      silenceFloorDbfs?: number;
    },
  ): QaAudioAnalysisResult {
    const targetFreq = options?.targetFreq ?? 1000; // default 1000 Hz test tone
    const minSnrDb = options?.minSnrDb ?? 12.0; // default 12 dB SNR requirement
    const minDurationSecs = options?.minDurationSecs ?? 1.5; // default 1.5 seconds min duration
    const silenceFloorDbfs = options?.silenceFloorDbfs ?? -50.0; // default -50 dBFS dead air floor

    const { metadata, samples } = this.parseWav(wavBuffer);
    const snrDb = this.calculateSnr(samples, metadata.sampleRate, targetFreq);
    const rmsDbfs = this.calculateRmsDbfs(samples);
    const clipping = this.detectClipping(samples);

    const minSnrMet = snrDb >= minSnrDb;
    const minDurationMet = metadata.durationSeconds >= minDurationSecs;
    const isSilent = rmsDbfs < silenceFloorDbfs;
    const isClipped = clipping.isClipped;

    const reasons: string[] = [];
    if (!minDurationMet) {
      reasons.push(
        `Duration ${metadata.durationSeconds.toFixed(2)}s is below required minimum ${minDurationSecs.toFixed(2)}s`,
      );
    }
    if (isSilent) {
      reasons.push(`Audio is silent / dead air (RMS ${rmsDbfs.toFixed(1)} dBFS < ${silenceFloorDbfs} dBFS)`);
    }
    if (!minSnrMet) {
      reasons.push(
        `Signal-to-Noise Ratio ${snrDb.toFixed(1)} dB is below required minimum ${minSnrDb} dB for ${targetFreq} Hz tone`,
      );
    }
    if (isClipped) {
      reasons.push(
        `Audio clipping detected: ${(clipping.clippingRatio * 100).toFixed(2)}% of samples clipped`,
      );
    }

    const passed = minSnrMet && minDurationMet && !isSilent && !isClipped;

    this.logger.log(
      `Audio analysis for ${targetFreq} Hz tone: ${passed ? 'PASSED' : 'FAILED'} (SNR ${snrDb.toFixed(1)} dB, Duration ${metadata.durationSeconds.toFixed(2)}s, RMS ${rmsDbfs.toFixed(1)} dBFS, Clipping ${(clipping.clippingRatio * 100).toFixed(2)}%)`,
    );

    return {
      passed,
      metadata,
      targetFrequency: targetFreq,
      snrDb,
      minSnrMet,
      durationSeconds: metadata.durationSeconds,
      minDurationMet,
      isSilent,
      rmsDbfs,
      clippingRatio: clipping.clippingRatio,
      isClipped,
      reasons,
    };
  }

  /**
   * Helper utility to synthesize a PCM 16-bit mono WAV buffer for testing and mock runs.
   */
  public generateSyntheticWav(options: {
    durationSeconds: number;
    sampleRate?: number;
    frequency?: number;
    amplitude?: number;
    noiseAmplitude?: number;
  }): Buffer {
    const sampleRate = options.sampleRate ?? 8000;
    const duration = options.durationSeconds;
    const totalSamples = Math.floor(sampleRate * duration);
    const freq = options.frequency ?? 1000;
    const amp = options.amplitude ?? 0.8;
    const noiseAmp = options.noiseAmplitude ?? 0.0;

    const dataByteLength = totalSamples * 2;
    const buffer = Buffer.alloc(44 + dataByteLength);

    // RIFF header
    buffer.write('RIFF', 0, 'ascii');
    buffer.writeUInt32LE(36 + dataByteLength, 4);
    buffer.write('WAVE', 8, 'ascii');

    // "fmt " sub-chunk
    buffer.write('fmt ', 12, 'ascii');
    buffer.writeUInt32LE(16, 16); // subchunk size (16 for PCM)
    buffer.writeUInt16LE(1, 20); // audio format (1 = PCM)
    buffer.writeUInt16LE(1, 22); // channels (1 = mono)
    buffer.writeUInt32LE(sampleRate, 24); // sample rate
    buffer.writeUInt32LE(sampleRate * 2, 28); // byte rate (sampleRate * channels * bytesPerSample)
    buffer.writeUInt16LE(2, 32); // block align (channels * bytesPerSample)
    buffer.writeUInt16LE(16, 34); // bits per sample

    // "data" sub-chunk
    buffer.write('data', 36, 'ascii');
    buffer.writeUInt32LE(dataByteLength, 40);

    for (let i = 0; i < totalSamples; i++) {
      const t = i / sampleRate;
      const tone = Math.sin(2.0 * Math.PI * freq * t);
      const noise = (Math.random() * 2.0 - 1.0) * noiseAmp;
      let sampleVal = (tone * amp + noise);
      sampleVal = Math.max(-1.0, Math.min(1.0, sampleVal));
      const intVal = Math.round(sampleVal * 32767.0);
      buffer.writeInt16LE(intVal, 44 + i * 2);
    }

    return buffer;
  }
}
