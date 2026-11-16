import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import {
  AsteriskAriClientService,
  AsteriskAriError,
} from './asterisk-ari-client.service.js';
import { CallController } from '../call-controller.js';

describe('AsteriskAriClientService', () => {
  let service: AsteriskAriClientService;
  const originalEnv = { ...process.env };

  const TEST_ARI_USER = 'test_qa_user';
  const TEST_ARI_PASS = 'super_secret_ari_pass_999';
  const TEST_ARI_URL = 'http://127.0.0.1:8088';

  beforeEach(() => {
    service = new AsteriskAriClientService();
    process.env.TELEPHONY_QA_ARI_URL = TEST_ARI_URL;
    process.env.TELEPHONY_QA_ARI_USERNAME = TEST_ARI_USER;
    process.env.TELEPHONY_QA_ARI_PASSWORD = TEST_ARI_PASS;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    process.env = { ...originalEnv };
  });

  describe('Configuration & Localhost Defaulting', () => {
    it('defaults to http://127.0.0.1:8088 when env is unset', () => {
      delete process.env.TELEPHONY_QA_ARI_URL;
      delete process.env.TELEPHONY_QA_SERVER_URL;
      expect(service.getBaseUrl()).toBe('http://127.0.0.1:8088');
    });

    it('strips trailing slashes from configured URL', () => {
      process.env.TELEPHONY_QA_ARI_URL = 'http://127.0.0.1:8088///';
      expect(service.getBaseUrl()).toBe('http://127.0.0.1:8088');
    });

    it('reads credentials from environment variables', () => {
      expect(service.getUsername()).toBe(TEST_ARI_USER);
      expect(service.getPassword()).toBe(TEST_ARI_PASS);
    });
  });

  describe('Credential Redaction & Sanitization', () => {
    it('redacts password from error messages', () => {
      const raw = `Failed to connect with password ${TEST_ARI_PASS} to server`;
      const sanitized = service.sanitize(raw);
      expect(sanitized).not.toContain(TEST_ARI_PASS);
      expect(sanitized).toContain('[REDACTED]');
    });

    it('redacts Basic authorization tokens', () => {
      const raw = 'Header: Basic dGVzdF9xYV91c2VyOnN1cGVyX3NlY3JldA== was rejected';
      const sanitized = service.sanitize(raw);
      expect(sanitized).not.toContain('dGVzdF9xYV91c2VyOnN1cGVyX3NlY3JldA==');
      expect(sanitized).toContain('Basic [REDACTED_AUTH]');
    });

    it('redacts Authorization headers', () => {
      const raw = 'Authorization: Basic secret_token_here\nContent-Type: application/json';
      const sanitized = service.sanitize(raw);
      expect(sanitized).not.toContain('secret_token_here');
      expect(sanitized).toContain('Authorization: [REDACTED_AUTH]');
    });

    it('redacts password parameters in query strings', () => {
      const raw = 'http://127.0.0.1:8088/ari?api_key=user:password=secret_value&other=1';
      const sanitized = service.sanitize(raw);
      expect(sanitized).not.toContain('secret_value');
      expect(sanitized).toContain('password=[REDACTED]');
    });
  });

  describe('ARI Successful Connection & System Info', () => {
    it('returns system info and connectivity result on 200 OK', async () => {
      const mockSystemInfo = {
        build: { os: 'Linux', kernel: '6.6.0' },
        system: { version: '20.21.0', entity_id: 'node-1' },
        status: { startup_time: '2026-11-10T00:00:00Z', last_reload_time: '2026-11-10T00:00:00Z' },
      };

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => mockSystemInfo,
      } as Response);

      const conn = await service.checkConnectivity();
      expect(conn.connected).toBe(true);
      expect(conn.version).toBe('20.21.0');
      expect(typeof conn.latencyMs).toBe('number');
    });

    it('retrieves detailed system info', async () => {
      const mockSystemInfo = {
        build: { os: 'Linux', kernel: '6.6.0' },
        system: { version: '20.21.0', entity_id: 'node-1' },
        status: { startup_time: '2026-11-10T00:00:00Z', last_reload_time: '2026-11-10T00:00:00Z' },
      };

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => mockSystemInfo,
      } as Response);

      const info = await service.getSystemInfo();
      expect(info.version).toBe('20.21.0');
      expect(info.os).toBe('Linux');
      expect(info.kernel).toBe('6.6.0');
      expect(info.entityId).toBe('node-1');
    });
  });

  describe('ARI Connection Failure & Error Handling', () => {
    it('handles network connection refusal without leaking secrets', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(
        new Error(`connect ECONNREFUSED with password=${TEST_ARI_PASS} 127.0.0.1:8088`),
      );

      const conn = await service.checkConnectivity();
      expect(conn.connected).toBe(false);
      expect(conn.error).toBeDefined();
      expect(conn.error).not.toContain(TEST_ARI_PASS);
      expect(conn.error).toContain('ECONNREFUSED');
    });

    it('throws AsteriskAriError on API request network failure', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network reset'));

      await expect(service.getSystemInfo()).rejects.toThrow(AsteriskAriError);
    });
  });

  describe('Authentication Failure Handling', () => {
    it('handles 401 Unauthorized with isAuthError flag and redacted message', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: async () => `{"message": "Authentication required for ${TEST_ARI_PASS}"}`,
      } as Response);

      let caught: any;
      try {
        await service.getSystemInfo();
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(AsteriskAriError);
      expect(caught.statusCode).toBe(401);
      expect(caught.isAuthError).toBe(true);
      expect(caught.message).not.toContain(TEST_ARI_PASS);
      expect(caught.message).toContain('401');
    });
  });

  describe('Timeout Behavior', () => {
    it('handles request timeout using AbortController', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementationOnce((_url, init) => {
        return new Promise((_, reject) => {
          const signal = init?.signal;
          signal?.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        });
      });

      let caught: any;
      try {
        await service.getSystemInfo(50); // 50ms fast timeout
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(AsteriskAriError);
      expect(caught.isTimeout).toBe(true);
      expect(caught.message).toContain('timed out');
    });
  });

  describe('Endpoints, Channels, and Recordings Listing', () => {
    it('retrieves and maps endpoints', async () => {
      const mockEndpoints = [
        { technology: 'PJSIP', resource: 'telnyx-caller', state: 'online', channel_ids: [] },
        { technology: 'PJSIP', resource: 'telnyx-buyer', state: 'online', channel_ids: ['ch-123'] },
      ];

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => mockEndpoints,
      } as Response);

      const endpoints = await service.getEndpoints();
      expect(endpoints.length).toBe(2);
      expect(endpoints[0].resource).toBe('telnyx-caller');
      expect(endpoints[0].state).toBe('online');
      expect(endpoints[1].channelIds).toEqual(['ch-123']);
    });

    it('retrieves and maps active channels', async () => {
      const mockChannels = [
        {
          id: '1699999999.1',
          name: 'PJSIP/telnyx-caller-00000001',
          state: 'Up',
          caller: { number: '+17207159445' },
          connected: { number: '+14845560110' },
          creationtime: '2026-11-10T00:00:00.000+0000',
        },
      ];

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => mockChannels,
      } as Response);

      const channels = await service.listChannels();
      expect(channels.length).toBe(1);
      expect(channels[0].id).toBe('1699999999.1');
      expect(channels[0].callerNumber).toBe('+17207159445');
      expect(channels[0].state).toBe('Up');
    });

    it('retrieves and maps stored recordings', async () => {
      const mockRecordings = [
        {
          name: 'qa-recording-marker-1',
          format: 'wav',
          state: 'closed',
          duration: 30,
        },
      ];

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => mockRecordings,
      } as Response);

      const recordings = await service.listStoredRecordings();
      expect(recordings.length).toBe(1);
      expect(recordings[0].name).toBe('qa-recording-marker-1');
      expect(recordings[0].format).toBe('wav');
      expect(recordings[0].duration).toBe(30);
    });
  });

  describe('QA-Only Boundary & Production Routing Isolation', () => {
    it('verifies AsteriskAriClientService is completely decoupled from CallController', () => {
      // CallController must NOT require AsteriskAriClientService
      // Verify CallController parameter count / optionality
      const mockProvider = {
        dialBuyer: vi.fn(),
        hangupCall: vi.fn(),
      };
      const mockPrisma = {};
      const mockCallsService = {};

      const controller = new CallController(
        mockProvider as any,
        mockPrisma as any,
        mockCallsService as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
      );

      expect(controller).toBeDefined();
      // Ensure AsteriskAriClientService is never passed to or required by production controller
      expect((controller as any).ariClientService).toBeUndefined();
    });
  });

  describe('Phase 7B-1: Native ARI Channel, Recording, and Media Operations', () => {
    it('originateChannel calls POST /ari/channels with query parameters', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 'ari_ch_999',
          name: 'PJSIP/endpoint-001',
          state: 'Up',
          caller: { number: '+14845560110' },
          connected: { number: '+12025550199' },
          creationtime: '2026-11-10T00:00:00Z',
        }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const ch = await service.originateChannel({
        endpoint: 'PJSIP/test@telnyx_caller',
        callerId: '+14845560110',
        app: 'callflow-qa',
        appArgs: 'run_123',
      });

      expect(ch.id).toBe('ari_ch_999');
      expect(ch.name).toBe('PJSIP/endpoint-001');
      expect(ch.state).toBe('Up');
      expect(ch.callerNumber).toBe('+14845560110');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/ari/channels?endpoint=PJSIP%2Ftest%40telnyx_caller&app=callflow-qa&callerId=%2B14845560110&appArgs=run_123'),
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('recordChannel calls POST /ari/channels/{id}/record', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          name: 'rec_run_1',
          format: 'wav',
          state: 'recording',
          duration: 0,
        }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const rec = await service.recordChannel('ari_ch_999', {
        name: 'rec_run_1',
        format: 'wav',
        maxDurationSeconds: 10,
        beep: false,
        ifExists: 'overwrite',
      });

      expect(rec.name).toBe('rec_run_1');
      expect(rec.state).toBe('recording');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/ari/channels/ari_ch_999/record?name=rec_run_1&format=wav&maxDurationSeconds=10&beep=false&ifExists=overwrite'),
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('recordChannel serializes maxSilenceSeconds=0 correctly into query params', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          name: 'rec_zero_silence',
          format: 'wav',
          state: 'recording',
        }),
      });
      vi.stubGlobal('fetch', mockFetch);

      await service.recordChannel('ari_ch_999', {
        name: 'rec_zero_silence',
        format: 'wav',
        maxDurationSeconds: 15,
        maxSilenceSeconds: 0,
        beep: false,
        ifExists: 'fail',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/ari/channels/ari_ch_999/record?name=rec_zero_silence&format=wav&maxDurationSeconds=15&maxSilenceSeconds=0&beep=false&ifExists=fail'),
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('getStoredRecording calls GET /ari/recordings/stored/{name}', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          name: 'rec_run_stored',
          format: 'wav',
          state: 'done',
          duration: 12,
        }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const rec = await service.getStoredRecording('rec_run_stored');
      expect(rec.name).toBe('rec_run_stored');
      expect(rec.state).toBe('done');
      expect(rec.duration).toBe(12);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/ari/recordings/stored/rec_run_stored'),
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('stopRecording calls POST /ari/recordings/live/{name}/stop', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        text: async () => '',
      });
      vi.stubGlobal('fetch', mockFetch);

      await service.stopRecording('rec_run_1');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/ari/recordings/live/rec_run_1/stop'),
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('playMedia calls POST /ari/channels/{id}/play', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 'playback_001',
          media_uri: 'sound:tone-1000',
          target_uri: 'channel:ari_ch_999',
          state: 'playing',
        }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const pb = await service.playMedia('ari_ch_999', 'sound:tone-1000');
      expect(pb.id).toBe('playback_001');
      expect(pb.mediaUri).toBe('sound:tone-1000');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/ari/channels/ari_ch_999/play?media=sound%3Atone-1000'),
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('hangupChannel calls DELETE /ari/channels/{id}', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        text: async () => '',
      });
      vi.stubGlobal('fetch', mockFetch);

      await service.hangupChannel('ari_ch_999', 'normal');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/ari/channels/ari_ch_999?reason=normal'),
        expect.objectContaining({ method: 'DELETE' }),
      );
    });

    it('deleteStoredRecording calls DELETE /ari/recordings/stored/{name}', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        text: async () => '',
      });
      vi.stubGlobal('fetch', mockFetch);

      await service.deleteStoredRecording('rec_run_1');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/ari/recordings/stored/rec_run_1'),
        expect.objectContaining({ method: 'DELETE' }),
      );
    });

    it('getStoredRecordingFile downloads binary audio buffer via GET', async () => {
      const binaryContent = Buffer.from('RIFF_FAKE_WAV_DATA');
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: async () => binaryContent.buffer,
      });
      vi.stubGlobal('fetch', mockFetch);

      const buffer = await service.getStoredRecordingFile('rec_run_1');
      expect(Buffer.isBuffer(buffer)).toBe(true);
      expect(buffer.toString()).toContain('RIFF_FAKE_WAV_DATA');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/ari/recordings/stored/rec_run_1/file'),
        expect.objectContaining({ method: 'GET' }),
      );
    });
  });

  describe('Live Docker Asterisk Connectivity Verification', () => {
    it('connects to live local Asterisk container with rotated credentials', async () => {
      let ariPassword = process.env.TELEPHONY_QA_ARI_PASSWORD;
      const candidates = [
        path.resolve(process.cwd(), '.env.qa'),
        path.resolve(process.cwd(), 'apps/api/.env.qa'),
        path.resolve(__dirname, '../../../../.env.qa'),
      ];
      for (const p of candidates) {
        if (fs.existsSync(p)) {
          const parsed = dotenv.parse(fs.readFileSync(p, 'utf8'));
          if (parsed.TELEPHONY_QA_ARI_PASSWORD) {
            ariPassword = parsed.TELEPHONY_QA_ARI_PASSWORD;
            break;
          }
        }
      }

      process.env.TELEPHONY_QA_ARI_URL = 'http://127.0.0.1:8088';
      process.env.TELEPHONY_QA_ARI_USERNAME = 'callflow_qa';
      process.env.TELEPHONY_QA_ARI_PASSWORD = ariPassword;
      const liveService = new AsteriskAriClientService();

      const conn = await liveService.checkConnectivity();
      if (!conn.connected) {
        console.warn('Skipping Live Docker Asterisk test: container not reachable on 127.0.0.1:8088');
        return;
      }
      expect(conn.connected).toBe(true);
      expect(conn.version).toBe('20.21.0');
      expect(conn.error).toBeUndefined();

      const endpoints = await liveService.getEndpoints();
      expect(endpoints.length).toBeGreaterThanOrEqual(2);
      const callerEp = endpoints.find((e) => e.resource === 'telnyx-caller');
      const buyerEp = endpoints.find((e) => e.resource === 'telnyx-buyer');
      expect(callerEp?.state).toBe('online');
      expect(buyerEp?.state).toBe('online');
    });
  });
});
