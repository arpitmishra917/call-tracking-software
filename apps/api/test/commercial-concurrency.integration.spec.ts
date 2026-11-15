import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { CommercialEvaluatorService } from '../src/commercial/commercial-evaluator.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { CallState, CallAttemptState, ReservationStatus, Prisma } from '@prisma/client';
import * as crypto from 'crypto';

describe('COMM-INTEGRATION-CONCURRENCY: Real Database Advisory Lock & Duplicate Detection Integration', () => {
  let moduleRef: TestingModule;
  let evaluatorService: CommercialEvaluatorService;
  let prisma: PrismaService;

  let workspaceId: string;
  let buyerId: string;
  let campaignId: string;

  const testCallerNumber = '+15554443322';
  const testDestNumber = '+15559998877';

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      providers: [CommercialEvaluatorService, PrismaService],
    }).compile();

    evaluatorService = moduleRef.get(CommercialEvaluatorService);
    prisma = moduleRef.get(PrismaService);

    // Setup isolated test workspace, buyer, and campaign
    const ws = await prisma.workspace.create({
      data: {
        name: `Concurrency-Test-${crypto.randomBytes(4).toString('hex')}`,
        slug: `conc-test-${crypto.randomBytes(6).toString('hex')}`,
      },
    });
    workspaceId = ws.id;

    const buyer = await prisma.buyer.create({
      data: {
        workspace_id: workspaceId,
        name: 'Concurrency Test Buyer',
        destination_number: '+15550001111',
        max_concurrent_calls: 5,
      },
    });
    buyerId = buyer.id;

    const campaign = await prisma.campaign.create({
      data: {
        workspace_id: workspaceId,
        name: 'Concurrency Duplicate Campaign',
        conversion_duration_secs: 60,
        duplicate_window_secs: 2592000, // 30 days
        default_revenue_amount: new Prisma.Decimal('50.0000'),
        default_payout_amount: new Prisma.Decimal('35.0000'),
        currency: 'USD',
      },
    });
    campaignId = campaign.id;
  });

  afterAll(async () => {
    try {
      if (workspaceId) {
        await prisma.workspace.delete({
          where: { id: workspaceId },
        });
      }
    } catch {
      // Best-effort cleanup
    }
    await prisma.$disconnect();
    await moduleRef.close();
  });

  async function createCompletedConvertedCall(params: {
    id: string;
    createdAt: Date;
    fromNumber?: string;
    toNumber?: string;
    talkDurationSecs?: number;
  }) {
    const talkSecs = params.talkDurationSecs ?? 120;
    const answeredAt = new Date(params.createdAt.getTime() + 5000);
    const endedAt = new Date(answeredAt.getTime() + talkSecs * 1000);

    const call = await prisma.call.create({
      data: {
        id: params.id,
        workspace_id: workspaceId,
        campaign_id: campaignId,
        provider: 'TELNYX',
        provider_call_id: `prov-${params.id}-${crypto.randomBytes(4).toString('hex')}`,
        from_number: params.fromNumber ?? testCallerNumber,
        to_number: params.toNumber ?? testDestNumber,
        state: CallState.COMPLETED,
        duration_secs: talkSecs + 5,
        created_at: params.createdAt,
        updated_at: params.createdAt,
        callReservation: {
          create: {
            workspace_id: workspaceId,
            status: ReservationStatus.SETTLED,
            original_reserved_micro: 500000n,
            total_reserved_micro: 500000n,
          },
        },
        attempts: {
          create: {
            buyer_id: buyerId,
            state: CallAttemptState.COMPLETED,
            answered_at: answeredAt,
            ended_at: endedAt,
            duration_secs: talkSecs,
            created_at: params.createdAt,
          },
        },
      },
    });

    return call;
  }

  it('1. Verifies real PostgreSQL pg_advisory_xact_lock blocks concurrent transaction on same lock key', async () => {
    const lockKey = -876543210987654321n; // 64-bit signed BigInt

    let tx1Acquired = false;
    let tx1CanCommit = false;
    let tx2AcquiredTime = 0;
    let tx1ReleaseTime = 0;

    // Transaction 1 acquires the advisory lock and holds it until released
    const p1 = prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(${lockKey})`);
      tx1Acquired = true;
      while (!tx1CanCommit) {
        await new Promise((r) => setTimeout(r, 20));
      }
      tx1ReleaseTime = Date.now();
      return 'tx1_done';
    });

    // Wait until tx1 has acquired lock
    while (!tx1Acquired) {
      await new Promise((r) => setTimeout(r, 10));
    }

    // Transaction 2 tries to acquire the exact same lock concurrently
    const p2 = prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(${lockKey})`);
      tx2AcquiredTime = Date.now();
      return 'tx2_done';
    });

    // Give tx2 time to attempt lock and verify it is blocked
    await new Promise((r) => setTimeout(r, 100));
    expect(tx2AcquiredTime).toBe(0); // tx2 must be blocked!

    // Now release tx1
    tx1CanCommit = true;

    const [res1, res2] = await Promise.all([p1, p2]);
    expect(res1).toBe('tx1_done');
    expect(res2).toBe('tx2_done');
    expect(tx2AcquiredTime).toBeGreaterThanOrEqual(tx1ReleaseTime);
  });

  it('2. Two concurrent transactions for matching converted calls: exactly one original created, later references original', async () => {
    const call1Id = `call-conc-1-${crypto.randomBytes(4).toString('hex')}`;
    const call2Id = `call-conc-2-${crypto.randomBytes(4).toString('hex')}`;

    const t0 = new Date('2026-10-29T10:00:00.000Z');
    const t1 = new Date('2026-10-29T10:05:00.000Z'); // 5 minutes later

    await createCompletedConvertedCall({ id: call1Id, createdAt: t0 });
    await createCompletedConvertedCall({ id: call2Id, createdAt: t1 });

    // Execute commercial evaluation concurrently against real PostgreSQL database
    const [eval1, eval2] = await Promise.all([
      evaluatorService.evaluateCall(call1Id),
      evaluatorService.evaluateCall(call2Id),
    ]);

    expect(eval1).not.toBeNull();
    expect(eval2).not.toBeNull();

    // Call 1 (earlier) must be the original
    expect(eval1!.duplicate).toBe(false);
    expect(eval1!.duplicate_of_call_id).toBeNull();
    expect(eval1!.qualified).toBe(true);
    expect(eval1!.revenue.toNumber()).toBe(50);
    expect(eval1!.payout.toNumber()).toBe(35);

    // Call 2 (later) must be the duplicate referencing Call 1
    expect(eval2!.duplicate).toBe(true);
    expect(eval2!.duplicate_of_call_id).toBe(call1Id);
    expect(eval2!.qualified).toBe(false);
    expect(eval2!.revenue.toNumber()).toBe(0);
    expect(eval2!.payout.toNumber()).toBe(0);

    // Verify database state matches
    const dbComm1 = await prisma.callCommercial.findUnique({ where: { call_id: call1Id } });
    const dbComm2 = await prisma.callCommercial.findUnique({ where: { call_id: call2Id } });

    expect(dbComm1!.duplicate).toBe(false);
    expect(dbComm2!.duplicate).toBe(true);
    expect(dbComm2!.duplicate_of_call_id).toBe(call1Id);
  });

  it('3. Two concurrent transactions with identical created_at timestamps: deterministic tie-breaking by call ID', async () => {
    // Generate IDs so that idA < idB lexicographically
    const idA = 'call-tie-aaa';
    const idB = 'call-tie-zzz';
    const tSame = new Date('2026-10-29T12:00:00.000Z');

    const callerNum = '+15558887766';
    const destNum = '+15553332211';

    await createCompletedConvertedCall({
      id: idA,
      createdAt: tSame,
      fromNumber: callerNum,
      toNumber: destNum,
    });
    await createCompletedConvertedCall({
      id: idB,
      createdAt: tSame,
      fromNumber: callerNum,
      toNumber: destNum,
    });

    // Run commercial evaluation concurrently
    const [evalA, evalB] = await Promise.all([
      evaluatorService.evaluateCall(idA),
      evaluatorService.evaluateCall(idB),
    ]);

    expect(evalA).not.toBeNull();
    expect(evalB).not.toBeNull();

    // By tie-breaking rule: identical created_at ties are broken deterministically by call ID ascending (idA < idB)
    expect(evalA!.duplicate).toBe(false);
    expect(evalA!.duplicate_of_call_id).toBeNull();
    expect(evalA!.qualified).toBe(true);

    expect(evalB!.duplicate).toBe(true);
    expect(evalB!.duplicate_of_call_id).toBe(idA);
    expect(evalB!.qualified).toBe(false);
  });

  it('4. Current call below conversion threshold (e.g. 31s against 60s threshold) cannot be Duplicate even with earlier converted original', async () => {
    const origId = `call-orig-${crypto.randomBytes(4).toString('hex')}`;
    const shortCallId = `call-short-${crypto.randomBytes(4).toString('hex')}`;

    const tOrig = new Date('2026-10-29T14:00:00.000Z');
    const tShort = new Date('2026-10-29T14:10:00.000Z');

    const callerNum = '+15557776655';
    const destNum = '+15552221100';

    // 1. Earlier original call: converted (120s talk duration >= 60s threshold)
    await createCompletedConvertedCall({
      id: origId,
      createdAt: tOrig,
      fromNumber: callerNum,
      toNumber: destNum,
      talkDurationSecs: 120,
    });
    const evalOrig = await evaluatorService.evaluateCall(origId);
    expect(evalOrig).not.toBeNull();
    expect(evalOrig!.converted).toBe(true);
    expect(evalOrig!.duplicate).toBe(false);
    expect(evalOrig!.duplicate_of_call_id).toBeNull();
    expect(evalOrig!.qualified).toBe(true);

    // 2. Later call: matching caller, destination, campaign, workspace, but talk duration is 31s (< 60s threshold)
    await createCompletedConvertedCall({
      id: shortCallId,
      createdAt: tShort,
      fromNumber: callerNum,
      toNumber: destNum,
      talkDurationSecs: 31,
    });
    const evalShort = await evaluatorService.evaluateCall(shortCallId);
    expect(evalShort).not.toBeNull();

    // Under Option A rules: unconverted call cannot be classified as Duplicate!
    expect(evalShort!.converted).toBe(false);
    expect(evalShort!.duplicate).toBe(false);
    expect(evalShort!.duplicate_of_call_id).toBeNull();
    expect(evalShort!.qualified).toBe(false);
    expect(evalShort!.revenue.toNumber()).toBe(0);
    expect(evalShort!.payout.toNumber()).toBe(0);

    // Verify in database
    const dbCommShort = await prisma.callCommercial.findUnique({ where: { call_id: shortCallId } });
    expect(dbCommShort).not.toBeNull();
    expect(dbCommShort!.converted).toBe(false);
    expect(dbCommShort!.duplicate).toBe(false);
    expect(dbCommShort!.duplicate_of_call_id).toBeNull();
    expect(dbCommShort!.qualified).toBe(false);
  });
});
