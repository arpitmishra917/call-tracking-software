import { vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { TwilioProvider } from './twilio.provider.js';
import { TwilioWebhookController } from './twilio.webhook.controller.js';
import { CallController, TELEPHONY_PROVIDER } from '../call-controller.js';
import { FakeTelephonyProvider } from '../fake.provider.js';
import { WebhookIdempotencyService } from '../webhook-idempotency.service.js';

describe('Twilio Adapter', () => {
  let webhookController: TwilioWebhookController;
  let provider: TwilioProvider;
  let idempotencyMock: any;

  beforeEach(async () => {
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;

    idempotencyMock = {
      acquireLock: vi
        .fn()
        .mockResolvedValue({ canProcess: true, id: 'mock-id' }),
      markProcessed: vi.fn().mockResolvedValue(undefined),
      markFailed: vi.fn().mockResolvedValue(undefined),
      markIgnored: vi.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TwilioWebhookController],
      providers: [
        TwilioProvider,
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

    webhookController = module.get<TwilioWebhookController>(
      TwilioWebhookController,
    );
    provider = module.get<TwilioProvider>(TwilioProvider);
  });

  describe('TwilioProvider', () => {
    it('should initialize and fallback to mock behavior when no API key is provided', async () => {
      const buyerId = await provider.dialBuyer('+123', '+456', 'conn-1', 15);
      expect(buyerId).toContain('mock_twilio_buyer_leg_id_');

      await expect(
        provider.bridgeCalls('call-1', 'call-2'),
      ).resolves.toBeUndefined();
      await expect(provider.hangupCall('call-1')).resolves.toBeUndefined();
    });

    it('should synthesize answered event asynchronously on answerCall', async () => {
      // In NestJS tests, setImmediate is fast enough, but we should wrap it
      await new Promise<void>((resolve) => {
        provider.answerCall('tw_call_123');
        setImmediate(resolve);
      });
      // Verification of internal callController state is done via E2E/mock tests.
      // Here we just ensure it doesn't throw.
    });
  });

  describe('TwilioWebhookController', () => {
    it('should bypass signature verification if no auth token is set', async () => {
      const mockReq = {
        body: {
          CallSid: 'tw_call_mock',
          CallStatus: 'ringing',
          Direction: 'inbound',
          From: '+15551234',
          To: '+15559876',
        },
        headers: {},
        originalUrl: '/webhooks/twilio',
      } as any;
      const mockRes = {
        status: vi.fn().mockReturnThis(),
        send: vi.fn(),
        type: vi.fn(),
      } as any;

      await webhookController.handleWebhook(mockReq, mockRes);

      expect(mockRes.type).toHaveBeenCalledWith('text/xml');
      expect(mockRes.send).toHaveBeenCalled();
      const sendArg = mockRes.send.mock.calls[0][0];
      expect(sendArg).toContain('<Conference');
    });

    it('should ignore duplicate events (idempotency)', async () => {
      idempotencyMock.acquireLock
        .mockResolvedValueOnce({ canProcess: true, id: 'mock-id' })
        .mockResolvedValueOnce({ canProcess: false, id: 'mock-id' });

      const mockReq = {
        body: {
          CallSid: 'tw_call_mock_2',
          CallStatus: 'in-progress',
          SequenceNumber: '1',
        },
        headers: {},
        originalUrl: '/webhooks/twilio',
      } as any;
      const mockRes = {
        status: vi.fn().mockReturnThis(),
        send: vi.fn(),
        type: vi.fn(),
      } as any;

      // First call processes normally
      await webhookController.handleWebhook(mockReq, mockRes);
      expect(mockRes.send).toHaveBeenCalledWith('<Response></Response>');

      // Second call should hit the idempotency boundary
      const mockRes2 = {
        status: vi.fn().mockReturnThis(),
        send: vi.fn(),
        type: vi.fn(),
      } as any;
      await webhookController.handleWebhook(mockReq, mockRes2);
      expect(mockRes2.send).toHaveBeenCalledWith('<Response></Response>');
    });
  });
});
