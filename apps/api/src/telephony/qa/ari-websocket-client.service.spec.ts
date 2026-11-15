import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  AriWebSocketClientService,
  AriWebSocketError,
  StasisStartEvent,
  RecordingStartedEvent,
  RecordingFinishedEvent,
} from './ari-websocket-client.service.js';

describe('AriWebSocketClientService', () => {
  let wsClient: AriWebSocketClientService;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.TELEPHONY_QA_ARI_URL = 'http://127.0.0.1:8088';
    process.env.TELEPHONY_QA_ARI_USERNAME = 'test_user';
    process.env.TELEPHONY_QA_ARI_PASSWORD = 'super_secret_ari_pass_123';

    wsClient = new AriWebSocketClientService();
  });

  afterEach(() => {
    wsClient.onModuleDestroy();
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  describe('WebSocket URL Generation & Credential Sanitization', () => {
    it('generates correct ws:// URL with encoded credentials and app parameter', () => {
      const url = wsClient.getWebSocketUrl('callflow-qa');
      expect(url).toBe(
        'ws://127.0.0.1:8088/ari/events?app=callflow-qa&api_key=test_user:super_secret_ari_pass_123',
      );
    });

    it('translates https:// to wss:// for secure connections', () => {
      process.env.TELEPHONY_QA_ARI_URL = 'https://asterisk.local:8089';
      const url = wsClient.getWebSocketUrl('custom-app');
      expect(url).toContain('wss://asterisk.local:8089/ari/events?app=custom-app');
    });

    it('sanitizes ARI password and URL-encoded password from logs and error messages', () => {
      const rawText = 'Error connecting to ws://127.0.0.1:8088/ari/events?api_key=test_user:super_secret_ari_pass_123';
      const sanitized = wsClient.sanitize(rawText);
      expect(sanitized).not.toContain('super_secret_ari_pass_123');
      expect(sanitized).toContain('[REDACTED]');
      expect(sanitized).toContain('[REDACTED_USER]');
    });

    it('returns empty string when sanitizing empty input', () => {
      expect(wsClient.sanitize('')).toBe('');
    });
  });

  describe('Connection Lifecycle', () => {
    it('fails with AriWebSocketError when connection times out', async () => {
      class MockHangingSocket {
        public readyState = 0; // CONNECTING
        public onopen: any = null;
        public onerror: any = null;
        public onclose: any = null;
        public close = vi.fn();
      }

      (globalThis as any).WebSocket = MockHangingSocket;

      await expect(wsClient.connect('callflow-qa', 50)).rejects.toThrowError(
        /ARI WebSocket connection timed out after 50ms/,
      );
      expect(wsClient.isConnected()).toBe(false);
    });

    it('successfully connects when onopen fires', async () => {
      class MockSuccessfulSocket {
        public readyState = 0;
        public onopen: any = null;
        public onerror: any = null;
        public onclose: any = null;
        public onmessage: any = null;
        public close = vi.fn();

        constructor() {
          setTimeout(() => {
            this.readyState = 1; // OPEN
            if (this.onopen) this.onopen();
          }, 10);
        }
      }

      (globalThis as any).WebSocket = MockSuccessfulSocket;

      await wsClient.connect('callflow-qa', 500);
      expect(wsClient.isConnected()).toBe(true);

      // Re-connecting when already connected is a no-op
      await wsClient.connect('callflow-qa', 500);
      expect(wsClient.isConnected()).toBe(true);
    });

    it('handles connection error gracefully and cleans up socket', async () => {
      class MockFailingSocket {
        public readyState = 0;
        public onerror: any = null;
        public onclose: any = null;
        public close = vi.fn();

        constructor() {
          setTimeout(() => {
            if (this.onerror) this.onerror(new Error('Connection refused'));
          }, 10);
        }
      }

      (globalThis as any).WebSocket = MockFailingSocket;

      await expect(wsClient.connect('callflow-qa', 500)).rejects.toThrowError(
        /ARI WebSocket error/,
      );
      expect(wsClient.isConnected()).toBe(false);
    });
  });

  describe('Event Waiting & Deduplication', () => {
    it('resolves waitForEvent when a matching event is ingested', async () => {
      const waiterPromise = wsClient.waitForEvent<StasisStartEvent>(
        'StasisStart',
        (e) => e.channel.id === 'chan_123',
        1000,
      );

      const fakeEvent: StasisStartEvent = {
        type: 'StasisStart',
        application: 'callflow-qa',
        timestamp: new Date().toISOString(),
        channel: {
          id: 'chan_123',
          name: 'PJSIP/telnyx-001',
          state: 'Up',
        },
        args: ['caller', 'run_test_abc'],
      };

      wsClient.handleRawMessage(JSON.stringify(fakeEvent));

      const received = await waiterPromise;
      expect(received.channel.id).toBe('chan_123');
      expect(received.args).toEqual(['caller', 'run_test_abc']);
    });

    it('rejects waitForEvent when timeout expires', async () => {
      await expect(
        wsClient.waitForEvent('RecordingStarted', () => true, 50),
      ).rejects.toThrowError(/Timed out waiting for ARI event "RecordingStarted"/);
    });

    it('deduplicates identical ARI events within deduplication window', () => {
      const listener = vi.fn();
      wsClient.on('RecordingFinished', listener);

      const timestamp = new Date().toISOString();
      const event: RecordingFinishedEvent = {
        type: 'RecordingFinished',
        application: 'callflow-qa',
        timestamp,
        recording: {
          name: 'rec_duplicate_test',
          format: 'wav',
          state: 'done',
          target_uri: 'channel:123',
        },
      };

      const payload = JSON.stringify(event);
      wsClient.handleRawMessage(payload);
      wsClient.handleRawMessage(payload); // Duplicate

      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('dispatches events to permanent listeners registered via on()', () => {
      const listenerA = vi.fn();
      const listenerB = vi.fn();

      const unsubscribeA = wsClient.on('StasisStart', listenerA);
      wsClient.on('StasisStart', listenerB);

      const event = {
        type: 'StasisStart',
        application: 'callflow-qa',
        timestamp: new Date().toISOString(),
        channel: { id: 'ch_listener_test', name: 'PJSIP/test', state: 'Up' },
        args: [],
      };

      wsClient.handleRawMessage(JSON.stringify(event));
      expect(listenerA).toHaveBeenCalledTimes(1);
      expect(listenerB).toHaveBeenCalledTimes(1);

      unsubscribeA();

      const secondEvent = {
        type: 'StasisStart',
        application: 'callflow-qa',
        timestamp: new Date(Date.now() + 1000).toISOString(),
        channel: { id: 'ch_listener_test_2', name: 'PJSIP/test', state: 'Up' },
        args: [],
      };

      wsClient.handleRawMessage(JSON.stringify(secondEvent));
      expect(listenerA).toHaveBeenCalledTimes(1); // Unsubscribed
      expect(listenerB).toHaveBeenCalledTimes(2);
    });

    it('gracefully handles malformed JSON without throwing or crashing', () => {
      expect(() => {
        wsClient.handleRawMessage('{ invalid json string ...');
      }).not.toThrow();
    });
  });

  describe('Fail-Closed Disconnection & Waiter Abortion', () => {
    it('aborts all active waiters immediately when WebSocket stream disconnects', async () => {
      let triggerClose: ((e: any) => void) | null = null;

      class MockConnectedSocket {
        public readyState = 1;
        public onopen: any = null;
        public onerror: any = null;
        public onclose: any = null;
        public onmessage: any = null;
        public close = vi.fn();

        constructor() {
          triggerClose = (e: any) => {
            this.readyState = 3;
            if (this.onclose) this.onclose(e);
          };
          setTimeout(() => {
            if (this.onopen) this.onopen();
          }, 5);
        }
      }

      (globalThis as any).WebSocket = MockConnectedSocket;

      await wsClient.connect('callflow-qa', 500);

      const waiter1 = wsClient.waitForEvent('StasisStart', () => true, 5000);
      const waiter2 = wsClient.waitForEvent('RecordingFinished', () => true, 5000);

      // Simulate unexpected server-side socket close mid-call
      triggerClose!({ code: 1006, reason: 'Asterisk process terminated' });

      await expect(waiter1).rejects.toThrowError(/ARI WebSocket stream disconnected during active wait/);
      await expect(waiter2).rejects.toThrowError(/ARI WebSocket stream disconnected during active wait/);
      expect(wsClient.isConnected()).toBe(false);
    });

    it('aborts all active waiters when disconnect() is explicitly called', async () => {
      const waiter = wsClient.waitForEvent('PlaybackFinished', () => true, 5000);
      await wsClient.disconnect();
      await expect(waiter).rejects.toThrowError(/ARI WebSocket disconnected by client/);
    });
  });
});
