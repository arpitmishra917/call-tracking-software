import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { WebhookIdempotencyService } from './webhook-idempotency.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { WebhookStatus } from '@prisma/client';

describe('WebhookIdempotencyService Concurrency & Hardening Suite (BUG-BE-003)', () => {
  let service: WebhookIdempotencyService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
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
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<WebhookIdempotencyService>(WebhookIdempotencyService);
  });

  describe('1. Initial Webhook Delivery & Mutual Exclusion', () => {
    it('acquires lock for new event on first delivery', async () => {
      prisma.webhookEvent.findUnique.mockResolvedValue(null);
      prisma.webhookEvent.create.mockResolvedValue({ id: 'evt-1' });

      const result = await service.acquireLock('telnyx', 'evt_123', {
        type: 'call.initiated',
      });
      expect(result.canProcess).toBe(true);
      expect(result.id).toBe('evt-1');
      expect(result.leaseToken).toBeDefined();
      expect(prisma.webhookEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            provider: 'telnyx',
            providerEventId: 'evt_123',
            status: WebhookStatus.PENDING,
            error: expect.stringMatching(/^lease:[0-9a-f-]+$/),
          }),
        }),
      );
    });

    it('simultaneous webhook delivery by two workers: only one worker acquires lock via unique constraint', async () => {
      // Both workers find no existing record
      prisma.webhookEvent.findUnique.mockResolvedValue(null);

      // Worker 1 creates successfully
      prisma.webhookEvent.create.mockResolvedValueOnce({ id: 'evt-1' });
      // Worker 2 fails with P2002 unique constraint violation
      prisma.webhookEvent.create.mockRejectedValueOnce({
        code: 'P2002',
        message: 'Unique constraint failed on the fields: (`provider`,`providerEventId`)',
      });

      const [result1, result2] = await Promise.all([
        service.acquireLock('telnyx', 'evt_race', { worker: 1 }),
        service.acquireLock('telnyx', 'evt_race', { worker: 2 }),
      ]);

      expect(result1.canProcess).toBe(true);
      expect(result1.id).toBe('evt-1');
      expect(result1.leaseToken).toBeDefined();

      expect(result2.canProcess).toBe(false);
      expect(result2.id).toBeUndefined();
    });
  });

  describe('2. Active Lock Protection', () => {
    it('disallows processing and protects active PENDING event within 5-minute lease window', async () => {
      prisma.webhookEvent.findUnique.mockResolvedValue({
        id: 'evt-1',
        status: WebhookStatus.PENDING,
        updatedAt: new Date(Date.now() - 60 * 1000), // 1 minute ago (active lease!)
      });

      const result = await service.acquireLock('telnyx', 'evt_123', {});
      expect(result.canProcess).toBe(false);
      expect(result.id).toBe('evt-1');
      expect(prisma.webhookEvent.updateMany).not.toHaveBeenCalled();
    });

    it('duplicate webhook deliveries after PROCESSED cannot execute business logic twice', async () => {
      prisma.webhookEvent.findUnique.mockResolvedValue({
        id: 'evt-1',
        status: WebhookStatus.PROCESSED,
      });

      const result = await service.acquireLock('telnyx', 'evt_123', {});
      expect(result.canProcess).toBe(false);
      expect(result.id).toBe('evt-1');
      expect(prisma.webhookEvent.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('3. Stale-Lock Recovery & Race Conditions', () => {
    it('worker crash and recovery: recovers stale PENDING event older than 5 minutes', async () => {
      prisma.webhookEvent.findUnique.mockResolvedValue({
        id: 'evt-1',
        status: WebhookStatus.PENDING,
        updatedAt: new Date(Date.now() - 10 * 60 * 1000), // 10 minutes ago (crashed worker)
      });
      // Conditional update succeeds (count: 1)
      prisma.webhookEvent.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.acquireLock('telnyx', 'evt_123', {
        retried: true,
      });
      expect(result.canProcess).toBe(true);
      expect(result.id).toBe('evt-1');
      expect(result.leaseToken).toBeDefined();
      expect(prisma.webhookEvent.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'evt-1',
          status: WebhookStatus.PENDING,
          updatedAt: { lte: expect.any(Date) },
        },
        data: {
          status: WebhookStatus.PENDING,
          error: `lease:${result.leaseToken}`,
          payload: { retried: true },
        },
      });
    });

    it('stale-lock recovery race condition: two workers attempt recovery simultaneously, only one succeeds', async () => {
      prisma.webhookEvent.findUnique.mockResolvedValue({
        id: 'evt-1',
        status: WebhookStatus.PENDING,
        updatedAt: new Date(Date.now() - 7 * 60 * 1000), // 7 minutes ago
      });

      // Worker 1 executes conditional update first and gets count: 1
      prisma.webhookEvent.updateMany.mockResolvedValueOnce({ count: 1 });
      // Worker 2 executes conditional update second and gets count: 0 (lost race)
      prisma.webhookEvent.updateMany.mockResolvedValueOnce({ count: 0 });

      const [worker1, worker2] = await Promise.all([
        service.acquireLock('telnyx', 'evt_123', { worker: 1 }),
        service.acquireLock('telnyx', 'evt_123', { worker: 2 }),
      ]);

      expect(worker1.canProcess).toBe(true);
      expect(worker1.leaseToken).toBeDefined();

      expect(worker2.canProcess).toBe(false);
      expect(worker2.leaseToken).toBeUndefined();
    });
  });

  describe('4. Lease Fencing & Stale Worker Rejection', () => {
    it('mandatory leaseToken enforcement: missing or empty leaseToken rejects transition immediately', async () => {
      const emptyTokenResult = await service.markProcessed('evt-1', '');
      expect(emptyTokenResult).toBe(false);

      const undefinedTokenResult = await service.markProcessed('evt-1', undefined as any);
      expect(undefinedTokenResult).toBe(false);

      const failedEmptyResult = await service.markFailed('evt-1', 'err', '');
      expect(failedEmptyResult).toBe(false);

      const ignoredEmptyResult = await service.markIgnored('evt-1', 'reason', '');
      expect(ignoredEmptyResult).toBe(false);

      // Verify no DB queries were executed when leaseToken was missing
      expect(prisma.webhookEvent.updateMany).not.toHaveBeenCalled();
    });

    it('old worker completion after lease reassignment is rejected via leaseToken fencing', async () => {
      const oldLeaseToken = 'old-worker-lease-uuid-1111';

      // Old worker resumes after losing lease and calls markProcessed with its old leaseToken
      // Database query conditional on error: `lease:${oldLeaseToken}` returns count: 0
      prisma.webhookEvent.updateMany.mockResolvedValue({ count: 0 });

      const success = await service.markProcessed('evt-1', oldLeaseToken);
      expect(success).toBe(false);
      expect(prisma.webhookEvent.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'evt-1',
          status: WebhookStatus.PENDING,
          error: `lease:${oldLeaseToken}`,
        },
        data: {
          status: WebhookStatus.PROCESSED,
          error: null,
        },
      });
    });

    it('old worker failure after lease reassignment cannot corrupt new active worker lease', async () => {
      const oldLeaseToken = 'old-worker-lease-uuid-1111';

      prisma.webhookEvent.updateMany.mockResolvedValue({ count: 0 });

      const success = await service.markFailed(
        'evt-1',
        'Stale worker error',
        oldLeaseToken,
      );
      expect(success).toBe(false);
      expect(prisma.webhookEvent.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'evt-1',
          status: WebhookStatus.PENDING,
          error: `lease:${oldLeaseToken}`,
        },
        data: {
          status: WebhookStatus.FAILED,
          error: 'Stale worker error',
        },
      });
    });

    it('successful processing by active lease holder marks event PROCESSED', async () => {
      const activeLeaseToken = 'active-worker-lease-uuid-2222';

      prisma.webhookEvent.updateMany.mockResolvedValue({ count: 1 });

      const success = await service.markProcessed('evt-1', activeLeaseToken);
      expect(success).toBe(true);
      expect(prisma.webhookEvent.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'evt-1',
          status: WebhookStatus.PENDING,
          error: `lease:${activeLeaseToken}`,
        },
        data: {
          status: WebhookStatus.PROCESSED,
          error: null,
        },
      });
    });
  });

  describe('5. FAILED and IGNORED Retry Safety', () => {
    it('allows retry for FAILED event via atomic conditional update', async () => {
      prisma.webhookEvent.findUnique.mockResolvedValue({
        id: 'evt-1',
        status: WebhookStatus.FAILED,
      });
      prisma.webhookEvent.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.acquireLock('telnyx', 'evt_123', {});
      expect(result.canProcess).toBe(true);
      expect(result.id).toBe('evt-1');
      expect(result.leaseToken).toBeDefined();
      expect(prisma.webhookEvent.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'evt-1',
          status: { in: [WebhookStatus.FAILED, WebhookStatus.IGNORED] },
        },
        data: {
          status: WebhookStatus.PENDING,
          error: `lease:${result.leaseToken}`,
          payload: {},
        },
      });
    });

    it('concurrent retry race on FAILED event: only one retry worker acquires lock', async () => {
      prisma.webhookEvent.findUnique.mockResolvedValue({
        id: 'evt-1',
        status: WebhookStatus.FAILED,
      });
      prisma.webhookEvent.updateMany
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 0 });

      const [worker1, worker2] = await Promise.all([
        service.acquireLock('telnyx', 'evt_123', { attempt: 1 }),
        service.acquireLock('telnyx', 'evt_123', { attempt: 2 }),
      ]);

      expect(worker1.canProcess).toBe(true);
      expect(worker2.canProcess).toBe(false);
    });
  });
});
