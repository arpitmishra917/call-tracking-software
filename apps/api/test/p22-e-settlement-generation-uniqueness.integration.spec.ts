import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  PrismaClient,
  SettlementParticipantType,
  SettlementStatus,
  CommercialStatus,
  Prisma,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { SettlementBatchService } from '../src/settlement/settlement-batch.service.js';
import { assertNonProductionDatabase } from '../src/common/database-isolation.util.js';

describe('P2.2-E: Settlement Generation & Uniqueness Integration Suite (Real PostgreSQL)', () => {
  const qaDbUrl =
    process.env.DATABASE_URL ||
    'postgresql://postgres:%2A222%2A2%23Arpit@localhost:5432/calltracking_mvp_test?schema=public';

  let prisma: PrismaClient;
  let settlementService: SettlementBatchService;

  const createdWorkspaceIds: string[] = [];

  beforeAll(async () => {
    assertNonProductionDatabase(qaDbUrl, 'P2.2-E Settlement Uniqueness Suite');
    prisma = new PrismaClient({
      datasources: {
        db: {
          url: qaDbUrl,
        },
      },
    });
    await prisma.$connect();
    settlementService = new SettlementBatchService(prisma as any);
  });

  afterAll(async () => {
    try {
      for (const wsId of createdWorkspaceIds) {
        await prisma.$executeRaw`DELETE FROM "settlement_items" WHERE workspace_id = ${wsId}`.catch(() => {});
        await prisma.$executeRaw`DELETE FROM "settlement_adjustments" WHERE workspace_id = ${wsId}`.catch(() => {});
        await prisma.$executeRaw`DELETE FROM "payment_instructions" WHERE workspace_id = ${wsId}`.catch(() => {});
        await prisma.$executeRaw`DELETE FROM "settlement_batches" WHERE workspace_id = ${wsId}`.catch(() => {});
        await prisma.$executeRaw`DELETE FROM "call_commercials" WHERE workspace_id = ${wsId}`.catch(() => {});
        await prisma.$executeRaw`DELETE FROM "calls" WHERE workspace_id = ${wsId}`.catch(() => {});
        await prisma.$executeRaw`DELETE FROM "buyers" WHERE workspace_id = ${wsId}`.catch(() => {});
        await prisma.$executeRaw`DELETE FROM "vendors" WHERE workspace_id = ${wsId}`.catch(() => {});
        await prisma.$executeRaw`DELETE FROM "campaigns" WHERE workspace_id = ${wsId}`.catch(() => {});
        await prisma.$executeRaw`DELETE FROM "workspaces" WHERE id = ${wsId}`.catch(() => {});
      }
    } finally {
      await prisma.$disconnect();
    }
  });

  async function createFixture() {
    const rawId = randomUUID();
    const wsId = `ws_p22e_${rawId}`;
    createdWorkspaceIds.push(wsId);

    await prisma.workspace.create({
      data: {
        id: wsId,
        name: `Settlement Uniqueness WS ${rawId.slice(0, 8)}`,
        slug: `settlement-uniq-${rawId}`,
        status: 'ACTIVE',
      },
    });

    const campaign = await prisma.campaign.create({
      data: {
        workspace_id: wsId,
        name: 'Settlement Campaign',
      },
    });

    const buyer = await prisma.buyer.create({
      data: {
        workspace_id: wsId,
        name: 'Settlement Buyer',
        destination_number: '+15551234567',
        max_concurrent_calls: 5,
        status: 'ACTIVE',
      },
    });

    const vendor = await prisma.vendor.create({
      data: {
        workspace_id: wsId,
        name: 'Settlement Vendor',
        status: 'ACTIVE',
      },
    });

    return { wsId, campaignId: campaign.id, buyerId: buyer.id, vendorId: vendor.id };
  }

  async function createFinalCallCommercial(params: {
    wsId: string;
    campaignId: string;
    buyerId: string;
    vendorId: string;
    finalizesAt: Date;
    revenue?: number;
    payout?: number;
  }): Promise<string> {
    const callId = `call_p22e_${randomUUID()}`;
    await prisma.call.create({
      data: {
        id: callId,
        workspace_id: params.wsId,
        campaign_id: params.campaignId,
        provider: 'telnyx',
        provider_call_id: `prov_${callId}`,
        from_number: '+15551112222',
        to_number: '+15553334444',
        state: 'COMPLETED',
      },
    });

    const comm = await prisma.callCommercial.create({
      data: {
        workspace_id: params.wsId,
        call_id: callId,
        campaign_id: params.campaignId,
        buyer_id: params.buyerId,
        vendor_id: params.vendorId,
        currency: 'USD',
        revenue: params.revenue ?? 50.0,
        payout: params.payout ?? 25.0,
        cost: 0.2,
        profit: 24.8,
        status: CommercialStatus.FINAL,
        finalizes_at: params.finalizesAt,
      },
    });

    return comm.id;
  }

  // 1. PostgreSQL Unique Constraint on SettlementItem (Participant Type)
  it('1. Enforces PostgreSQL unique constraint on SettlementItem: @@unique([call_commercial_id, participant_type])', async () => {
    const { wsId, campaignId, buyerId, vendorId } = await createFixture();
    const finalizesAt = new Date('2026-10-05T12:00:00Z');
    const commId = await createFinalCallCommercial({ wsId, campaignId, buyerId, vendorId, finalizesAt });

    const batch = await prisma.settlementBatch.create({
      data: {
        workspace_id: wsId,
        batch_number: `SB-BUYER-${randomUUID().slice(0, 8)}`,
        participant_type: SettlementParticipantType.BUYER,
        buyer_id: buyerId,
        currency: 'USD',
        period_start: new Date('2026-10-01T00:00:00Z'),
        period_end: new Date('2026-10-08T00:00:00Z'),
        created_by_user_id: 'qa-user',
      },
    });

    // Step A: Insert first BUYER settlement item -> Succeeds
    const item1 = await prisma.settlementItem.create({
      data: {
        workspace_id: wsId,
        settlement_batch_id: batch.id,
        call_commercial_id: commId,
        participant_type: SettlementParticipantType.BUYER,
        amount: 50.0,
        currency: 'USD',
      },
    });
    expect(item1.id).toBeDefined();

    // Step B: Attempt to insert SECOND BUYER item for SAME CallCommercial -> Fails with unique constraint P2002
    await expect(
      prisma.settlementItem.create({
        data: {
          workspace_id: wsId,
          settlement_batch_id: batch.id,
          call_commercial_id: commId,
          participant_type: SettlementParticipantType.BUYER,
          amount: 50.0,
          currency: 'USD',
        },
      }),
    ).rejects.toThrow();
  });

  // 2. Buyer and Vendor Coexistence
  it('2. Verifies Buyer and Vendor coexistence: same CallCommercial validly holds both BUYER and VENDOR items', async () => {
    const { wsId, campaignId, buyerId, vendorId } = await createFixture();
    const finalizesAt = new Date('2026-10-05T12:00:00Z');
    const commId = await createFinalCallCommercial({ wsId, campaignId, buyerId, vendorId, finalizesAt });

    const buyerBatch = await prisma.settlementBatch.create({
      data: {
        workspace_id: wsId,
        batch_number: `SB-BUYER-${randomUUID().slice(0, 8)}`,
        participant_type: SettlementParticipantType.BUYER,
        buyer_id: buyerId,
        currency: 'USD',
        period_start: new Date('2026-10-01T00:00:00Z'),
        period_end: new Date('2026-10-08T00:00:00Z'),
        created_by_user_id: 'qa-user',
      },
    });

    const vendorBatch = await prisma.settlementBatch.create({
      data: {
        workspace_id: wsId,
        batch_number: `SB-VENDOR-${randomUUID().slice(0, 8)}`,
        participant_type: SettlementParticipantType.VENDOR,
        vendor_id: vendorId,
        currency: 'USD',
        period_start: new Date('2026-10-01T00:00:00Z'),
        period_end: new Date('2026-10-08T00:00:00Z'),
        created_by_user_id: 'qa-user',
      },
    });

    // Create BUYER item
    const buyerItem = await prisma.settlementItem.create({
      data: {
        workspace_id: wsId,
        settlement_batch_id: buyerBatch.id,
        call_commercial_id: commId,
        participant_type: SettlementParticipantType.BUYER,
        amount: 50.0,
        currency: 'USD',
      },
    });

    // Create VENDOR item for SAME CallCommercial -> Succeeds!
    const vendorItem = await prisma.settlementItem.create({
      data: {
        workspace_id: wsId,
        settlement_batch_id: vendorBatch.id,
        call_commercial_id: commId,
        participant_type: SettlementParticipantType.VENDOR,
        amount: 25.0,
        currency: 'USD',
      },
    });

    expect(buyerItem.id).toBeDefined();
    expect(vendorItem.id).toBeDefined();

    // Verify both items coexist in PostgreSQL
    const items = await prisma.settlementItem.findMany({
      where: { call_commercial_id: commId },
    });
    expect(items.length).toBe(2);
    expect(items.some((i) => i.participant_type === SettlementParticipantType.BUYER)).toBe(true);
    expect(items.some((i) => i.participant_type === SettlementParticipantType.VENDOR)).toBe(true);
  });

  // 3. Batch Number Workspace-Level Uniqueness
  it('3. Enforces PostgreSQL unique constraint on SettlementBatch: @@unique([workspace_id, batch_number])', async () => {
    const { wsId, buyerId } = await createFixture();
    const batchNumber = `SB-UNIQUE-BATCH-001`;

    await prisma.settlementBatch.create({
      data: {
        workspace_id: wsId,
        batch_number: batchNumber,
        participant_type: SettlementParticipantType.BUYER,
        buyer_id: buyerId,
        currency: 'USD',
        period_start: new Date('2026-10-01T00:00:00Z'),
        period_end: new Date('2026-10-08T00:00:00Z'),
        created_by_user_id: 'qa-user',
      },
    });

    // Duplicate batch number in SAME workspace fails
    await expect(
      prisma.settlementBatch.create({
        data: {
          workspace_id: wsId,
          batch_number: batchNumber,
          participant_type: SettlementParticipantType.BUYER,
          buyer_id: buyerId,
          currency: 'USD',
          period_start: new Date('2026-10-01T00:00:00Z'),
          period_end: new Date('2026-10-08T00:00:00Z'),
          created_by_user_id: 'qa-user',
        },
      }),
    ).rejects.toThrow();
  });

  // 4. Concurrent Settlement Batch Generation
  it('4. Concurrent settlement generation: simultaneous workers produce deterministic batch and idempotent items without duplication', async () => {
    const { wsId, campaignId, buyerId, vendorId } = await createFixture();

    const periodStart = new Date('2026-10-01T00:00:00.000Z');
    const periodEnd = new Date('2026-10-08T00:00:00.000Z');

    // Create 3 matured CallCommercial records in this period
    await createFinalCallCommercial({
      wsId,
      campaignId,
      buyerId,
      vendorId,
      finalizesAt: new Date('2026-10-02T12:00:00.000Z'),
      revenue: 40.0,
    });
    await createFinalCallCommercial({
      wsId,
      campaignId,
      buyerId,
      vendorId,
      finalizesAt: new Date('2026-10-03T12:00:00.000Z'),
      revenue: 60.0,
    });
    await createFinalCallCommercial({
      wsId,
      campaignId,
      buyerId,
      vendorId,
      finalizesAt: new Date('2026-10-04T12:00:00.000Z'),
      revenue: 50.0,
    });

    // Launch 2 simultaneous workers generating buyer settlements for the identical period and buyer
    const [summary1, summary2] = await Promise.all([
      settlementService.generateBuyerSettlement({
        workspace_id: wsId,
        period_start: periodStart,
        period_end: periodEnd,
        buyer_id: buyerId,
      }),
      settlementService.generateBuyerSettlement({
        workspace_id: wsId,
        period_start: periodStart,
        period_end: periodEnd,
        buyer_id: buyerId,
      }),
    ]);

    expect(summary1.batches.length).toBeGreaterThan(0);
    expect(summary2.batches.length).toBeGreaterThan(0);

    // Both workers reference the exact same batch ID
    expect(summary1.batches[0].batch_id).toBe(summary2.batches[0].batch_id);

    // Verify in real PostgreSQL: Exactly 1 batch exists and exactly 3 items exist
    const batchesInDb = await prisma.settlementBatch.findMany({
      where: { workspace_id: wsId, buyer_id: buyerId },
      include: { items: true },
    });
    expect(batchesInDb.length).toBe(1);
    expect(batchesInDb[0].items.length).toBe(3);

    // Net amount = 40 + 60 + 50 = 150.0000
    expect(batchesInDb[0].net_amount.toNumber()).toBe(150.0);
    expect(batchesInDb[0].gross_amount.toNumber()).toBe(150.0);
  });
});
