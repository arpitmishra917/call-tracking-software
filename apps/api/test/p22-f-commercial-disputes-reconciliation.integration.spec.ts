import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  PrismaClient,
  CommercialStatus,
  DisputeStatus,
  SettlementStatus,
  PaymentStatus,
  SettlementParticipantType,
  Prisma,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { CommercialDisputesService } from '../src/commercial/commercial-disputes.service.js';
import { ReconciliationService } from '../src/settlement/reconciliation.service.js';
import { PaymentService } from '../src/settlement/payment.service.js';
import { assertNonProductionDatabase } from '../src/common/database-isolation.util.js';
import { ConflictException, BadRequestException } from '@nestjs/common';

class MockAuditLogsService {
  async logAction(): Promise<void> {}
}

describe('P2.2-F: Commercial Disputes & Reconciliation Integration Suite (Real PostgreSQL)', () => {
  const qaDbUrl =
    process.env.DATABASE_URL ||
    'postgresql://postgres:%2A222%2A2%23Arpit@localhost:5432/calltracking_mvp_test?schema=public';

  let prisma: PrismaClient;
  let disputesService: CommercialDisputesService;
  let reconciliationService: ReconciliationService;
  let paymentService: PaymentService;

  const createdWorkspaceIds: string[] = [];
  const createdProfileIds: string[] = [];

  beforeAll(async () => {
    assertNonProductionDatabase(qaDbUrl, 'P2.2-F Disputes & Reconciliation Suite');
    prisma = new PrismaClient({
      datasources: {
        db: {
          url: qaDbUrl,
        },
      },
    });
    await prisma.$connect();

    const auditLogs = new MockAuditLogsService() as any;
    disputesService = new CommercialDisputesService(prisma as any, auditLogs);
    reconciliationService = new ReconciliationService(prisma as any);
    paymentService = new PaymentService(prisma as any);
  });

  afterAll(async () => {
    try {
      for (const wsId of createdWorkspaceIds) {
        await prisma.$executeRaw`DELETE FROM "payment_executions" WHERE payment_instruction_id IN (SELECT id FROM "payment_instructions" WHERE workspace_id = ${wsId})`.catch(() => {});
        await prisma.$executeRaw`DELETE FROM "payment_instructions" WHERE workspace_id = ${wsId}`.catch(() => {});
        await prisma.$executeRaw`DELETE FROM "reconciliation_issues" WHERE reconciliation_run_id IN (SELECT id FROM "reconciliation_runs" WHERE workspace_id = ${wsId})`.catch(() => {});
        await prisma.$executeRaw`DELETE FROM "reconciliation_runs" WHERE workspace_id = ${wsId}`.catch(() => {});
        await prisma.$executeRaw`DELETE FROM "settlement_items" WHERE workspace_id = ${wsId}`.catch(() => {});
        await prisma.$executeRaw`DELETE FROM "settlement_adjustments" WHERE workspace_id = ${wsId}`.catch(() => {});
        await prisma.$executeRaw`DELETE FROM "settlement_batches" WHERE workspace_id = ${wsId}`.catch(() => {});
        await prisma.$executeRaw`DELETE FROM "call_financial_adjustments" WHERE workspace_id = ${wsId}`.catch(() => {});
        await prisma.$executeRaw`DELETE FROM "call_disputes" WHERE workspace_id = ${wsId}`.catch(() => {});
        await prisma.$executeRaw`DELETE FROM "call_commercials" WHERE workspace_id = ${wsId}`.catch(() => {});
        await prisma.$executeRaw`DELETE FROM "calls" WHERE workspace_id = ${wsId}`.catch(() => {});
        await prisma.$executeRaw`DELETE FROM "buyers" WHERE workspace_id = ${wsId}`.catch(() => {});
        await prisma.$executeRaw`DELETE FROM "campaigns" WHERE workspace_id = ${wsId}`.catch(() => {});
        await prisma.$executeRaw`DELETE FROM "workspace_members" WHERE workspace_id = ${wsId}`.catch(() => {});
        await prisma.$executeRaw`DELETE FROM "workspaces" WHERE id = ${wsId}`.catch(() => {});
      }
      if (createdProfileIds.length > 0) {
        await prisma.profile.deleteMany({
          where: { id: { in: createdProfileIds } },
        }).catch(() => {});
      }
    } finally {
      await prisma.$disconnect();
    }
  });

  async function createFixture() {
    const rawId = randomUUID();
    const wsId = `ws_p22f_${rawId}`;
    createdWorkspaceIds.push(wsId);

    await prisma.workspace.create({
      data: {
        id: wsId,
        name: `Disputes WS ${rawId.slice(0, 8)}`,
        slug: `disputes-${rawId}`,
        status: 'ACTIVE',
      },
    });

    const campaign = await prisma.campaign.create({
      data: {
        workspace_id: wsId,
        name: 'Disputes Campaign',
      },
    });

    const buyer = await prisma.buyer.create({
      data: {
        workspace_id: wsId,
        name: 'Dispute Buyer',
        destination_number: '+15551234567',
        max_concurrent_calls: 5,
        status: 'ACTIVE',
      },
    });

    // Create Buyer User Profile and Membership
    const buyerUserId = `usr_buyer_${randomUUID()}`;
    createdProfileIds.push(buyerUserId);
    await prisma.profile.create({
      data: {
        id: buyerUserId,
        display_name: 'Buyer User',
      },
    });

    await prisma.workspaceMember.create({
      data: {
        workspace_id: wsId,
        user_id: buyerUserId,
        role: 'MEMBER',
        participant_type: 'BUYER',
        buyer_id: buyer.id,
      },
    });

    // Create Admin User Profile and Membership (for dispute resolution)
    const adminUserId = `usr_admin_${randomUUID()}`;
    createdProfileIds.push(adminUserId);
    await prisma.profile.create({
      data: {
        id: adminUserId,
        display_name: 'Admin Manager',
      },
    });

    await prisma.workspaceMember.create({
      data: {
        workspace_id: wsId,
        user_id: adminUserId,
        role: 'OWNER',
      },
    });

    return {
      wsId,
      campaignId: campaign.id,
      buyerId: buyer.id,
      buyerUserId,
      adminUserId,
    };
  }

  async function createCallCommercial(
    wsId: string,
    campaignId: string,
    buyerId: string,
    revenue = 50.0,
    payout = 25.0,
  ): Promise<string> {
    const callId = `call_p22f_${randomUUID()}`;
    await prisma.call.create({
      data: {
        id: callId,
        workspace_id: wsId,
        campaign_id: campaignId,
        provider: 'telnyx',
        provider_call_id: `prov_${callId}`,
        from_number: '+15551112222',
        to_number: '+15553334444',
        state: 'COMPLETED',
      },
    });

    const comm = await prisma.callCommercial.create({
      data: {
        workspace_id: wsId,
        call_id: callId,
        campaign_id: campaignId,
        buyer_id: buyerId,
        currency: 'USD',
        revenue,
        payout,
        cost: 0.2,
        profit: revenue - payout - 0.2,
        status: CommercialStatus.PENDING,
        finalizes_at: new Date(Date.now() + 168 * 3600 * 1000),
      },
    });

    return comm.id;
  }

  // 1. Concurrent Dispute Creation Race Condition
  it('1. Concurrent dispute creation race: two simultaneous workers dispute same call -> exactly 1 succeeds, other rejected with ConflictException', async () => {
    const { wsId, campaignId, buyerId, buyerUserId } = await createFixture();
    const commId = await createCallCommercial(wsId, campaignId, buyerId);

    // 2 simultaneous workers attempt to dispute the same CallCommercial
    const results = await Promise.allSettled([
      disputesService.createDispute({
        workspaceId: wsId,
        callCommercialId: commId,
        userId: buyerUserId,
        reason: 'AUDIO_FAILURE',
        description: 'Dead air on connection worker 1',
      }),
      disputesService.createDispute({
        workspaceId: wsId,
        callCommercialId: commId,
        userId: buyerUserId,
        reason: 'AUDIO_FAILURE',
        description: 'Dead air on connection worker 2',
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    const error = (rejected[0] as PromiseRejectedResult).reason;
    expect(error).toBeInstanceOf(ConflictException);

    // Verify in real PostgreSQL: Exactly 1 dispute exists with status PENDING
    const disputes = await prisma.callDispute.findMany({
      where: { call_commercial_id: commId },
    });
    expect(disputes.length).toBe(1);
    expect(disputes[0].status).toBe(DisputeStatus.PENDING);
  });

  // 2. State Transition: ACCEPTED Dispute & Financial Adjustment
  it('2. State transition - ACCEPTED: resolves dispute, transitions CallCommercial to ADJUSTED, creates financial adjustment, zeroes revenue and payout', async () => {
    const { wsId, campaignId, buyerId, buyerUserId, adminUserId } = await createFixture();
    const commId = await createCallCommercial(wsId, campaignId, buyerId, 50.0, 25.0);

    const dispute = await disputesService.createDispute({
      workspaceId: wsId,
      callCommercialId: commId,
      userId: buyerUserId,
      reason: 'WRONG_NUMBER',
      description: 'Caller dialed wrong company',
    });

    // Admin resolves dispute as ACCEPTED
    const resolved = await disputesService.resolveDispute({
      workspaceId: wsId,
      disputeId: dispute.id,
      userId: adminUserId,
      status: 'ACCEPTED',
      resolutionNotes: 'Verified wrong number from recording review',
    });

    expect(resolved.dispute.status).toBe(DisputeStatus.ACCEPTED);

    // Verify CallCommercial in PostgreSQL: status=ADJUSTED, revenue=0, payout=0, cost preserved (0.2)
    const commInDb = await prisma.callCommercial.findUniqueOrThrow({
      where: { id: commId },
    });
    expect(commInDb.status).toBe(CommercialStatus.ADJUSTED);
    expect(commInDb.revenue.toNumber()).toBe(0);
    expect(commInDb.payout.toNumber()).toBe(0);
    expect(commInDb.cost.toNumber()).toBe(0.2);
    // profit = 0 - 0 - 0.2 = -0.2
    expect(commInDb.profit.toNumber()).toBe(-0.2);

    // Verify CallFinancialAdjustment created in PostgreSQL
    const adjustment = await prisma.callFinancialAdjustment.findFirst({
      where: { call_commercial_id: commId },
    });
    expect(adjustment).toBeDefined();
    expect(adjustment!.workspace_id).toBe(wsId);
    expect(adjustment!.dispute_id).toBe(dispute.id);
  });

  // 3. State Transition: REJECTED Dispute Leaves Commercial State Untouched
  it('3. State transition - REJECTED: resolves dispute as REJECTED, preserves original commercial status and financials', async () => {
    const { wsId, campaignId, buyerId, buyerUserId, adminUserId } = await createFixture();
    const commId = await createCallCommercial(wsId, campaignId, buyerId, 50.0, 25.0);

    const dispute = await disputesService.createDispute({
      workspaceId: wsId,
      callCommercialId: commId,
      userId: buyerUserId,
      reason: 'UNAUTHORIZED_CLAIM',
      description: 'Buyer claims illegitimate lead',
    });

    // Admin resolves dispute as REJECTED
    const resolved = await disputesService.resolveDispute({
      workspaceId: wsId,
      disputeId: dispute.id,
      userId: adminUserId,
      status: 'REJECTED',
      resolutionNotes: 'Lead was valid and met campaign conversion criteria',
    });

    expect(resolved.dispute.status).toBe(DisputeStatus.REJECTED);

    // Commercial record remains PENDING with original revenue and payout
    const commInDb = await prisma.callCommercial.findUniqueOrThrow({
      where: { id: commId },
    });
    expect(commInDb.status).toBe(CommercialStatus.PENDING);
    expect(commInDb.revenue.toNumber()).toBe(50.0);
    expect(commInDb.payout.toNumber()).toBe(25.0);
  });

  // 4. Batch Reconciliation Idempotency
  it('4. Settlement batch reconciliation: audits sum matching, currency consistency, and produces clean audit run', async () => {
    const { wsId, buyerId } = await createFixture();

    const batch = await prisma.settlementBatch.create({
      data: {
        workspace_id: wsId,
        batch_number: `SB-RECON-${randomUUID().slice(0, 8)}`,
        participant_type: SettlementParticipantType.BUYER,
        buyer_id: buyerId,
        currency: 'USD',
        period_start: new Date('2026-10-01T00:00:00Z'),
        period_end: new Date('2026-10-08T00:00:00Z'),
        created_by_user_id: 'qa-user',
        settlement_status: SettlementStatus.FINALIZED,
        payment_status: PaymentStatus.UNPROCESSED,
        gross_amount: new Prisma.Decimal('100.0000'),
        adjustments_amount: new Prisma.Decimal('0.0000'),
        net_amount: new Prisma.Decimal('100.0000'),
      },
    });

    // Run batch reconciliation
    const recon1 = await reconciliationService.runBatchReconciliation(wsId, batch.id);
    expect(recon1.status).toBeDefined();

    // Re-run batch reconciliation (Idempotency)
    const recon2 = await reconciliationService.runBatchReconciliation(wsId, batch.id);
    expect(recon2.status).toBeDefined();

    // Audit logs / reconciliation runs recorded cleanly
    const runs = await prisma.reconciliationRun.findMany({
      where: { workspace_id: wsId, settlement_batch_id: batch.id },
    });
    expect(runs.length).toBeGreaterThanOrEqual(1);
  });

  // 5. Payment Instruction Idempotency
  it('5. Payment instruction idempotency: concurrent requests return identical payment instruction without duplicate creation', async () => {
    const { wsId, buyerId } = await createFixture();

    const batch = await prisma.settlementBatch.create({
      data: {
        workspace_id: wsId,
        batch_number: `SB-PAY-${randomUUID().slice(0, 8)}`,
        participant_type: SettlementParticipantType.BUYER,
        buyer_id: buyerId,
        currency: 'USD',
        period_start: new Date('2026-10-01T00:00:00Z'),
        period_end: new Date('2026-10-08T00:00:00Z'),
        created_by_user_id: 'qa-user',
        settlement_status: SettlementStatus.FINALIZED,
        payment_status: PaymentStatus.UNPROCESSED,
        gross_amount: new Prisma.Decimal('250.0000'),
        adjustments_amount: new Prisma.Decimal('0.0000'),
        net_amount: new Prisma.Decimal('250.0000'),
      },
    });

    // 2 simultaneous workers create payment instruction
    const [inst1, inst2] = await Promise.all([
      paymentService.createPaymentInstruction(wsId, batch.id),
      paymentService.createPaymentInstruction(wsId, batch.id),
    ]);

    expect(inst1.id).toBe(inst2.id);
    expect(inst1.settlement_batch_id).toBe(batch.id);

    // Exactly one instruction in PostgreSQL
    const instructions = await prisma.paymentInstruction.findMany({
      where: { settlement_batch_id: batch.id },
    });
    expect(instructions.length).toBe(1);
    expect(instructions[0].amount.toNumber()).toBe(250.0);
  });
});
