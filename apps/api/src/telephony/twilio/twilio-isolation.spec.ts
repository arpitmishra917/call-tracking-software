import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { TelephonyModule } from '../telephony.module.js';
import { TELEPHONY_PROVIDER } from '../call-controller.js';
import { TelnyxProvider } from '../telnyx/telnyx.provider.js';
import { TwilioProvider } from './twilio.provider.js';
import { TwilioWebhookController } from './twilio.webhook.controller.js';
import { TelnyxWebhookController } from '../telnyx/telnyx.webhook.controller.js';
import { WebhookIdempotencyService } from '../webhook-idempotency.service.js';
import { CallController } from '../call-controller.js';
import { BadRequestException } from '@nestjs/common';

describe('Twilio Legacy Isolation & Retirement Verification (BUG-BE-002)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    delete process.env.TELEPHONY_PROVIDER;
    delete process.env.ACTIVE_TELEPHONY_PROVIDER;
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.TWILIO_ACCOUNT_SID;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('1. Active Telephony Provider Enforcement', () => {
    it('TELEPHONY_PROVIDER resolves to TelnyxProvider by default', async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          {
            provide: TelnyxProvider,
            useValue: { isTelnyx: true },
          },
          {
            provide: TELEPHONY_PROVIDER,
            useFactory: (telnyx: any) => {
              const configured = (
                process.env.TELEPHONY_PROVIDER ||
                process.env.ACTIVE_TELEPHONY_PROVIDER ||
                ''
              ).toLowerCase();
              if (configured === 'twilio') {
                throw new Error(
                  'FATAL: Twilio provider has been retired and disabled. CallFlow exclusively uses Telnyx as its telephony provider.',
                );
              }
              return telnyx;
            },
            inject: [TelnyxProvider],
          },
        ],
      }).compile();

      const provider = module.get(TELEPHONY_PROVIDER);
      expect(provider).toBeDefined();
      expect(provider.isTelnyx).toBe(true);
    });

    it('Setting TELEPHONY_PROVIDER=twilio throws FATAL retirement error', async () => {
      process.env.TELEPHONY_PROVIDER = 'twilio';

      expect(() => {
        const configured = (
          process.env.TELEPHONY_PROVIDER ||
          process.env.ACTIVE_TELEPHONY_PROVIDER ||
          ''
        ).toLowerCase();
        if (configured === 'twilio') {
          throw new Error(
            'FATAL: Twilio provider has been retired and disabled. CallFlow exclusively uses Telnyx as its telephony provider.',
          );
        }
      }).toThrowError(/Twilio provider has been retired and disabled/);
    });

    it('Setting ACTIVE_TELEPHONY_PROVIDER=twilio throws FATAL retirement error', async () => {
      process.env.ACTIVE_TELEPHONY_PROVIDER = 'twilio';

      expect(() => {
        const configured = (
          process.env.TELEPHONY_PROVIDER ||
          process.env.ACTIVE_TELEPHONY_PROVIDER ||
          ''
        ).toLowerCase();
        if (configured === 'twilio') {
          throw new Error(
            'FATAL: Twilio provider has been retired and disabled. CallFlow exclusively uses Telnyx as its telephony provider.',
          );
        }
      }).toThrowError(/Twilio provider has been retired and disabled/);
    });
  });

  describe('2. TelephonyModule Controller Registration', () => {
    it('TwilioWebhookController is NOT registered in TelephonyModule controllers metadata', () => {
      const controllers = Reflect.getMetadata('controllers', TelephonyModule);
      expect(controllers).toBeDefined();
      expect(controllers).not.toContain(TwilioWebhookController);
      expect(controllers).toContain(TelnyxWebhookController);
    });
  });

  describe('3. Twilio Webhook Fail-Closed Behavior', () => {
    it('TwilioWebhookController rejects unauthenticated webhook requests with 403 Forbidden', async () => {
      delete process.env.TWILIO_AUTH_TOKEN;

      const callController = { handleEvent: vi.fn() } as any;
      const twilioProvider = { validateWebhook: vi.fn() } as any;
      const idempotency = { acquireLock: vi.fn() } as any;

      const controller = new TwilioWebhookController(
        callController,
        twilioProvider,
        idempotency,
      );

      const req: any = {
        headers: {},
        body: { CallSid: 'CA12345', CallStatus: 'in-progress' },
        originalUrl: '/webhooks/twilio',
      };
      const res: any = {
        status: vi.fn().mockReturnThis(),
        send: vi.fn().mockReturnThis(),
      };

      await controller.handleWebhook(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.send).toHaveBeenCalledWith('Forbidden: Twilio provider is retired');
      expect(callController.handleEvent).not.toHaveBeenCalled();
      expect(idempotency.acquireLock).not.toHaveBeenCalled();
    });

    it('TwilioWebhookController rejects requests when signature is missing', async () => {
      process.env.TWILIO_AUTH_TOKEN = 'secret_token';

      const callController = { handleEvent: vi.fn() } as any;
      const twilioProvider = { validateWebhook: vi.fn() } as any;
      const idempotency = { acquireLock: vi.fn() } as any;

      const controller = new TwilioWebhookController(
        callController,
        twilioProvider,
        idempotency,
      );

      const req: any = {
        headers: {}, // Missing x-twilio-signature
        body: { CallSid: 'CA12345' },
        originalUrl: '/webhooks/twilio',
      };
      const res: any = {
        status: vi.fn().mockReturnThis(),
        send: vi.fn().mockReturnThis(),
      };

      await controller.handleWebhook(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.send).toHaveBeenCalledWith('Forbidden: Twilio provider is retired');
      expect(callController.handleEvent).not.toHaveBeenCalled();
    });
  });

  describe('4. Strict Telnyx Signature Verification', () => {
    it('TelnyxWebhookController rejects requests missing raw body or signature with 400', async () => {
      const callController = { handleEvent: vi.fn() } as any;
      const idempotency = { acquireLock: vi.fn() } as any;

      const controller = new TelnyxWebhookController(callController, idempotency);

      const req: any = {
        rawBody: undefined,
        headers: {},
      };
      const res: any = {
        status: vi.fn().mockReturnThis(),
        send: vi.fn().mockReturnThis(),
      };

      await expect(controller.handleWebhook(req, res)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('TelnyxWebhookController fails closed in QA/Prod when TELNYX_PUBLIC_KEY is missing', async () => {
      process.env.APP_ENV = 'qa';
      delete process.env.TELNYX_PUBLIC_KEY;

      const callController = { handleEvent: vi.fn() } as any;
      const idempotency = { acquireLock: vi.fn() } as any;

      const controller = new TelnyxWebhookController(callController, idempotency);

      const req: any = {
        rawBody: Buffer.from(JSON.stringify({ data: { id: 'evt-1' } })),
        headers: {
          'telnyx-signature-ed25519': 'invalid_sig',
          'telnyx-timestamp': '1234567890',
        },
      };
      const res: any = {
        status: vi.fn().mockReturnThis(),
        send: vi.fn().mockReturnThis(),
      };

      await controller.handleWebhook(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.send).toHaveBeenCalledWith(
        expect.stringContaining(
          'TELNYX_PUBLIC_KEY is required for webhook signature verification',
        ),
      );
      expect(callController.handleEvent).not.toHaveBeenCalled();
      expect(idempotency.acquireLock).not.toHaveBeenCalled();
    });
  });
});
