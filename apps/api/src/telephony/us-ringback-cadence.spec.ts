import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { generateUsRingbackWav } from './ringback-tone.util.js';
import { QaAudioAnalyzerService } from './qa/qa-audio-analyzer.service.js';
import { RingbackController } from './ringback.controller.js';
import { TelnyxProvider } from './telnyx/telnyx.provider.js';

describe('US Ringback Cadence & Audio Playback Architecture', () => {
  const originalEnv = { ...process.env };
  let audioAnalyzer: QaAudioAnalyzerService;

  beforeEach(() => {
    process.env = { ...originalEnv };
    audioAnalyzer = new QaAudioAnalyzerService();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('1. US Ringback WAV Synthesizer (PSTN Standard Compliant)', () => {
    it('generates a valid 16-bit PCM mono 8kHz WAV buffer with exact 6.0s duration', () => {
      const wav = generateUsRingbackWav(8000);

      // Total duration 6.0s at 8kHz: 48,000 samples * 2 bytes = 96,000 bytes + 44-byte header = 96,044 bytes
      expect(wav.length).toBe(96044);

      // Verify header using QaAudioAnalyzerService
      const { metadata, samples } = audioAnalyzer.parseWav(wav);
      expect(metadata.sampleRate).toBe(8000);
      expect(metadata.channels).toBe(1);
      expect(metadata.bitsPerSample).toBe(16);
      expect(metadata.durationSeconds).toBe(6.0);
      expect(metadata.sampleCount).toBe(48000);
      expect(samples.length).toBe(48000);

      // Verify clipping bounds (-1.0 to 1.0)
      for (let i = 0; i < samples.length; i++) {
        expect(samples[i]).toBeGreaterThanOrEqual(-1.0);
        expect(samples[i]).toBeLessThanOrEqual(1.0);
      }
    });

    it('exhibits exact US ringback cadence: 2.0s dual tone (440Hz + 480Hz) followed by 4.0s silence', () => {
      const wav = generateUsRingbackWav(8000);
      const { samples } = audioAnalyzer.parseWav(wav);

      const toneSamples = samples.slice(0, 16000); // 0.0s to 2.0s
      const silenceSamples = samples.slice(16000, 48000); // 2.0s to 6.0s

      // 1. Dual-tone segment analysis: 440 Hz and 480 Hz
      const power440 = audioAnalyzer.goertzel(toneSamples, 8000, 440);
      const power480 = audioAnalyzer.goertzel(toneSamples, 8000, 480);
      const powerRandomOther = audioAnalyzer.goertzel(toneSamples, 8000, 1000);

      expect(power440).toBeGreaterThan(0.01);
      expect(power480).toBeGreaterThan(0.01);
      // Other unrepresented frequencies have negligible power
      expect(powerRandomOther).toBeLessThan(power440 * 0.01);

      // 2. Silence segment analysis: purely zero amplitude
      let maxSilenceAbs = 0;
      for (let i = 0; i < silenceSamples.length; i++) {
        const abs = Math.abs(silenceSamples[i]);
        if (abs > maxSilenceAbs) maxSilenceAbs = abs;
      }
      expect(maxSilenceAbs).toBe(0); // Pure silence during 4s cadence pause
    });
  });

  describe('2. RingbackController HTTP Endpoint', () => {
    it('serves the standard ringback WAV buffer with correct headers', () => {
      const controller = new RingbackController();
      const mockRes: any = {
        status: vi.fn().mockReturnThis(),
        send: vi.fn(),
      };

      controller.getRingbackTone(mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.send).toHaveBeenCalled();
      const sentBuffer = mockRes.send.mock.calls[0][0];
      expect(Buffer.isBuffer(sentBuffer)).toBe(true);
      expect(sentBuffer.length).toBe(96044);
    });
  });

  describe('3. TelnyxProvider Ringback Playback URL Resolution & Idempotency', () => {
    it('resolves audio URL from process.env.BASE_URL when RINGBACK_AUDIO_URL is unset', async () => {
      process.env.TELNYX_API_KEY = 'test_key';
      process.env.BASE_URL = 'https://api.callflow.com/';
      delete process.env.RINGBACK_AUDIO_URL;

      const provider = new TelnyxProvider();
      const mockStart = vi.fn().mockResolvedValue({ data: {} });
      (provider as any).telnyxClient = {
        calls: { actions: { startPlayback: mockStart, stopPlayback: vi.fn() } },
      };

      await provider.startRingback('v3:call_test_1');

      expect(mockStart).toHaveBeenCalledWith('v3:call_test_1', {
        audio_url: 'https://api.callflow.com/telephony/ringback.wav',
        loop: 'infinity',
        overlay: false,
        target_legs: 'self',
      });
    });

    it('prioritizes explicit process.env.RINGBACK_AUDIO_URL over BASE_URL', async () => {
      process.env.TELNYX_API_KEY = 'test_key';
      process.env.BASE_URL = 'https://api.callflow.com';
      process.env.RINGBACK_AUDIO_URL = 'https://cdn.callflow.com/custom-ringback.wav';

      const provider = new TelnyxProvider();
      const mockStart = vi.fn().mockResolvedValue({ data: {} });
      (provider as any).telnyxClient = {
        calls: { actions: { startPlayback: mockStart, stopPlayback: vi.fn() } },
      };

      await provider.startRingback('v3:call_test_2');

      expect(mockStart).toHaveBeenCalledWith('v3:call_test_2', {
        audio_url: 'https://cdn.callflow.com/custom-ringback.wav',
        loop: 'infinity',
        overlay: false,
        target_legs: 'self',
      });
    });

    it('enforces provider-level idempotency: duplicate startRingback on same call leg is a no-op', async () => {
      process.env.TELNYX_API_KEY = 'test_key';
      process.env.BASE_URL = 'https://api.callflow.com';

      const provider = new TelnyxProvider();
      const mockStart = vi.fn().mockResolvedValue({ data: {} });
      (provider as any).telnyxClient = {
        calls: { actions: { startPlayback: mockStart, stopPlayback: vi.fn() } },
      };

      // First call initiates playback
      await provider.startRingback('v3:call_test_3');
      expect(mockStart).toHaveBeenCalledTimes(1);

      // Second call while active is ignored
      await provider.startRingback('v3:call_test_3');
      expect(mockStart).toHaveBeenCalledTimes(1);

      // Stop playback releases lock
      await provider.stopRingback('v3:call_test_3');

      // Subsequent start succeeds again
      await provider.startRingback('v3:call_test_3');
      expect(mockStart).toHaveBeenCalledTimes(2);
    });

    it('handles startPlayback failure gracefully and resets active state', async () => {
      process.env.TELNYX_API_KEY = 'test_key';
      const provider = new TelnyxProvider();
      const mockStart = vi.fn().mockRejectedValue(new Error('Telnyx 500 error'));
      (provider as any).telnyxClient = {
        calls: { actions: { startPlayback: mockStart, stopPlayback: vi.fn() } },
      };

      await expect(provider.startRingback('v3:call_fail')).resolves.toBeUndefined();
      expect(mockStart).toHaveBeenCalledTimes(1);

      // Active state was cleared on failure, so retry can be attempted
      mockStart.mockResolvedValueOnce({ data: {} });
      await expect(provider.startRingback('v3:call_fail')).resolves.toBeUndefined();
      expect(mockStart).toHaveBeenCalledTimes(2);
    });

    it('resolves exactly to ngrok domain when configured in environment', async () => {
      process.env.TELNYX_API_KEY = 'test_key';
      process.env.BASE_URL = 'https://coherent-undrilled-disarm.ngrok-free.dev';
      delete process.env.RINGBACK_AUDIO_URL;

      const provider = new TelnyxProvider();
      const mockStart = vi.fn().mockResolvedValue({ data: {} });
      (provider as any).telnyxClient = {
        calls: { actions: { startPlayback: mockStart, stopPlayback: vi.fn() } },
      };

      await provider.startRingback('v3:caller_leg_ngrok');

      expect(mockStart).toHaveBeenCalledWith('v3:caller_leg_ngrok', {
        audio_url: 'https://coherent-undrilled-disarm.ngrok-free.dev/telephony/ringback.wav',
        loop: 'infinity',
        overlay: false,
        target_legs: 'self',
      });
    });

    it('suppresses Telnyx 90018 and 422 on stopRingback for already ended calls', async () => {
      process.env.TELNYX_API_KEY = 'test_key';
      const provider = new TelnyxProvider();
      const mockStop = vi.fn().mockRejectedValue({
        raw: { errors: [{ code: '90018', title: 'Call has already ended' }] },
        message: 'Call has already ended',
        status: 422,
      });
      (provider as any).telnyxClient = {
        calls: { actions: { startPlayback: vi.fn(), stopPlayback: mockStop } },
      };

      await expect(provider.stopRingback('v3:ended_call')).resolves.toBeUndefined();
      expect(mockStop).toHaveBeenCalledWith('v3:ended_call', { stop: 'all' });
    });
  });
});
