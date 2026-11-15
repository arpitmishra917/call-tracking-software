import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient, WebhookStatus, CallState, CallDirection } from '@prisma/client';
import { randomUUID } from 'crypto';
import { assertNonProductionDatabase } from '../src/common/database-isolation.util.js';
import { WebhookIdempotencyService } from '../src/telephony/webhook-idempotency.service.js';

describe('Real PostgreSQL Webhook Concurrency & Idempotency Integration Suite (Task 3)', () => {
  const qaDbUrl =
    process.env.DATABASE_URL ||
    'postgresql://callflow_qa_user:cfqa_pg_83538438661833bab5b5741ec8b903593e00a675@127.0.0.1:5433/callflow_qa?schema=public';

  let prisma: PrismaClient;
  let service: WebhookIdempotencyService;

  // Track IDs for isolated cleanup
  const createdEventIds: string[] = [];
  const createdCallIds: string[] = [];
  const createdWorkspaceIds: string[] = [];

  beforeAll(async () => {
    // 1. Strict non-production guard
    assertNonProductionDatabase(qaDbUrl, 'Real PostgreSQL Webhook Concurrency Suite');

    prisma = new PrismaClient({
      datasources: {
        db: {
          url: qaDbUrl,
        },
      },
    });

    await prisma.$connect();
    service = new WebhookIdempotencyService(prisma as any);

    const fresh = await prisma.webhookEvent.create({
      data: {
        provider: 'telnyx',
        providerEventId: `test_fresh_${randomUUID()}`,
        status: WebhookStatus.PENDING,
        payload: {},
      },
    });
    createdEventIds.push(fresh.id);
    console.log('FRESH CREATED BY PRISMA:', {
      updatedAt: fresh.updatedAt,
      time: fresh.updatedAt.getTime(),
      now: Date.now(),
      diffMs: Date.now() - fresh.updatedAt.getTime(),
    });
  });

  afterAll(async () => {
    try {
      if (createdCallIds.length > 0) {
        await prisma.call.deleteMany({
          where: { id: { in: createdCallIds } },
        }).catch(() => {});
      }

      if (createdEventIds.length > 0) {
        await prisma.webhookEvent.deleteMany({
          where: { id: { in: createdEventIds } },
        }).catch(() => {});
      }

      if (createdWorkspaceIds.length > 0) {
        await prisma.workspace.deleteMany({
          where: { id: { in: createdWorkspaceIds } },
        }).catch(() => {});
      }
    } finally {
      await prisma.$disconnect();
    }
  });

  it('1 & 2. Two simultaneous workers attempt to acquire same stale event: Exactly one worker obtains the lease in real Postgres', async () => {
    const eventId = `qa_stale_evt_${randomUUID()}`;
    const initialLease = randomUUID();

    // Seed a stale event in PostgreSQL: status=PENDING, updatedAt=10 minutes ago
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    const seeded = await prisma.webhookEvent.create({
      data: {
        provider: 'telnyx',
        providerEventId: eventId,
        status: WebhookStatus.PENDING,
        error: `lease:${initialLease}`,
        payload: { test: 'stale_initial' },
        createdAt: tenMinutesAgo,
        updatedAt: tenMinutesAgo,
      },
    });
    createdEventIds.push(seeded.id);

    // Overwrite updatedAt directly via raw SQL using database UTC clock (timezone('utc', now()) - INTERVAL '10 minutes')
    await prisma.$executeRaw`
      UPDATE "webhook_events"
      SET "updatedAt" = timezone('utc', now()) - INTERVAL '10 minutes'
      WHERE "id" = ${seeded.id}
    `;

    // Verify it is indeed stale in Postgres
    const beforeCheck = await prisma.webhookEvent.findUnique({
      where: { id: seeded.id },
    });
    console.log('STALE CHECK:', {
      beforeCheckUpdatedAt: beforeCheck!.updatedAt,
      beforeCheckTime: beforeCheck!.updatedAt.getTime(),
      now: Date.now(),
      diffMs: Date.now() - beforeCheck!.updatedAt.getTime(),
    });

    // Launch 2 simultaneous worker acquisitions against real PostgreSQL
    const [workerA, workerB] = await Promise.all([
      service.acquireLock('telnyx', eventId, { worker: 'A' }),
      service.acquireLock('telnyx', eventId, { worker: 'B' }),
    ]);

    // Exactly one worker must win; the other must lose
    const winnerCount = (workerA.canProcess ? 1 : 0) + (workerB.canProcess ? 1 : 0);
    expect(winnerCount).toBe(1);

    const winner = workerA.canProcess ? workerA : workerB;
    const loser = workerA.canProcess ? workerB : workerA;

    expect(winner.canProcess).toBe(true);
    expect(winner.leaseToken).toBeDefined();

    expect(loser.canProcess).toBe(false);
    expect(loser.leaseToken).toBeUndefined();

    // Verify row in PostgreSQL reflects winner's leaseToken
    const inDb = await prisma.webhookEvent.findUnique({
      where: { id: seeded.id },
    });
    expect(inDb!.status).toBe(WebhookStatus.PENDING);
    expect(inDb!.error).toBe(`lease:${winner.leaseToken}`);
  });

  it('3 & 6. Losing worker cannot execute business logic; no duplicate Call or billing operations generated', async () => {
    const eventId = `qa_business_logic_race_${randomUUID()}`;

    // Mock incoming concurrent deliveries of call.initiated
    let businessLogicExecutions = 0;
    const simulatedBusinessLogic = async (lockResult: any) => {
      if (!lockResult.canProcess || !lockResult.id || !lockResult.leaseToken) {
        return { executed: false, reason: 'LOCKED_BY_ANOTHER_WORKER' };
      }

      // Critical section: Business logic
      businessLogicExecutions++;
      await service.markProcessed(lockResult.id, lockResult.leaseToken);
      return { executed: true };
    };

    // Workers concurrently attempt to acquire lock on brand new event in real PostgreSQL
    const [lockA, lockB] = await Promise.all([
      service.acquireLock('telnyx', eventId, { callId: 'call_concurrent_1' }),
      service.acquireLock('telnyx', eventId, { callId: 'call_concurrent_1' }),
    ]);

    if (lockA.id) createdEventIds.push(lockA.id);
    if (lockB.id && lockB.id !== lockA.id) createdEventIds.push(lockB.id);

    // Run business logic conditionally on lock outcome
    const [resA, resB] = await Promise.all([
      simulatedBusinessLogic(lockA),
      simulatedBusinessLogic(lockB),
    ]);

    // Exactly one worker executed business logic
    expect(businessLogicExecutions).toBe(1);
    expect(resA.executed !== resB.executed).toBe(true);

    // Final event state in PostgreSQL is PROCESSED
    const finalEvent = await prisma.webhookEvent.findUnique({
      where: {
        provider_providerEventId: {
          provider: 'telnyx',
          providerEventId: eventId,
        },
      },
    });
    expect(finalEvent!.status).toBe(WebhookStatus.PROCESSED);
    expect(finalEvent!.error).toBeNull();
  });

  it('4. Expired worker cannot finalize after lease reassignment in real PostgreSQL', async () => {
    const eventId = `qa_fenced_worker_${randomUUID()}`;
    const oldLeaseToken = 'old_worker_stale_uuid_1111';

    // Seed stale event in PostgreSQL held by old worker
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    const seeded = await prisma.webhookEvent.create({
      data: {
        provider: 'telnyx',
        providerEventId: eventId,
        status: WebhookStatus.PENDING,
        error: `lease:${oldLeaseToken}`,
        payload: { leg: 'stale' },
      },
    });
    createdEventIds.push(seeded.id);

    await prisma.$executeRaw`
      UPDATE "webhook_events"
      SET "updatedAt" = timezone('utc', now()) - INTERVAL '10 minutes'
      WHERE "id" = ${seeded.id}
    `;

    // New worker claims stale lock
    const newWorkerClaim = await service.acquireLock('telnyx', eventId, {
      leg: 'recovered',
    });
    expect(newWorkerClaim.canProcess).toBe(true);
    expect(newWorkerClaim.leaseToken).toBeDefined();
    expect(newWorkerClaim.leaseToken).not.toBe(oldLeaseToken);

    // Old worker wakes up after delay and attempts to finalize with oldLeaseToken
    const oldWorkerFinalizeResult = await service.markProcessed(
      seeded.id,
      oldLeaseToken,
    );
    expect(oldWorkerFinalizeResult).toBe(false);

    // Old worker attempts to mark FAILED with oldLeaseToken
    const oldWorkerFailResult = await service.markFailed(
      seeded.id,
      'Old worker timeout',
      oldLeaseToken,
    );
    expect(oldWorkerFailResult).toBe(false);

    // Verify database row was NOT modified by old worker; remains in PENDING with new worker's lease
    const checkMidway = await prisma.webhookEvent.findUnique({
      where: { id: seeded.id },
    });
    expect(checkMidway!.status).toBe(WebhookStatus.PENDING);
    expect(checkMidway!.error).toBe(`lease:${newWorkerClaim.leaseToken}`);

    // New worker completes successfully
    const newWorkerFinalizeResult = await service.markProcessed(
      seeded.id,
      newWorkerClaim.leaseToken!,
    );
    expect(newWorkerFinalizeResult).toBe(true);

    const finalRow = await prisma.webhookEvent.findUnique({
      where: { id: seeded.id },
    });
    expect(finalRow!.status).toBe(WebhookStatus.PROCESSED);
    expect(finalRow!.error).toBeNull();
  });

  it('5. Concurrent FAILED event retries produce exactly one lease owner in real PostgreSQL', async () => {
    const eventId = `qa_failed_retry_race_${randomUUID()}`;

    // Seed FAILED event in PostgreSQL
    const seeded = await prisma.webhookEvent.create({
      data: {
        provider: 'telnyx',
        providerEventId: eventId,
        status: WebhookStatus.FAILED,
        error: 'Initial carrier timeout error',
        payload: { retryTest: true },
      },
    });
    createdEventIds.push(seeded.id);

    // 2 retry deliveries arrive simultaneously in real PostgreSQL
    const [retry1, retry2] = await Promise.all([
      service.acquireLock('telnyx', eventId, { retryAttempt: 1 }),
      service.acquireLock('telnyx', eventId, { retryAttempt: 2 }),
    ]);

    const winnerCount = (retry1.canProcess ? 1 : 0) + (retry2.canProcess ? 1 : 0);
    expect(winnerCount).toBe(1);

    const winner = retry1.canProcess ? retry1 : retry2;
    const loser = retry1.canProcess ? retry2 : retry1;

    expect(winner.canProcess).toBe(true);
    expect(winner.leaseToken).toBeDefined();

    expect(loser.canProcess).toBe(false);
    expect(loser.leaseToken).toBeUndefined();

    // Real DB row is now PENDING with winner's leaseToken
    const postRetry = await prisma.webhookEvent.findUnique({
      where: { id: seeded.id },
    });
    expect(postRetry!.status).toBe(WebhookStatus.PENDING);
    expect(postRetry!.error).toBe(`lease:${winner.leaseToken}`);
  });
});
