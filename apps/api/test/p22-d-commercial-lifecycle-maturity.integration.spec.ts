import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  PrismaClient,
  CallState,
  CallAttemptState,
  ReservationStatus,
  CommercialStatus,
  DisputeStatus,
  Prisma,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { CommercialEvaluatorService } from '../src/commercial/commercial-evaluator.service.js';
import { CommercialFinalizationService } from '../src/commercial/commercial-finalization.service.js';
import { assertNonProductionDatabase } from '../src/common/database-isolation.util.js';

describe('P2.2-D: CallCommercial Lifecycle & Financial Maturity Integration Suite (Real PostgreSQL)', () => {
  const qaDbUrl =
    process.env.DATABASE_URL ||
    'postgresql://postgres:%2A222%2A2%23Arpit@localhost:5432/calltracking_mvp_test?schema=public';

  let prisma: PrismaClient;
  let evaluatorService: CommercialEvaluatorService;
  let finalizationService: CommercialFinalizationService;

  const createdWorkspaceIds: string[] = [];

  beforeAll(async () => {
    assertNonProductionDatabase(qaDbUrl, 'P2.2-D Commercial Maturity Suite');
    prisma = new PrismaClient({
      datasources: {
        db: {
          url: qaDbUrl,
        },
      },
    });
    await prisma.$connect();

    evaluatorService = new CommercialEvaluatorService(prisma as any);
    finalizationService = new CommercialFinalizationService(prisma as any);
  });

  afterAll(async () => {
    try {
      for (const wsId of createdWorkspaceIds) {
        await prisma.$executeRaw`DELETE FROM "call_financial_adjustments" WHERE workspace_id = ${wsId}`.catch(() => {});
        await prisma.$executeRaw`DELETE FROM "call_disputes" WHERE workspace_id = ${wsId}`.catch(() => {});
        await prisma.$executeRaw`DELETE FROM "call_commercials" WHERE workspace_id = ${wsId}`.catch(() => {});
        await prisma.$executeRaw`DELETE FROM "call_attempts" WHERE call_id IN (SELECT id FROM "calls" WHERE workspace_id = ${wsId})`.catch(() => {});
        await prisma.$executeRaw`DELETE FROM "call_reservations" WHERE workspace_id = ${wsId}`.catch(() => {});
        await prisma.$executeRaw`DELETE FROM "calls" WHERE workspace_id = ${wsId}`.catch(() => {});
        await prisma.$executeRaw`DELETE FROM "buyers" WHERE workspace_id = ${wsId}`.catch(() => {});
        await prisma.$executeRaw`DELETE FROM "campaigns" WHERE workspace_id = ${wsId}`.catch(() => {});
        await prisma.$executeRaw`DELETE FROM "workspace_members" WHERE workspace_id = ${wsId}`.catch(() => {});
        await prisma.$executeRaw`DELETE FROM "workspaces" WHERE id = ${wsId}`.catch(() => {});
      }
    } finally {
      await prisma.$disconnect();
    }
  });

  async function createFixture() {
    const rawId = randomUUID();
    const wsId = `ws_p22d_${rawId}`;
    createdWorkspaceIds.push(wsId);

    await prisma.workspace.create({
      data: {
        id: wsId,
        name: `Maturity Test WS ${rawId.slice(0, 8)}`,
        slug: `maturity-test-${rawId}`,
        status: 'ACTIVE',
      },
    });

    const campaign = await prisma.campaign.create({
      data: {
        workspace_id: wsId,
        name: 'Maturity Commercial Campaign',
        status: 'ACTIVE',
        conversion_duration_secs: 60,
        duplicate_window_secs: 2592000,
        default_revenue_amount: new Prisma.Decimal('50.0000'),
        default_payout_amount: new Prisma.Decimal('30.0000'),
        currency: 'USD',
      },
    });

    const buyer = await prisma.buyer.create({
      data: {
        workspace_id: wsId,
        name: 'Maturity Buyer',
        destination_number: '+15551112222',
        max_concurrent_calls: 10,
        status: 'ACTIVE',
      },
    });

    return { wsId, campaignId: campaign.id, buyerId: buyer.id };
  }

  async function createCompletedCall(
    wsId: string,
    campaignId: string,
    buyerId: string,
    talkDurationSecs = 120,
  ): Promise<string> {
    const callId = `call_p22d_${randomUUID()}`;
    const now = new Date();
    const answeredAt = new Date(now.getTime() - talkDurationSecs * 1000);

    await prisma.call.create({
      data: {
        id: callId,
        workspace_id: wsId,
        campaign_id: campaignId,
        provider: 'telnyx',
        provider_call_id: `prov_${callId}`,
        from_number: '+15554443322',
        to_number: '+15559998877',
        state: CallState.COMPLETED,
        duration_secs: talkDurationSecs,
        created_at: answeredAt,
        updated_at: now,
        callReservation: {
          create: {
            workspace_id: wsId,
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
            ended_at: now,
            duration_secs: talkDurationSecs,
            created_at: answeredAt,
          },
        },
      },
    });

    return callId;
  }

  // 1. Deterministic 168h Maturity
  it('1. Deterministic maturity: CallCommercial is created with status PENDING and finalizes_at = created_at + 168 hours', async () => {
    const { wsId, campaignId, buyerId } = await createFixture();
    const callId = await createCompletedCall(wsId, campaignId, buyerId, 120);

    const commercial = await evaluatorService.evaluateCall(callId);
    expect(commercial).toBeDefined();
    expect(commercial!.status).toBe(CommercialStatus.PENDING);
    expect(commercial!.converted).toBe(true);
    expect(commercial!.finalizes_at).toBeDefined();

    // Verify 168-hour calculation (168 * 3600 * 1000 = 604,800,000 ms)
    const expectedFinalizesMs = commercial!.created_at.getTime() + 168 * 60 * 60 * 1000;
    const actualFinalizesMs = commercial!.finalizes_at!.getTime();
    expect(Math.abs(actualFinalizesMs - expectedFinalizesMs)).toBeLessThanOrEqual(1000);

    // Verify in real PostgreSQL
    const inDb = await prisma.callCommercial.findUniqueOrThrow({
      where: { id: commercial!.id },
    });
    expect(inDb.status).toBe(CommercialStatus.PENDING);
    expect(inDb.finalizes_at).toEqual(commercial!.finalizes_at);
  });

  // 2. Premature Finalization Guard
  it('2. Premature finalization: finalization sweep before 168 hours does not finalize records', async () => {
    const { wsId, campaignId, buyerId } = await createFixture();
    const callId = await createCompletedCall(wsId, campaignId, buyerId, 120);

    const commercial = await evaluatorService.evaluateCall(callId);
    expect(commercial!.status).toBe(CommercialStatus.PENDING);

    // Run finalization sweep at current time (T < 168h)
    const result = await finalizationService.processFinalizationBatch(new Date(), wsId);
    expect(result.finalizedCount).toBe(0);

    // Status remains PENDING
    const inDb = await prisma.callCommercial.findUniqueOrThrow({
      where: { id: commercial!.id },
    });
    expect(inDb.status).toBe(CommercialStatus.PENDING);
  });

  // 3. Matured Finalization Transition
  it('3. Matured finalization: reference time >= finalizes_at transitions record from PENDING to FINAL', async () => {
    const { wsId, campaignId, buyerId } = await createFixture();
    const callId = await createCompletedCall(wsId, campaignId, buyerId, 120);

    const commercial = await evaluatorService.evaluateCall(callId);

    // Reference time: 169 hours into the future
    const futureReference = new Date(Date.now() + 169 * 60 * 60 * 1000);
    const result = await finalizationService.processFinalizationBatch(futureReference, wsId);

    expect(result.finalizedCount).toBe(1);

    // Verify record transitioned to FINAL in PostgreSQL
    const inDb = await prisma.callCommercial.findUniqueOrThrow({
      where: { id: commercial!.id },
    });
    expect(inDb.status).toBe(CommercialStatus.FINAL);
    // Financial values immutable
    expect(inDb.revenue).toEqual(commercial!.revenue);
    expect(inDb.payout).toEqual(commercial!.payout);
    expect(inDb.profit).toEqual(commercial!.profit);
  });

  // 4. Concurrent Finalization Idempotency
  it('4. Concurrent finalization race: two simultaneous sweeps finalize matured records exactly once without error', async () => {
    const { wsId, campaignId, buyerId } = await createFixture();
    const call1 = await createCompletedCall(wsId, campaignId, buyerId, 120);
    const call2 = await createCompletedCall(wsId, campaignId, buyerId, 120);

    await evaluatorService.evaluateCall(call1);
    await evaluatorService.evaluateCall(call2);

    const futureReference = new Date(Date.now() + 170 * 60 * 60 * 1000);

    // 2 simultaneous workers run finalization batch
    const [sweep1, sweep2] = await Promise.all([
      finalizationService.processFinalizationBatch(futureReference, wsId),
      finalizationService.processFinalizationBatch(futureReference, wsId),
    ]);

    // Total finalized across both workers must equal exactly the 2 candidate records
    const totalFinalized = sweep1.finalizedCount + sweep2.finalizedCount;
    expect(totalFinalized).toBe(2);

    const finalRecords = await prisma.callCommercial.findMany({
      where: { workspace_id: wsId, status: CommercialStatus.FINAL },
    });
    expect(finalRecords.length).toBe(2);
  });

  // 5. Zero-Cost Calls Handled Safely
  it('5. Zero-cost calls: handles zero talk duration without crash, records zero cost, and matures cleanly', async () => {
    const { wsId, campaignId, buyerId } = await createFixture();
    // Zero duration call (unbridged / zero talk duration)
    const callId = await createCompletedCall(wsId, campaignId, buyerId, 0);

    const commercial = await evaluatorService.evaluateCall(callId);
    expect(commercial).toBeDefined();
    expect(commercial!.converted).toBe(false); // Duration 0 < conversion 60s
    expect(commercial!.cost.toNumber()).toBe(0);
    expect(commercial!.revenue.toNumber()).toBe(0);
    expect(commercial!.payout.toNumber()).toBe(0);
    expect(commercial!.profit.toNumber()).toBe(0);

    // Matures to FINAL
    const futureRef = new Date(Date.now() + 170 * 60 * 60 * 1000);
    const res = await finalizationService.processFinalizationBatch(futureRef, wsId);
    expect(res.finalizedCount).toBe(1);

    const inDb = await prisma.callCommercial.findUniqueOrThrow({
      where: { id: commercial!.id },
    });
    expect(inDb.status).toBe(CommercialStatus.FINAL);
  });

  // 6. Active Dispute Interaction
  it('6. Dispute interaction: active PENDING dispute strictly blocks finalization; resolving dispute allows finalization', async () => {
    const { wsId, campaignId, buyerId } = await createFixture();
    const callId = await createCompletedCall(wsId, campaignId, buyerId, 120);

    const commercial = await evaluatorService.evaluateCall(callId);

    // Attach an active PENDING dispute to the CallCommercial
    const dispute = await prisma.callDispute.create({
      data: {
        workspace_id: wsId,
        call_commercial_id: commercial!.id,
        buyer_id: buyerId,
        created_by_user_id: 'qa_user_test',
        reason: 'CALL_QUALITY',
        description: 'Audio dropped out',
        status: DisputeStatus.PENDING,
      },
    });

    const futureRef = new Date(Date.now() + 175 * 60 * 60 * 1000);

    // Sweep 1: Blocked by active dispute!
    const sweep1 = await finalizationService.processFinalizationBatch(futureRef, wsId);
    expect(sweep1.blockedByDisputeCount).toBe(1);
    expect(sweep1.finalizedCount).toBe(0);

    const checkBlocked = await prisma.callCommercial.findUniqueOrThrow({
      where: { id: commercial!.id },
    });
    expect(checkBlocked.status).toBe(CommercialStatus.PENDING);

    // Resolve dispute by rejecting it
    await prisma.callDispute.update({
      where: { id: dispute.id },
      data: { status: DisputeStatus.REJECTED },
    });

    // Sweep 2: Now eligible and finalizes!
    const sweep2 = await finalizationService.processFinalizationBatch(futureRef, wsId);
    expect(sweep2.blockedByDisputeCount).toBe(0);
    expect(sweep2.finalizedCount).toBe(1);

    const checkFinalized = await prisma.callCommercial.findUniqueOrThrow({
      where: { id: commercial!.id },
    });
    expect(checkFinalized.status).toBe(CommercialStatus.FINAL);
  });
});
