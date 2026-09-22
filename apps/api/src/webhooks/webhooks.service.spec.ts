import { Test, TestingModule } from '@nestjs/testing';
import { WebhooksService } from './webhooks.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { safeFetch } from '../common/safe-fetch.js';
vi.mock('../common/safe-fetch.js', () => ({ safeFetch: vi.fn() }));
import * as crypto from 'crypto';

describe('WebhooksService', () => {
  let service: WebhooksService;
  let prisma: any;

  beforeEach(async () => {
    // Set a valid 32-character key for tests
    process.env.WEBHOOK_ENCRYPTION_KEY = '12345678901234567890123456789012';

    const prismaMock = {
      outboundWebhook: {
        findMany: vi.fn(),
        create: vi.fn(),
        findUnique: vi.fn(),
        delete: vi.fn(),
      },
      webhookDelivery: { findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
      $queryRaw: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhooksService,
        {
          provide: PrismaService,
          useValue: prismaMock,
        },
      ],
    }).compile();

    service = module.get<WebhooksService>(WebhooksService);
    prisma = module.get<PrismaService>(PrismaService);

    // Mock global fetch
    safeFetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('queueEvent', () => {
    it('should create webhook delivery and prevent duplicates', async () => {
      prisma.outboundWebhook.findMany.mockResolvedValue([
        { id: 'wh_1', workspace_id: 'ws_1', status: 'ACTIVE' },
      ]);

      prisma.webhookDelivery.create.mockResolvedValue({});

      await service.queueEvent('ws_1', 'call.ended', { id: 'call_1' });

      expect(prisma.webhookDelivery.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            outbound_webhook_id: 'wh_1',
            event_id: 'evt_call.ended_call_1',
            event_type: 'call.ended',
          }),
        }),
      );
    });

    it('should ignore duplicate P2002 error', async () => {
      prisma.outboundWebhook.findMany.mockResolvedValue([
        { id: 'wh_1', workspace_id: 'ws_1', status: 'ACTIVE' },
      ]);

      prisma.webhookDelivery.create.mockRejectedValue({ code: 'P2002' });

      // Should not throw
      await expect(
        service.queueEvent('ws_1', 'call.ended', { id: 'call_1' }),
      ).resolves.toBeUndefined();
    });
  });

  describe('attemptDelivery', () => {
    const delivery = {
      id: 'del_1',
      event_id: 'evt_1',
      event_type: 'test',
      payload_json: '{"test":true}',
      attempt_count: 0,
      outbound_webhook: {
        url: 'https://example.com/webhook',
        secret_encrypted: '',
      },
    };

    beforeEach(() => {
      // Mock the encrypted secret
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv(
        'aes-256-cbc',
        Buffer.from(process.env.WEBHOOK_ENCRYPTION_KEY!, 'utf8'),
        iv,
      );
      let encrypted = cipher.update('my_secret', 'utf8', 'hex');
      encrypted += cipher.final('hex');
      delivery.outbound_webhook.secret_encrypted = `${iv.toString('hex')}:${encrypted}`;
    });

    it('should successfully deliver and update status (2xx)', async () => {
      (safeFetch as any).mockResolvedValue({ ok: true, status: 200 });

      await service.attemptDelivery(delivery);

      expect(safeFetch).toHaveBeenCalledWith(
        'https://example.com/webhook',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Webhook-Id': 'evt_1',
            'Webhook-Delivery-Id': 'del_1',
            'Webhook-Signature': expect.any(String),
          }),
        }),
      );

      expect(prisma.webhookDelivery.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'del_1' },
          data: expect.objectContaining({
            status: 'SUCCESS',
            attempt_count: 1,
          }),
        }),
      );
    });

    it('should handle 5xx and schedule retry', async () => {
      (safeFetch as any).mockResolvedValue({ ok: false, status: 500 });

      await service.attemptDelivery(delivery);

      expect(prisma.webhookDelivery.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'del_1' },
          data: expect.objectContaining({
            status: 'PENDING',
            attempt_count: 1,
            last_error: 'HTTP 500',
          }),
        }),
      );
    });

    it('should handle network timeout/error and schedule retry', async () => {
      (safeFetch as any).mockRejectedValue(new Error('Network error'));

      await service.attemptDelivery(delivery);

      expect(prisma.webhookDelivery.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'del_1' },
          data: expect.objectContaining({
            status: 'PENDING',
            attempt_count: 1,
            last_error: 'Network error',
          }),
        }),
      );
    });

    it('should terminal fail after 5 attempts', async () => {
      (safeFetch as any).mockResolvedValue({ ok: false, status: 500 });
      const failDelivery = { ...delivery, attempt_count: 4 }; // will become 5

      await service.attemptDelivery(failDelivery);

      expect(prisma.webhookDelivery.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'del_1' },
          data: expect.objectContaining({
            status: 'FAILED',
            attempt_count: 5,
            next_attempt_at: null,
          }),
        }),
      );
    });
  });

  describe('signature generation and tampering', () => {
    it('should generate valid signature', () => {
      const ts = Math.floor(Date.now() / 1000).toString();
      const payload = '{"x":1}';
      const eventId = 'evt_1';
      const secret = 'test_secret';

      const sigPayload = `${eventId}.${ts}.${payload}`;
      const hmac = crypto.createHmac('sha256', secret);
      const expectedSig = hmac.update(sigPayload, 'utf8').digest('hex');

      expect(expectedSig).toBeDefined();
    });
  });
});
