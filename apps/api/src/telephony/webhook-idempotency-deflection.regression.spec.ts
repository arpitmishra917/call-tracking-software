import { vi, describe, it, expect, beforeEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { WebhookIdempotencyService } from './webhook-idempotency.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { WebhookStatus } from '@prisma/client';

describe('Layer 1 & 2 Regression: Webhook Idempotency & Duplicate Event Deflection', () => {
  let idempotencyService: WebhookIdempotencyService;
  let prismaMock: any;

  const mockProvider = 'telnyx';
  const mockEventId = 'evt-telnyx-unique-999';
  const mockPayload = { event_type: 'call.hangup', call_control_id: 'v3:ctrl-123' };

  beforeEach(async () => {
    prismaMock = {
      webhookEvent: {
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhookIdempotencyService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    idempotencyService = module.get<WebhookIdempotencyService>(WebhookIdempotencyService);
  });

  describe('Initial Delivery & Lease Token Issuance', () => {
    it('acquires lock for new event, persists PENDING status with lease marker, and returns leaseToken', async () => {
      prismaMock.webhookEvent.findUnique.mockResolvedValue(null);
      prismaMock.webhookEvent.create.mockResolvedValue({
        id: 'wh-record-1',
        provider: mockProvider,
        providerEventId: mockEventId,
        status: WebhookStatus.PENDING,
      });

      const lock = await idempotencyService.acquireLock(mockProvider, mockEventId, mockPayload);

      expect(lock.canProcess).toBe(true);
      expect(lock.id).toBe('wh-record-1');
      expect(lock.leaseToken).toBeDefined();
      expect(typeof lock.leaseToken).toBe('string');

      expect(prismaMock.webhookEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          provider: mockProvider,
          providerEventId: mockEventId,
          status: WebhookStatus.PENDING,
          error: expect.stringContaining('lease:'),
          payload: mockPayload,
        }),
      });
    });
  });

  describe('Duplicate Event Deflection (Idempotency Safe Guard)', () => {
    it('deflects duplicate event when event has already been PROCESSED (safe NO-OP)', async () => {
      prismaMock.webhookEvent.findUnique.mockResolvedValue({
        id: 'wh-record-processed',
        provider: mockProvider,
        providerEventId: mockEventId,
        status: WebhookStatus.PROCESSED,
        updatedAt: new Date(),
      });

      const lock = await idempotencyService.acquireLock(mockProvider, mockEventId, mockPayload);

      // Deflected!
      expect(lock.canProcess).toBe(false);
      expect(lock.id).toBe('wh-record-processed');
      expect(lock.leaseToken).toBeUndefined();
      expect(prismaMock.webhookEvent.create).not.toHaveBeenCalled();
      expect(prismaMock.webhookEvent.updateMany).not.toHaveBeenCalled();
    });

    it('deflects duplicate event when event is currently and actively PENDING (< 5 min old)', async () => {
      prismaMock.webhookEvent.findUnique.mockResolvedValue({
        id: 'wh-record-active',
        provider: mockProvider,
        providerEventId: mockEventId,
        status: WebhookStatus.PENDING,
        updatedAt: new Date(Date.now() - 30 * 1000), // 30 seconds ago (active lease)
      });

      const lock = await idempotencyService.acquireLock(mockProvider, mockEventId, mockPayload);

      // Deflected! Active worker holds the lease
      expect(lock.canProcess).toBe(false);
      expect(lock.id).toBe('wh-record-active');
      expect(lock.leaseToken).toBeUndefined();
      expect(prismaMock.webhookEvent.updateMany).not.toHaveBeenCalled();
    });

    it('deflects concurrent race condition when unique constraint violation (P2002) is caught', async () => {
      prismaMock.webhookEvent.findUnique.mockResolvedValue(null);
      const p2002Error: any = new Error('Unique constraint failed');
      p2002Error.code = 'P2002';
      prismaMock.webhookEvent.create.mockRejectedValue(p2002Error);

      const lock = await idempotencyService.acquireLock(mockProvider, mockEventId, mockPayload);

      expect(lock.canProcess).toBe(false);
      expect(lock.leaseToken).toBeUndefined();
    });
  });

  describe('Stale Lock Recovery & Retry Handling', () => {
    it('recovers stale lock when event stuck in PENDING > 5 minutes via atomic conditional update', async () => {
      const staleTime = new Date(Date.now() - 6 * 60 * 1000); // 6 minutes ago (> 5m threshold)
      prismaMock.webhookEvent.findUnique.mockResolvedValue({
        id: 'wh-record-stale',
        provider: mockProvider,
        providerEventId: mockEventId,
        status: WebhookStatus.PENDING,
        updatedAt: staleTime,
      });

      // Conditional atomic update succeeds
      prismaMock.webhookEvent.updateMany.mockResolvedValue({ count: 1 });

      const lock = await idempotencyService.acquireLock(mockProvider, mockEventId, mockPayload);

      expect(lock.canProcess).toBe(true);
      expect(lock.id).toBe('wh-record-stale');
      expect(lock.leaseToken).toBeDefined();

      expect(prismaMock.webhookEvent.updateMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          id: 'wh-record-stale',
          status: WebhookStatus.PENDING,
          updatedAt: expect.objectContaining({ lte: expect.any(Date) }),
        }),
        data: expect.objectContaining({
          status: WebhookStatus.PENDING,
          error: expect.stringContaining('lease:'),
        }),
      });
    });

    it('deflects stale recovery when another worker already claimed it concurrently (count === 0)', async () => {
      const staleTime = new Date(Date.now() - 6 * 60 * 1000);
      prismaMock.webhookEvent.findUnique.mockResolvedValue({
        id: 'wh-record-stale',
        provider: mockProvider,
        providerEventId: mockEventId,
        status: WebhookStatus.PENDING,
        updatedAt: staleTime,
      });

      // Lost race to claim stale lock
      prismaMock.webhookEvent.updateMany.mockResolvedValue({ count: 0 });

      const lock = await idempotencyService.acquireLock(mockProvider, mockEventId, mockPayload);

      expect(lock.canProcess).toBe(false);
      expect(lock.id).toBe('wh-record-stale');
      expect(lock.leaseToken).toBeUndefined();
    });

    it('allows atomic retry for previously FAILED or IGNORED events', async () => {
      prismaMock.webhookEvent.findUnique.mockResolvedValue({
        id: 'wh-record-failed',
        provider: mockProvider,
        providerEventId: mockEventId,
        status: WebhookStatus.FAILED,
      });

      prismaMock.webhookEvent.updateMany.mockResolvedValue({ count: 1 });

      const lock = await idempotencyService.acquireLock(mockProvider, mockEventId, mockPayload);

      expect(lock.canProcess).toBe(true);
      expect(lock.id).toBe('wh-record-failed');
      expect(lock.leaseToken).toBeDefined();
      expect(prismaMock.webhookEvent.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'wh-record-failed',
          status: { in: [WebhookStatus.FAILED, WebhookStatus.IGNORED] },
        },
        data: expect.objectContaining({
          status: WebhookStatus.PENDING,
          error: expect.stringContaining('lease:'),
        }),
      });
    });
  });

  describe('markProcessed, markFailed, and markIgnored Fencing Integrity', () => {
    it('successfully transitions event to PROCESSED when leaseToken matches', async () => {
      const leaseToken = 'token-1234';
      prismaMock.webhookEvent.updateMany.mockResolvedValue({ count: 1 });

      const success = await idempotencyService.markProcessed('wh-1', leaseToken);

      expect(success).toBe(true);
      expect(prismaMock.webhookEvent.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'wh-1',
          status: WebhookStatus.PENDING,
          error: `lease:${leaseToken}`,
        },
        data: {
          status: WebhookStatus.PROCESSED,
          error: null,
        },
      });
    });

    it('transitions event to FAILED with error message on processing failure', async () => {
      const leaseToken = 'token-1234';
      prismaMock.webhookEvent.updateMany.mockResolvedValue({ count: 1 });

      const success = await idempotencyService.markFailed('wh-1', 'Database timeout', leaseToken);

      expect(success).toBe(true);
      expect(prismaMock.webhookEvent.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'wh-1',
          status: WebhookStatus.PENDING,
          error: `lease:${leaseToken}`,
        },
        data: {
          status: WebhookStatus.FAILED,
          error: 'Database timeout',
        },
      });
    });

    it('transitions event to IGNORED with reason when event is not actionable', async () => {
      const leaseToken = 'token-1234';
      prismaMock.webhookEvent.updateMany.mockResolvedValue({ count: 1 });

      const success = await idempotencyService.markIgnored('wh-1', 'Unhandled call state', leaseToken);

      expect(success).toBe(true);
      expect(prismaMock.webhookEvent.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'wh-1',
          status: WebhookStatus.PENDING,
          error: `lease:${leaseToken}`,
        },
        data: {
          status: WebhookStatus.IGNORED,
          error: 'Unhandled call state',
        },
      });
    });

    it('rejects state transition when leaseToken has expired or was revoked (count === 0)', async () => {
      const oldLeaseToken = 'token-old';
      prismaMock.webhookEvent.updateMany.mockResolvedValue({ count: 0 });

      const success = await idempotencyService.markProcessed('wh-1', oldLeaseToken);

      expect(success).toBe(false);
    });

    it('rejects markProcessed and markFailed if mandatory parameters are missing', async () => {
      expect(await idempotencyService.markProcessed('', 'token')).toBe(false);
      expect(await idempotencyService.markProcessed('wh-1', '')).toBe(false);
      expect(await idempotencyService.markFailed('', 'err', 'token')).toBe(false);
      expect(await idempotencyService.markFailed('wh-1', 'err', '')).toBe(false);
    });
  });
});
