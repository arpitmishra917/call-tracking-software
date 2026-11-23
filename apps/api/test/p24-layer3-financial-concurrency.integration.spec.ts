import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  PrismaClient,
  ReservationStatus,
  TransactionType,
  CallState,
  SettlementParticipantType,
  CommercialStatus,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { WalletService } from '../src/billing/wallet.service.js';
import { CallsService } from '../src/calls/calls.service.js';
import { SettlementBatchService } from '../src/settlement/settlement-batch.service.js';
import { FakeTelephonyProvider } from '../src/telephony/fake.provider.js';
import { assertNonProductionDatabase } from '../src/common/database-isolation.util.js';
import { BadRequestException, ConflictException } from '@nestjs/common';

class MockWebhooksService {
  async queueEvent(): Promise<void> {}
}

describe('P2.4 Layer 3: Financial & Concurrency Integrity Regression Suite (Real PostgreSQL)', () => {
  const qaDbUrl =
    process.env.DATABASE_URL && process.env.DATABASE_URL.includes('_test')
      ? process.env.DATABASE_URL
      : 'postgresql://postgres:%2A222%2A2%23Arpit@localhost:5432/calltracking_mvp_test?schema=public';

  let prisma: PrismaClient;
  let walletService: WalletService;
  let callsService: CallsService;
  let settlementService: SettlementBatchService;
  let fakeProvider: FakeTelephonyProvider;

  const createdWorkspaceIds: string[] = [];

  beforeAll(async () => {
    assertNonProductionDatabase(qaDbUrl, 'P2.4 Layer 3 Regression Suite');
    prisma = new PrismaClient({
      datasources: {
        db: {
          url: qaDbUrl,
        },
      },
    });
    await prisma.$connect();

    walletService = new WalletService(prisma as any);
    fakeProvider = new FakeTelephonyProvider();
    callsService = new CallsService(
      prisma as any,
      fakeProvider as any,
      new MockWebhooksService() as any,
      {
        getPricingConfig: () => ({
          LOCAL_PER_MINUTE_MICRO: 45000n,
          TOLL_FREE_PER_MINUTE_MICRO: 55000n,
          RECORDING_PER_MINUTE_MICRO: 2500n,
        }),
      } as any,
    );
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
        await prisma.$executeRaw`DELETE FROM "wallet_transactions" WHERE workspace_id = ${wsId}`.catch(() => {});
        await prisma.$executeRaw`DELETE FROM "call_reservation_extensions" WHERE workspace_id = ${wsId}`.catch(() => {});
        await prisma.$executeRaw`DELETE FROM "call_reservations" WHERE workspace_id = ${wsId}`.catch(() => {});
        await prisma.$executeRaw`DELETE FROM "buyer_reservations" WHERE workspace_id = ${wsId}`.catch(() => {});
        await prisma.$executeRaw`DELETE FROM "call_attempts" WHERE call_id IN (SELECT id FROM "calls" WHERE workspace_id = ${wsId})`.catch(() => {});
        await prisma.$executeRaw`DELETE FROM "calls" WHERE workspace_id = ${wsId}`.catch(() => {});
        await prisma.$executeRaw`DELETE FROM "campaign_destination_numbers" WHERE campaign_id IN (SELECT id FROM "campaigns" WHERE workspace_id = ${wsId})`.catch(() => {});
        await prisma.$executeRaw`DELETE FROM "campaign_buyers" WHERE campaign_id IN (SELECT id FROM "campaigns" WHERE workspace_id = ${wsId})`.catch(() => {});
        await prisma.$executeRaw`DELETE FROM "destination_numbers" WHERE workspace_id = ${wsId}`.catch(() => {});
        await prisma.$executeRaw`DELETE FROM "buyers" WHERE workspace_id = ${wsId}`.catch(() => {});
        await prisma.$executeRaw`DELETE FROM "vendors" WHERE workspace_id = ${wsId}`.catch(() => {});
        await prisma.$executeRaw`DELETE FROM "campaigns" WHERE workspace_id = ${wsId}`.catch(() => {});
        await prisma.$executeRaw`DELETE FROM "workspace_balances" WHERE workspace_id = ${wsId}`.catch(() => {});
        await prisma.$executeRaw`DELETE FROM "workspaces" WHERE id = ${wsId}`.catch(() => {});
      }
    } finally {
      await prisma.$disconnect();
    }
  });

  // Helper Fixture Creators
  async function createTestWorkspace(initialBalanceMicro = 100_000_000n): Promise<string> {
    const rawId = randomUUID();
    const wsId = `ws_p24l3_${rawId}`;
    createdWorkspaceIds.push(wsId);

    await prisma.workspace.create({
      data: {
        id: wsId,
        name: `P24 Layer 3 Test WS ${rawId.slice(0, 8)}`,
        slug: `p24-l3-${rawId}`,
        status: 'ACTIVE',
      },
    });

    await prisma.workspaceBalance.create({
      data: {
        workspace_id: wsId,
        balance_micro: initialBalanceMicro,
        balance_minor: Number(initialBalanceMicro / 10000n),
        reserved_micro: 0n,
      },
    });

    return wsId;
  }

  async function createTestCall(workspaceId: string, campaignId?: string): Promise<string> {
    const callId = `call_p24l3_${randomUUID()}`;
    await prisma.call.create({
      data: {
        id: callId,
        workspace_id: workspaceId,
        campaign_id: campaignId,
        provider: 'telnyx',
        provider_call_id: `prov_${callId}`,
        from_number: '+15551112222',
        to_number: '+15553334444',
        state: campaignId ? CallState.ROUTING : CallState.INITIATED,
      },
    });
    return callId;
  }

  async function createBuyerRoutingFixture(concurrencyLimit = 2) {
    const wsId = await createTestWorkspace();

    const campaign = await prisma.campaign.create({
      data: {
        workspace_id: wsId,
        name: `Routing Campaign ${randomUUID().slice(0, 8)}`,
        status: 'ACTIVE',
      },
    });

    const buyer1 = await prisma.buyer.create({
      data: {
        workspace_id: wsId,
        name: `Primary Buyer (Cap ${concurrencyLimit})`,
        destination_number: '+15550001001',
        max_concurrent_calls: concurrencyLimit,
        status: 'ACTIVE',
      },
    });

    const buyer2 = await prisma.buyer.create({
      data: {
        workspace_id: wsId,
        name: 'Secondary Fallback Buyer (Cap 5)',
        destination_number: '+15550002002',
        max_concurrent_calls: 5,
        status: 'ACTIVE',
      },
    });

    await prisma.campaignBuyer.create({
      data: {
        workspace_id: wsId,
        campaign_id: campaign.id,
        buyer_id: buyer1.id,
        priority: 1,
        status: 'ACTIVE',
      },
    });

    await prisma.campaignBuyer.create({
      data: {
        workspace_id: wsId,
        campaign_id: campaign.id,
        buyer_id: buyer2.id,
        priority: 2,
        status: 'ACTIVE',
      },
    });

    return { wsId, campaignId: campaign.id, buyer1Id: buyer1.id, buyer2Id: buyer2.id };
  }

  // =========================================================================
  // SECTION 1: BUYER CONCURRENCY & RESERVATION REGRESSION TESTS
  // =========================================================================

  it('1. Buyer Concurrency Limit: Enforces strict row locks on concurrent calls, preventing over-allocation', async () => {
    // Primary buyer has capacity 2
    const { wsId, campaignId, buyer1Id, buyer2Id } = await createBuyerRoutingFixture(2);

    // Dispatch 5 simultaneous incoming calls to the same campaign
    const calls = await Promise.all([
      createTestCall(wsId, campaignId),
      createTestCall(wsId, campaignId),
      createTestCall(wsId, campaignId),
      createTestCall(wsId, campaignId),
      createTestCall(wsId, campaignId),
    ]);

    const routingResults = await Promise.all(
      calls.map((c) => callsService.prepareNextBuyer(c)),
    );

    // Exactly 2 calls must be routed to Buyer 1 (capacity 2)
    const routedToBuyer1 = routingResults.filter((r) => r.action === 'DIAL' && r.buyer?.id === buyer1Id);
    expect(routedToBuyer1.length).toBe(2);

    // The remaining 3 calls must overflow/waterfall to Buyer 2
    const routedToBuyer2 = routingResults.filter((r) => r.action === 'DIAL' && r.buyer?.id === buyer2Id);
    expect(routedToBuyer2.length).toBe(3);

    // Verify in real PostgreSQL: Exactly 2 ACTIVE reservations exist for Buyer 1
    const activeBuyer1Res = await prisma.buyerReservation.count({
      where: { buyer_id: buyer1Id, status: 'ACTIVE' },
    });
    expect(activeBuyer1Res).toBe(2);

    // Verify in real PostgreSQL: Exactly 3 ACTIVE reservations exist for Buyer 2
    const activeBuyer2Res = await prisma.buyerReservation.count({
      where: { buyer_id: buyer2Id, status: 'ACTIVE' },
    });
    expect(activeBuyer2Res).toBe(3);
  });

  it('2. Waterfall Exhaustion: Returns BUSY and transitions call to FAILED when all buyers reach max concurrency', async () => {
    const wsId = await createTestWorkspace();

    const campaign = await prisma.campaign.create({
      data: {
        workspace_id: wsId,
        name: 'Single Buyer Campaign',
        status: 'ACTIVE',
      },
    });

    const buyer = await prisma.buyer.create({
      data: {
        workspace_id: wsId,
        name: 'Solo Buyer (Cap 1)',
        destination_number: '+15559990001',
        max_concurrent_calls: 1,
        status: 'ACTIVE',
      },
    });

    await prisma.campaignBuyer.create({
      data: {
        workspace_id: wsId,
        campaign_id: campaign.id,
        buyer_id: buyer.id,
        priority: 1,
        status: 'ACTIVE',
      },
    });

    const call1 = await createTestCall(wsId, campaign.id);
    const call2 = await createTestCall(wsId, campaign.id);

    const route1 = await callsService.prepareNextBuyer(call1);
    expect(route1.action).toBe('DIAL');
    expect(route1.buyer?.id).toBe(buyer.id);

    // Call 2 arrives with solo buyer at max concurrency
    const route2 = await callsService.prepareNextBuyer(call2);
    expect(route2.action).toBe('BUSY');

    const dbCall2 = await prisma.call.findUniqueOrThrow({ where: { id: call2 } });
    expect(dbCall2.state).toBe(CallState.FAILED);
  });

  it('3. Buyer Reservation Release: Releasing reservation immediately unblocks capacity for subsequent callers', async () => {
    const { wsId, campaignId, buyer1Id } = await createBuyerRoutingFixture(1);

    const call1 = await createTestCall(wsId, campaignId);
    const route1 = await callsService.prepareNextBuyer(call1);
    expect(route1.action).toBe('DIAL');
    expect(route1.buyer?.id).toBe(buyer1Id);

    // Active reservation count in PostgreSQL is 1
    const beforeCount = await prisma.buyerReservation.count({
      where: { buyer_id: buyer1Id, status: 'ACTIVE' },
    });
    expect(beforeCount).toBe(1);

    // Release buyer reservation (e.g., call hung up)
    await callsService.releaseBuyerReservation(route1.attempt.id);

    // Active count in PostgreSQL drops back to 0
    const afterCount = await prisma.buyerReservation.count({
      where: { buyer_id: buyer1Id, status: 'ACTIVE' },
    });
    expect(afterCount).toBe(0);

    // Subsequent call now successfully claims Buyer 1 slot
    const call2 = await createTestCall(wsId, campaignId);
    const route2 = await callsService.prepareNextBuyer(call2);
    expect(route2.action).toBe('DIAL');
    expect(route2.buyer?.id).toBe(buyer1Id);
  });

  // =========================================================================
  // SECTION 2: WALLET HOLDS, ATOMIC DECREMENT & ROLLBACK INTEGRITY
  // =========================================================================

  it('4. Multi-Worker Concurrent Wallet Hold Race: Prevents negative balance overdraft under high contention', async () => {
    // Initial balance: $15 (15,000,000 micro)
    const wsId = await createTestWorkspace(15_000_000n);

    // 4 concurrent calls each request a $5 (5,000,000 micro) hold
    // Total requested = $20, but only $15 is available
    const calls = await Promise.all([
      createTestCall(wsId),
      createTestCall(wsId),
      createTestCall(wsId),
      createTestCall(wsId),
    ]);

    const results = await Promise.allSettled(
      calls.map((c) => walletService.reserveForCall(wsId, c, 5_000_000n)),
    );

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    // Exactly 3 holds succeed ($15), exactly 1 hold fails
    expect(fulfilled.length).toBe(3);
    expect(rejected.length).toBe(1);

    // Verify rejection error
    const failedReason = (rejected[0] as PromiseRejectedResult).reason;
    expect(failedReason).toBeInstanceOf(BadRequestException);
    expect(failedReason.message).toMatch(/Insufficient available funds/i);

    // Verify PostgreSQL balance invariants
    const balance = await prisma.workspaceBalance.findUniqueOrThrow({
      where: { workspace_id: wsId },
    });
    expect(balance.balance_micro).toBe(15_000_000n);
    expect(balance.reserved_micro).toBe(15_000_000n);
    expect(balance.balance_micro - balance.reserved_micro).toBe(0n);

    // Verify 3 ACTIVE reservations in PostgreSQL
    const resCount = await prisma.callReservation.count({
      where: { workspace_id: wsId, status: ReservationStatus.ACTIVE },
    });
    expect(resCount).toBe(3);
  });

  it('5. Atomic Settlement & Balance Decrement: Safely settles actual cost, releases hold, and writes DEBIT ledger', async () => {
    // Initial balance: $20 (20,000,000 micro)
    const wsId = await createTestWorkspace(20_000_000n);
    const callId = await createTestCall(wsId);

    // Hold $10 (10,000,000 micro)
    await walletService.reserveForCall(wsId, callId, 10_000_000n);

    // Settle with actual cost = $6.50 (6,500,000 micro)
    const settlement = await walletService.settleReservation(wsId, callId, 6_500_000n);
    expect(settlement.status).toBe(ReservationStatus.SETTLED);

    // Verify in PostgreSQL:
    // Balance: 20,000,000 - 6,500,000 = 13,500,000 micro
    // Reserved: 10,000,000 - 10,000,000 = 0 micro
    const balance = await prisma.workspaceBalance.findUniqueOrThrow({
      where: { workspace_id: wsId },
    });
    expect(balance.balance_micro).toBe(13_500_000n);
    expect(balance.reserved_micro).toBe(0n);
    expect(balance.balance_minor).toBe(1350);

    // Verify DEBIT ledger transaction
    const tx = await prisma.walletTransaction.findFirstOrThrow({
      where: {
        workspace_id: wsId,
        reference_id: callId,
        type: TransactionType.DEBIT,
      },
    });
    expect(tx.amount_micro).toBe(6_500_000n);
    expect(tx.balance_after_micro).toBe(13_500_000n);
    expect(tx.balance_after).toBe(1350);
  });

  it('6. Rollback Integrity: Failed settlement with cost exceeding hold leaves balances and ledger untouched', async () => {
    // Initial balance: $10 (10,000,000 micro)
    const wsId = await createTestWorkspace(10_000_000n);
    const callId = await createTestCall(wsId);

    // Hold $5 (5,000,000 micro)
    await walletService.reserveForCall(wsId, callId, 5_000_000n);

    // Attempt settlement with $8 (8,000,000 micro) > held $5 -> Rejects
    await expect(
      walletService.settleReservation(wsId, callId, 8_000_000n),
    ).rejects.toThrow(BadRequestException);

    // Verify rollback integrity in PostgreSQL:
    // Balances are completely unchanged
    const balance = await prisma.workspaceBalance.findUniqueOrThrow({
      where: { workspace_id: wsId },
    });
    expect(balance.balance_micro).toBe(10_000_000n);
    expect(balance.reserved_micro).toBe(5_000_000n);

    // Reservation remains ACTIVE
    const res = await prisma.callReservation.findFirstOrThrow({
      where: { call_id: callId },
    });
    expect(res.status).toBe(ReservationStatus.ACTIVE);

    // Zero DEBIT transactions created
    const debits = await prisma.walletTransaction.count({
      where: { workspace_id: wsId, type: TransactionType.DEBIT },
    });
    expect(debits).toBe(0);
  });

  it('7. Rollback Integrity: Direct wallet debit overdraft rolls back transaction atomically', async () => {
    const wsId = await createTestWorkspace(5_000_000n);

    // Attempt direct debit of $10 against $5 balance
    await expect(
      walletService.debitWallet({
        workspaceId: wsId,
        amountMicro: 10_000_000n,
        referenceType: 'MANUAL_DEBIT',
        referenceId: 'ref-overdraft-test',
        idempotencyKey: `idem-debit-overdraft-${randomUUID()}`,
      }),
    ).rejects.toThrow(BadRequestException);

    // Verify balance remains pristine $5
    const balance = await prisma.workspaceBalance.findUniqueOrThrow({
      where: { workspace_id: wsId },
    });
    expect(balance.balance_micro).toBe(5_000_000n);

    // Zero transactions created
    const txCount = await prisma.walletTransaction.count({
      where: { workspace_id: wsId },
    });
    expect(txCount).toBe(0);
  });

  it('8. Wallet Idempotency: Protects ledger from duplicate debit/credit operations with conflicting payloads', async () => {
    const wsId = await createTestWorkspace(20_000_000n);
    const key = `idem-topup-${randomUUID()}`;

    // Initial credit of $10
    const tx1 = await walletService.creditWallet({
      workspaceId: wsId,
      amountMicro: 10_000_000n,
      referenceType: 'TOPUP',
      referenceId: 'topup-001',
      idempotencyKey: key,
    });
    expect(tx1.id).toBeDefined();

    // Replaying identical request returns identical transaction
    const tx2 = await walletService.creditWallet({
      workspaceId: wsId,
      amountMicro: 10_000_000n,
      referenceType: 'TOPUP',
      referenceId: 'topup-001',
      idempotencyKey: key,
    });
    expect(tx2.id).toBe(tx1.id);

    // Reusing same idempotency key with conflicting amount ($15) MUST reject with ConflictException
    await expect(
      walletService.creditWallet({
        workspaceId: wsId,
        amountMicro: 15_000_000n,
        referenceType: 'TOPUP',
        referenceId: 'topup-001',
        idempotencyKey: key,
      }),
    ).rejects.toThrow(ConflictException);
  });

  // =========================================================================
  // SECTION 3: SETTLEMENT CONSTRAINTS & UNIQUENESS REGRESSION TESTS
  // =========================================================================

  async function createSettlementFixture() {
    const wsId = await createTestWorkspace();

    const campaign = await prisma.campaign.create({
      data: {
        workspace_id: wsId,
        name: `Settlement Test Campaign ${randomUUID().slice(0, 8)}`,
      },
    });

    const buyer = await prisma.buyer.create({
      data: {
        workspace_id: wsId,
        name: 'Settlement Test Buyer',
        destination_number: '+15558881234',
        max_concurrent_calls: 5,
        status: 'ACTIVE',
      },
    });

    const vendor = await prisma.vendor.create({
      data: {
        workspace_id: wsId,
        name: 'Settlement Test Vendor',
        status: 'ACTIVE',
      },
    });

    const callId = `call_settle_${randomUUID()}`;
    await prisma.call.create({
      data: {
        id: callId,
        workspace_id: wsId,
        campaign_id: campaign.id,
        provider: 'telnyx',
        provider_call_id: `prov_${callId}`,
        from_number: '+15557770001',
        to_number: '+15557770002',
        state: 'COMPLETED',
      },
    });

    const commercial = await prisma.callCommercial.create({
      data: {
        workspace_id: wsId,
        call_id: callId,
        campaign_id: campaign.id,
        buyer_id: buyer.id,
        vendor_id: vendor.id,
        currency: 'USD',
        revenue: 40.0,
        payout: 20.0,
        cost: 1.0,
        profit: 19.0,
        status: CommercialStatus.FINAL,
        finalizes_at: new Date('2026-10-01T12:00:00Z'),
      },
    });

    return {
      wsId,
      campaignId: campaign.id,
      buyerId: buyer.id,
      vendorId: vendor.id,
      callId,
      commercialId: commercial.id,
    };
  }

  it('9. SettlementItem Constraint: Enforces PostgreSQL @@unique([call_commercial_id, participant_type])', async () => {
    const { wsId, buyerId, commercialId } = await createSettlementFixture();

    const batch = await prisma.settlementBatch.create({
      data: {
        workspace_id: wsId,
        batch_number: `SB-ITEM-UNIQ-${randomUUID().slice(0, 8)}`,
        participant_type: SettlementParticipantType.BUYER,
        buyer_id: buyerId,
        currency: 'USD',
        period_start: new Date('2026-10-01T00:00:00Z'),
        period_end: new Date('2026-10-08T00:00:00Z'),
        created_by_user_id: 'qa-tester',
      },
    });

    // 1st BUYER item succeeds
    const item1 = await prisma.settlementItem.create({
      data: {
        workspace_id: wsId,
        settlement_batch_id: batch.id,
        call_commercial_id: commercialId,
        participant_type: SettlementParticipantType.BUYER,
        amount: 40.0,
        currency: 'USD',
      },
    });
    expect(item1.id).toBeDefined();

    // 2nd BUYER item for SAME call_commercial_id MUST fail with unique constraint violation P2002
    await expect(
      prisma.settlementItem.create({
        data: {
          workspace_id: wsId,
          settlement_batch_id: batch.id,
          call_commercial_id: commercialId,
          participant_type: SettlementParticipantType.BUYER,
          amount: 40.0,
          currency: 'USD',
        },
      }),
    ).rejects.toThrow();
  });

  it('10. Multi-Participant Coexistence: Validates BUYER and VENDOR items coexist for the same CallCommercial', async () => {
    const { wsId, buyerId, vendorId, commercialId } = await createSettlementFixture();

    const buyerBatch = await prisma.settlementBatch.create({
      data: {
        workspace_id: wsId,
        batch_number: `SB-COEXIST-BUYER-${randomUUID().slice(0, 8)}`,
        participant_type: SettlementParticipantType.BUYER,
        buyer_id: buyerId,
        currency: 'USD',
        period_start: new Date('2026-10-01T00:00:00Z'),
        period_end: new Date('2026-10-08T00:00:00Z'),
        created_by_user_id: 'qa-tester',
      },
    });

    const vendorBatch = await prisma.settlementBatch.create({
      data: {
        workspace_id: wsId,
        batch_number: `SB-COEXIST-VENDOR-${randomUUID().slice(0, 8)}`,
        participant_type: SettlementParticipantType.VENDOR,
        vendor_id: vendorId,
        currency: 'USD',
        period_start: new Date('2026-10-01T00:00:00Z'),
        period_end: new Date('2026-10-08T00:00:00Z'),
        created_by_user_id: 'qa-tester',
      },
    });

    const buyerItem = await prisma.settlementItem.create({
      data: {
        workspace_id: wsId,
        settlement_batch_id: buyerBatch.id,
        call_commercial_id: commercialId,
        participant_type: SettlementParticipantType.BUYER,
        amount: 40.0,
        currency: 'USD',
      },
    });

    const vendorItem = await prisma.settlementItem.create({
      data: {
        workspace_id: wsId,
        settlement_batch_id: vendorBatch.id,
        call_commercial_id: commercialId,
        participant_type: SettlementParticipantType.VENDOR,
        amount: 20.0,
        currency: 'USD',
      },
    });

    expect(buyerItem.id).toBeDefined();
    expect(vendorItem.id).toBeDefined();

    // Verify both items coexist in PostgreSQL
    const items = await prisma.settlementItem.findMany({
      where: { call_commercial_id: commercialId },
    });
    expect(items.length).toBe(2);
    expect(items.some((i) => i.participant_type === SettlementParticipantType.BUYER)).toBe(true);
    expect(items.some((i) => i.participant_type === SettlementParticipantType.VENDOR)).toBe(true);
  });

  it('11. SettlementBatch Constraint: Enforces PostgreSQL @@unique([workspace_id, batch_number])', async () => {
    const { wsId, buyerId } = await createSettlementFixture();
    const batchNumber = `SB-UNIQUE-${randomUUID().slice(0, 8)}`;

    // Create first batch in wsId
    const batch1 = await prisma.settlementBatch.create({
      data: {
        workspace_id: wsId,
        batch_number: batchNumber,
        participant_type: SettlementParticipantType.BUYER,
        buyer_id: buyerId,
        currency: 'USD',
        period_start: new Date('2026-10-01T00:00:00Z'),
        period_end: new Date('2026-10-08T00:00:00Z'),
        created_by_user_id: 'qa-tester',
      },
    });
    expect(batch1.id).toBeDefined();

    // Attempt duplicate batch_number in SAME workspace -> MUST fail with unique constraint violation
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
          created_by_user_id: 'qa-tester',
        },
      }),
    ).rejects.toThrow();

    // Creating batch with IDENTICAL batch_number in a DIFFERENT workspace succeeds (tenant isolation)
    const wsIdOther = await createTestWorkspace();
    const buyerOther = await prisma.buyer.create({
      data: {
        workspace_id: wsIdOther,
        name: 'Other Buyer',
        destination_number: '+15554443333',
        status: 'ACTIVE',
      },
    });
    const batchOtherWs = await prisma.settlementBatch.create({
      data: {
        workspace_id: wsIdOther,
        batch_number: batchNumber,
        participant_type: SettlementParticipantType.BUYER,
        buyer_id: buyerOther.id,
        currency: 'USD',
        period_start: new Date('2026-10-01T00:00:00Z'),
        period_end: new Date('2026-10-08T00:00:00Z'),
        created_by_user_id: 'qa-tester',
      },
    });
    expect(batchOtherWs.id).toBeDefined();
    expect(batchOtherWs.workspace_id).toBe(wsIdOther);
  });

  it('12. Concurrent Settlement Generation: Multiple workers generate batches without duplicate items or double settlement', async () => {
    const { wsId, campaignId, buyerId, vendorId } = await createSettlementFixture();
    const periodStart = new Date('2026-10-01T00:00:00.000Z');
    const periodEnd = new Date('2026-10-08T00:00:00.000Z');

    // Create 2 additional matured CallCommercials
    for (let i = 1; i <= 2; i++) {
      const cid = `call_conc_settle_${i}_${randomUUID()}`;
      await prisma.call.create({
        data: {
          id: cid,
          workspace_id: wsId,
          campaign_id: campaignId,
          provider: 'telnyx',
          provider_call_id: `prov_${cid}`,
          from_number: `+1555111000${i}`,
          to_number: `+1555222000${i}`,
          state: 'COMPLETED',
        },
      });

      await prisma.callCommercial.create({
        data: {
          workspace_id: wsId,
          call_id: cid,
          campaign_id: campaignId,
          buyer_id: buyerId,
          vendor_id: vendorId,
          currency: 'USD',
          revenue: 30.0 * i,
          payout: 15.0 * i,
          cost: 0.5,
          profit: 14.5 * i,
          status: CommercialStatus.FINAL,
          finalizes_at: new Date('2026-10-02T12:00:00.000Z'),
        },
      });
    }

    // Two concurrent workers generate buyer settlement for the same period and buyer
    const [res1, res2] = await Promise.all([
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

    expect(res1.batches.length).toBeGreaterThan(0);
    expect(res2.batches.length).toBeGreaterThan(0);
    expect(res1.batches[0].batch_id).toBe(res2.batches[0].batch_id);

    // Verify in real PostgreSQL: Exactly 1 batch and exactly 3 items exist
    const batches = await prisma.settlementBatch.findMany({
      where: { workspace_id: wsId, buyer_id: buyerId },
      include: { items: true },
    });
    expect(batches.length).toBe(1);
    expect(batches[0].items.length).toBe(3);

    // Total gross: 40 + (30*1) + (30*2) = 130
    expect(batches[0].gross_amount.toNumber()).toBe(130.0);
    expect(batches[0].net_amount.toNumber()).toBe(130.0);
  });
});
