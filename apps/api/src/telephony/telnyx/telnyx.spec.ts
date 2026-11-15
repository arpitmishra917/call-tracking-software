import { vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { TelnyxProvider } from './telnyx.provider.js';
import { TelnyxWebhookController } from './telnyx.webhook.controller.js';
import { CallController, TELEPHONY_PROVIDER } from '../call-controller.js';
import { FakeTelephonyProvider } from '../fake.provider.js';
import { WebhookIdempotencyService } from '../webhook-idempotency.service.js';

describe('Telnyx Adapter', () => {
  let webhookController: TelnyxWebhookController;
  let provider: TelnyxProvider;
  let idempotencyMock: any;

  beforeEach(async () => {
    delete process.env.TELNYX_API_KEY;
    delete process.env.TELNYX_PUBLIC_KEY;

    idempotencyMock = {
      acquireLock: vi
        .fn()
        .mockResolvedValue({ canProcess: true, id: 'mock-id', leaseToken: 'mock-lease-token' }),
      markProcessed: vi.fn().mockResolvedValue(true),
      markFailed: vi.fn().mockResolvedValue(true),
      markIgnored: vi.fn().mockResolvedValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TelnyxWebhookController],
      providers: [
        TelnyxProvider,
        {
          provide: TELEPHONY_PROVIDER,
          useClass: FakeTelephonyProvider,
        },
        {
          provide: WebhookIdempotencyService,
          useValue: idempotencyMock,
        },
        {
          provide: CallController,
          useValue: { handleEvent: vi.fn().mockResolvedValue(undefined) },
        },
      ],
    }).compile();

    webhookController = module.get<TelnyxWebhookController>(
      TelnyxWebhookController,
    );
    provider = module.get<TelnyxProvider>(TelnyxProvider);
  });

  describe('TelnyxProvider', () => {
    it('should initialize and fallback to mock behavior when no API key is provided', async () => {
      // By default tests don't have TELNYX_API_KEY set
      await expect(provider.answerCall('call-123')).resolves.toBeUndefined();

      const buyerId = await provider.dialBuyer('+123', '+456', 'conn-1', 15);
      expect(buyerId).toContain('mock_buyer_leg_id_');

      await expect(
        provider.bridgeCalls('call-1', 'call-2'),
      ).resolves.toBeUndefined();
      await expect(provider.hangupCall('call-1')).resolves.toBeUndefined();
    });

    it('should call telnyxClient.calls.dial when API key is present', async () => {
      // Manually instantiate to test with a fake API key
      process.env.TELNYX_API_KEY = 'fake-api-key';
      const activeProvider = new TelnyxProvider();

      // Mock the internal telnyxClient which gets created in constructor
      const mockDial = vi.fn().mockResolvedValue({
        data: { call_control_id: 'real_call_id' },
      });
      (activeProvider as any).telnyxClient = {
        calls: {
          dial: mockDial,
        },
      };

      const result = await activeProvider.dialBuyer(
        '+15555555555',
        '+16666666666',
        'conn-123',
        30,
      );

      expect(result).toBe('real_call_id');
      expect(mockDial).toHaveBeenCalledWith({
        to: '+15555555555',
        from: '+16666666666',
        connection_id: 'conn-123',
        timeout_secs: 30,
      });
    });

    it('should call telnyxClient.calls.actions.startRecording when API key is present', async () => {
      process.env.TELNYX_API_KEY = 'fake-api-key';
      const activeProvider = new TelnyxProvider();

      const mockStartRecording = vi.fn().mockResolvedValue({});
      (activeProvider as any).telnyxClient = {
        calls: {
          actions: {
            startRecording: mockStartRecording,
          },
        },
      };

      await activeProvider.startRecording('call-123');

      expect(mockStartRecording).toHaveBeenCalledWith('call-123', {
        channels: 'dual',
        format: 'mp3',
      });
    });

    it('should retrieve recording url from Telnyx', async () => {
      process.env.TELNYX_API_KEY = 'fake-api-key';
      const activeProvider = new TelnyxProvider();

      const mockRetrieve = vi.fn().mockResolvedValue({
        data: { download_urls: { mp3: 'https://telnyx.com/recording.mp3' } },
      });
      (activeProvider as any).telnyxClient = {
        recordings: {
          retrieve: mockRetrieve,
        },
      };

      const url = await activeProvider.getRecordingUrl('rec-123');

      expect(url).toBe('https://telnyx.com/recording.mp3');
      expect(mockRetrieve).toHaveBeenCalledWith('rec-123');
    });
  });

  describe('getCallStatus', () => {
    let activeProvider: TelnyxProvider;
    let mockRetrieveStatus: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      process.env.TELNYX_API_KEY = 'fake-api-key';
      activeProvider = new TelnyxProvider();
      mockRetrieveStatus = vi.fn();
      (activeProvider as any).telnyxClient = {
        calls: {
          retrieveStatus: mockRetrieveStatus,
        },
      };
    });

    it('A. should map active states to ProviderCallStatus.ACTIVE', async () => {
      mockRetrieveStatus.mockResolvedValue({
        data: { call_state: 'active' },
      });
      const status = await activeProvider.getCallStatus('call-123');
      expect(status).toBe('ACTIVE');
    });

    it('B. should map terminal states to ProviderCallStatus.TERMINAL', async () => {
      mockRetrieveStatus.mockResolvedValue({
        data: { call_state: 'hangup' },
      });
      const status = await activeProvider.getCallStatus('call-123');
      expect(status).toBe('TERMINAL');
    });

    it('C. should map 404 to ProviderCallStatus.NOT_FOUND', async () => {
      mockRetrieveStatus.mockRejectedValue({
        raw: { status: 404 },
      });
      const status = await activeProvider.getCallStatus('call-123');
      expect(status).toBe('NOT_FOUND');
    });

    it('D. should map other SDK/network errors to ProviderCallStatus.UNKNOWN', async () => {
      mockRetrieveStatus.mockRejectedValue(new Error('Network error'));
      const status = await activeProvider.getCallStatus('call-123');
      expect(status).toBe('UNKNOWN');
    });
  });

  describe('TelnyxWebhookController', () => {
    it('should reject missing headers', async () => {
      const mockReq = {
        rawBody: Buffer.from('{}'),
        headers: {},
      } as any;
      const mockRes = {
        status: vi.fn().mockReturnThis(),
        send: vi.fn(),
      } as any;

      await expect(
        webhookController.handleWebhook(mockReq, mockRes),
      ).rejects.toThrow('Missing webhook signature headers or body');
    });

    it('should process webhook when public key is not configured (fallback mode)', async () => {
      const mockEvent = {
        data: {
          id: 'evt_test_1',
          event_type: 'call.initiated',
          payload: {
            call_control_id: 'call_1',
            direction: 'incoming',
          },
        },
      };

      const mockReq = {
        rawBody: Buffer.from(JSON.stringify(mockEvent)),
        body: mockEvent,
        headers: {
          'telnyx-signature-ed25519': 'fake-sig',
          'telnyx-timestamp': '123456789',
        },
      } as any;
      const mockRes = {
        status: vi.fn().mockReturnThis(),
        send: vi.fn(),
      } as any;

      await webhookController.handleWebhook(mockReq, mockRes);
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.send).toHaveBeenCalledWith('OK');
    });

    it('should reject webhook with 400 when TELNYX_PUBLIC_KEY is missing in QA environment', async () => {
      const originalAppEnv = process.env.APP_ENV;
      process.env.APP_ENV = 'qa';
      delete process.env.TELNYX_PUBLIC_KEY;

      const mockEvent = {
        data: {
          id: 'evt_qa_unverified',
          event_type: 'call.initiated',
        },
      };

      const mockReq = {
        rawBody: Buffer.from(JSON.stringify(mockEvent)),
        body: mockEvent,
        headers: {
          'telnyx-signature-ed25519': 'fake-sig',
          'telnyx-timestamp': '123456789',
        },
      } as any;
      const mockRes = {
        status: vi.fn().mockReturnThis(),
        send: vi.fn(),
      } as any;

      try {
        await webhookController.handleWebhook(mockReq, mockRes);
        expect(mockRes.status).toHaveBeenCalledWith(400);
        expect(mockRes.send).toHaveBeenCalledWith(
          expect.stringContaining('TELNYX_PUBLIC_KEY is required'),
        );
      } finally {
        if (originalAppEnv !== undefined) {
          process.env.APP_ENV = originalAppEnv;
        } else {
          delete process.env.APP_ENV;
        }
      }
    });

    it('should reject webhook with 400 when TELNYX_PUBLIC_KEY is missing in production environment', async () => {
      const originalNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      delete process.env.TELNYX_PUBLIC_KEY;

      const mockEvent = {
        data: {
          id: 'evt_prod_unverified',
          event_type: 'call.initiated',
        },
      };

      const mockReq = {
        rawBody: Buffer.from(JSON.stringify(mockEvent)),
        body: mockEvent,
        headers: {
          'telnyx-signature-ed25519': 'fake-sig',
          'telnyx-timestamp': '123456789',
        },
      } as any;
      const mockRes = {
        status: vi.fn().mockReturnThis(),
        send: vi.fn(),
      } as any;

      try {
        await webhookController.handleWebhook(mockReq, mockRes);
        expect(mockRes.status).toHaveBeenCalledWith(400);
        expect(mockRes.send).toHaveBeenCalledWith(
          expect.stringContaining('TELNYX_PUBLIC_KEY is required'),
        );
      } finally {
        if (originalNodeEnv !== undefined) {
          process.env.NODE_ENV = originalNodeEnv;
        } else {
          delete process.env.NODE_ENV;
        }
      }
    });

    it('should reject webhook with 400 when cryptographic signature verification fails', async () => {
      process.env.TELNYX_PUBLIC_KEY = 'invalid-or-dummy-key';

      const mockEvent = {
        data: {
          id: 'evt_bad_sig',
          event_type: 'call.initiated',
        },
      };

      const mockReq = {
        rawBody: Buffer.from(JSON.stringify(mockEvent)),
        body: mockEvent,
        headers: {
          'telnyx-signature-ed25519': 'forged_sig',
          'telnyx-timestamp': '123456789',
        },
      } as any;
      const mockRes = {
        status: vi.fn().mockReturnThis(),
        send: vi.fn(),
      } as any;

      await webhookController.handleWebhook(mockReq, mockRes);
      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.send).toHaveBeenCalledWith(
        expect.stringContaining('Webhook Error:'),
      );
    });

    it('should ignore duplicate events (idempotency)', async () => {
      idempotencyMock.acquireLock
        .mockResolvedValueOnce({ canProcess: true, id: 'mock-id', leaseToken: 'mock-lease-token' })
        .mockResolvedValueOnce({ canProcess: false, id: 'mock-id' });

      const mockEvent = {
        data: {
          id: 'evt_test_2',
          event_type: 'call.initiated',
        },
      };

      const mockReq = {
        rawBody: Buffer.from(JSON.stringify(mockEvent)),
        body: mockEvent,
        headers: {
          'telnyx-signature-ed25519': 'fake-sig',
          'telnyx-timestamp': '123456789',
        },
      } as any;
      const mockRes = {
        status: vi.fn().mockReturnThis(),
        send: vi.fn(),
      } as any;

      // First call processes normally
      await webhookController.handleWebhook(mockReq, mockRes);
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.send).toHaveBeenCalledWith('OK');

      // Second call should hit the idempotency boundary
      const mockRes2 = {
        status: vi.fn().mockReturnThis(),
        send: vi.fn(),
      } as any;
      await webhookController.handleWebhook(mockReq, mockRes2);
      expect(mockRes2.status).toHaveBeenCalledWith(200);
      expect(mockRes2.send).toHaveBeenCalledWith('Duplicate');
    });

    it('should parse call.recording.saved correctly', async () => {
      const mockEvent = {
        data: {
          id: 'evt_test_recording',
          event_type: 'call.recording.saved',
          payload: {
            call_control_id: 'call_1',
            recording_id: 'rec_123',
            recording_urls: {
              mp3: 'https://telnyx.com/rec.mp3',
            },
          },
        },
      };

      const mockReq = {
        rawBody: Buffer.from(JSON.stringify(mockEvent)),
        body: mockEvent,
        headers: {
          'telnyx-signature-ed25519': 'fake-sig',
          'telnyx-timestamp': '123456789',
        },
      } as any;
      const mockRes = {
        status: vi.fn().mockReturnThis(),
        send: vi.fn(),
      } as any;

      const callController = (webhookController as any).callController;

      await webhookController.handleWebhook(mockReq, mockRes);

      expect(callController.handleEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'CALL_RECORDING_SAVED',
          callId: 'call_1',
          recordingId: 'rec_123',
          recordingUrl: 'https://telnyx.com/rec.mp3',
        }),
      );
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.send).toHaveBeenCalledWith('OK');
    });
  });
});
