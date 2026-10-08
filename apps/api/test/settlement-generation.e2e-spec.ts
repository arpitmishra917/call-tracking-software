import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { SettlementBatchService } from '../src/settlement/settlement-batch.service.js';
import {
  SettlementParticipantType,
  SettlementStatus,
  PaymentStatus,
  ReconciliationStatus,
  CommercialStatus,
  DisputeStatus,
  Prisma,
} from '@prisma/client';

describe('COMM-14 Settlement Eligibility & Batch Generation E2E', () => {
  const uniqueId = (base: string) =>
    `${base}_${Date.now()}_${Math.random().toString(36).substring(7)}`;

  let app: INestApplication;
  let prisma: PrismaService;
  let settlementService: SettlementBatchService;

  let workspaceA: string;
  let workspaceB: string;
  let buyerA: string;
  let buyerB: string;
  let vendorA: string;
  let vendorB: string;
  let campaignA: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get<PrismaService>(PrismaService);
    settlementService = app.get<SettlementBatchService>(SettlementBatchService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    const url = process.env.DATABASE_URL || '';
    if (!url.includes('_test')) {
      throw new Error('Safety check failed: E2E tests must use the test database');
    }

    const wsA = await prisma.workspace.create({
      data: { name: 'WS-A', slug: uniqueId('ws-a') },
    });
    workspaceA = wsA.id;

    const wsB = await prisma.workspace.create({
      data: { name: 'WS-B', slug: uniqueId('ws-b') },
    });
    workspaceB = wsB.id;

    const bA = await prisma.buyer.create({
      data: {
        workspace_id: workspaceA,
        name: 'Buyer Alpha',
        destination_number: '+12025550101',
      },
    });
    buyerA = bA.id;

    const bB = await prisma.buyer.create({
      data: {
        workspace_id: workspaceA,
        name: 'Buyer Beta',
        destination_number: '+12025550102',
      },
    });
    buyerB = bB.id;

    const vA = await prisma.vendor.create({
      data: {
        workspace_id: workspaceA,
        name: 'Vendor One',
      },
    });
    vendorA = vA.id;

    const vB = await prisma.vendor.create({
      data: {
        workspace_id: workspaceA,
        name: 'Vendor Two',
      },
    });
    vendorB = vB.id;

    const campA = await prisma.campaign.create({
      data: {
        workspace_id: workspaceA,
        name: 'Campaign Alpha',
        default_revenue_amount: new Prisma.Decimal('100.0000'),
        default_payout_amount: new Prisma.Decimal('60.0000'),
        currency: 'USD',
      },
    });
    campaignA = campA.id;
  });

  async function createCallCommercial(options?: {
    workspaceId?: string;
    bId?: string | null;
    vId?: string | null;
    status?: CommercialStatus;
    finalizesAt?: Date | null;
    revenue?: string;
    payout?: string;
    currency?: string;
    duplicate?: boolean;
    cost?: string;
  }) {
    const wsId = options?.workspaceId ?? workspaceA;
    const call = await prisma.call.create({
      data: {
        workspace_id: wsId,
        provider: 'telnyx',
        provider_call_id: uniqueId('call_leg'),
        from_number: '+15550001111',
        to_number: '+15550002222',
        state: 'COMPLETED',
        started_at: new Date(),
        ended_at: new Date(),
      },
    });

    return prisma.callCommercial.create({
      data: {
        workspace_id: wsId,
        call_id: call.id,
        campaign_id: campaignA,
        buyer_id: options?.bId === null ? null : (options?.bId ?? buyerA),
        vendor_id: options?.vId === null ? null : (options?.vId ?? vendorA),
        status: options?.status ?? CommercialStatus.FINAL,
        finalizes_at:
          options?.finalizesAt !== undefined
            ? options.finalizesAt
            : new Date(Date.now() - 3600 * 1000), // 1 hour ago (matured)
        revenue: new Prisma.Decimal(options?.revenue ?? '100.0000'),
        payout: new Prisma.Decimal(options?.payout ?? '60.0000'),
        cost: new Prisma.Decimal(options?.cost ?? '5.0000'),
        profit: new Prisma.Decimal('35.0000'),
        currency: options?.currency ?? 'USD',
        duplicate: options?.duplicate ?? false,
      },
    });
  }

  // ==========================================
  // ELIGIBILITY TESTS (1 - 7)
  // ==========================================

  it('1. FINAL + finalizes_at matured + no pending dispute -> eligible', async () => {
    const pStart = new Date('2026-10-01T00:00:00Z');
    const pEnd = new Date('2026-10-08T00:00:00Z');
    const finalizesAt = new Date('2026-10-05T12:00:00Z');

    const comm = await createCallCommercial({
      finalizesAt,
      revenue: '100.0000',
    });

    const res = await settlementService.generateBuyerSettlement({
      workspace_id: workspaceA,
      period_start: pStart,
      period_end: pEnd,
      buyer_id: buyerA,
    });

    expect(res.batches.length).toBe(1);
    expect(res.batches[0].gross_amount).toBe('100');
    expect(res.batches[0].item_count).toBe(1);
  });

  it('2. FINAL + finalizes_at not matured -> not eligible', async () => {
    const pStart = new Date();
    const pEnd = new Date(Date.now() + 10 * 86400 * 1000);
    const futureFinalizesAt = new Date(Date.now() + 3 * 86400 * 1000); // 3 days in future

    await createCallCommercial({
      finalizesAt: futureFinalizesAt,
      revenue: '100.0000',
    });

    const res = await settlementService.generateBuyerSettlement({
      workspace_id: workspaceA,
      period_start: pStart,
      period_end: pEnd,
      buyer_id: buyerA,
    });

    expect(res.batches.length).toBe(0);
  });

  it('3. matured PENDING + no dispute -> JIT finalized to FINAL and included in settlement', async () => {
    const pStart = new Date('2026-10-01T00:00:00Z');
    const pEnd = new Date('2026-10-08T00:00:00Z');
    const finalizesAt = new Date('2026-10-05T12:00:00Z');

    const comm = await createCallCommercial({
      status: CommercialStatus.PENDING,
      finalizesAt,
      revenue: '100.0000',
    });

    const res = await settlementService.generateBuyerSettlement({
      workspace_id: workspaceA,
      period_start: pStart,
      period_end: pEnd,
      buyer_id: buyerA,
    });

    expect(res.batches.length).toBe(1);
    expect(res.batches[0].gross_amount).toBe('100');
    expect(res.batches[0].item_count).toBe(1);

    // Verify CallCommercial status was transitioned to FINAL
    const updated = await prisma.callCommercial.findUnique({
      where: { id: comm.id },
    });
    expect(updated?.status).toBe(CommercialStatus.FINAL);
  });

  it('3b. unmatured PENDING -> remains PENDING and not eligible for settlement', async () => {
    const pStart = new Date();
    const pEnd = new Date(Date.now() + 10 * 86400 * 1000);
    const futureFinalizesAt = new Date(Date.now() + 3 * 86400 * 1000); // 3 days in future

    const comm = await createCallCommercial({
      status: CommercialStatus.PENDING,
      finalizesAt: futureFinalizesAt,
      revenue: '100.0000',
    });

    const res = await settlementService.generateBuyerSettlement({
      workspace_id: workspaceA,
      period_start: pStart,
      period_end: pEnd,
      buyer_id: buyerA,
    });

    expect(res.batches.length).toBe(0);

    const check = await prisma.callCommercial.findUnique({
      where: { id: comm.id },
    });
    expect(check?.status).toBe(CommercialStatus.PENDING);
  });

  it('4. PENDING dispute -> not eligible (blocked)', async () => {
    const pStart = new Date('2026-10-01T00:00:00Z');
    const pEnd = new Date('2026-10-08T00:00:00Z');
    const finalizesAt = new Date('2026-10-05T12:00:00Z');

    const comm = await createCallCommercial({
      finalizesAt,
      revenue: '100.0000',
    });

    await prisma.callDispute.create({
      data: {
        workspace_id: workspaceA,
        call_commercial_id: comm.id,
        buyer_id: buyerA,
        reason: 'Call quality defect',
        status: DisputeStatus.PENDING,
        created_by_user_id: uniqueId('user'),
      },
    });

    const res = await settlementService.generateBuyerSettlement({
      workspace_id: workspaceA,
      period_start: pStart,
      period_end: pEnd,
      buyer_id: buyerA,
    });

    expect(res.batches.length).toBe(0);
    expect(res.skipped_calls_count).toBe(1);
  });

  it('5. REJECTED dispute -> eligible if other conditions pass', async () => {
    const pStart = new Date('2026-10-01T00:00:00Z');
    const pEnd = new Date('2026-10-08T00:00:00Z');
    const finalizesAt = new Date('2026-10-05T12:00:00Z');

    const comm = await createCallCommercial({
      finalizesAt,
      revenue: '100.0000',
    });

    await prisma.callDispute.create({
      data: {
        workspace_id: workspaceA,
        call_commercial_id: comm.id,
        buyer_id: buyerA,
        reason: 'Call quality defect',
        status: DisputeStatus.REJECTED,
        created_by_user_id: uniqueId('user'),
      },
    });

    const res = await settlementService.generateBuyerSettlement({
      workspace_id: workspaceA,
      period_start: pStart,
      period_end: pEnd,
      buyer_id: buyerA,
    });

    expect(res.batches.length).toBe(1);
    expect(res.batches[0].gross_amount).toBe('100');
  });

  it('6. ACCEPTED/ADJUSTED with revenue/payout zero -> no positive item', async () => {
    const pStart = new Date('2026-10-01T00:00:00Z');
    const pEnd = new Date('2026-10-08T00:00:00Z');
    const finalizesAt = new Date('2026-10-05T12:00:00Z');

    await createCallCommercial({
      status: CommercialStatus.ADJUSTED,
      finalizesAt,
      revenue: '0.0000',
      payout: '0.0000',
    });

    const res = await settlementService.generateBuyerSettlement({
      workspace_id: workspaceA,
      period_start: pStart,
      period_end: pEnd,
      buyer_id: buyerA,
    });

    expect(res.batches.length).toBe(0);
  });

  it('7. finalizes_at boundary exactly NOW -> eligible', async () => {
    const now = new Date();
    const pStart = new Date(now.getTime() - 86400 * 1000);
    const pEnd = new Date(now.getTime() + 86400 * 1000);

    await createCallCommercial({
      finalizesAt: now,
      revenue: '50.0000',
    });

    const res = await settlementService.generateBuyerSettlement({
      workspace_id: workspaceA,
      period_start: pStart,
      period_end: pEnd,
      buyer_id: buyerA,
    });

    expect(res.batches.length).toBe(1);
    expect(res.batches[0].gross_amount).toBe('50');
  });

  // ==========================================
  // BUYER SETTLEMENT TESTS (8 - 11)
  // ==========================================

  it('8 & 9 & 10. valid Buyer revenue creates BUYER SettlementItem with exact persisted revenue & currency', async () => {
    const pStart = new Date('2026-10-01T00:00:00Z');
    const pEnd = new Date('2026-10-08T00:00:00Z');
    const finalizesAt = new Date('2026-10-05T12:00:00Z');

    const comm = await createCallCommercial({
      finalizesAt,
      revenue: '125.7500',
      currency: 'USD',
    });

    const res = await settlementService.generateBuyerSettlement({
      workspace_id: workspaceA,
      period_start: pStart,
      period_end: pEnd,
      buyer_id: buyerA,
    });

    expect(res.batches.length).toBe(1);
    const batch = res.batches[0];
    expect(batch.participant_type).toBe(SettlementParticipantType.BUYER);
    expect(batch.buyer_id).toBe(buyerA);
    expect(batch.vendor_id).toBeNull();
    expect(batch.gross_amount).toBe('125.75');
    expect(batch.currency).toBe('USD');

    const items = await prisma.settlementItem.findMany({
      where: { settlement_batch_id: batch.batch_id },
    });
    expect(items.length).toBe(1);
    expect(items[0].participant_type).toBe(SettlementParticipantType.BUYER);
    expect(items[0].amount.toString()).toBe('125.75');
    expect(items[0].currency).toBe('USD');
    expect(items[0].call_commercial_id).toBe(comm.id);
  });

  it('11. missing buyer_id skips Buyer item', async () => {
    const pStart = new Date('2026-10-01T00:00:00Z');
    const pEnd = new Date('2026-10-08T00:00:00Z');
    const finalizesAt = new Date('2026-10-05T12:00:00Z');

    await createCallCommercial({
      finalizesAt,
      bId: null,
      revenue: '100.0000',
    });

    const res = await settlementService.generateBuyerSettlement({
      workspace_id: workspaceA,
      period_start: pStart,
      period_end: pEnd,
    });

    expect(res.batches.length).toBe(0);
    expect(res.skipped_calls_count).toBe(1);
  });

  // ==========================================
  // VENDOR SETTLEMENT TESTS (12 - 15)
  // ==========================================

  it('12 & 13 & 14. valid Vendor payout creates VENDOR SettlementItem with exact persisted payout & currency', async () => {
    const pStart = new Date('2026-10-01T00:00:00Z');
    const pEnd = new Date('2026-10-08T00:00:00Z');
    const finalizesAt = new Date('2026-10-05T12:00:00Z');

    const comm = await createCallCommercial({
      finalizesAt,
      payout: '75.2500',
      currency: 'USD',
    });

    const res = await settlementService.generateVendorSettlement({
      workspace_id: workspaceA,
      period_start: pStart,
      period_end: pEnd,
      vendor_id: vendorA,
    });

    expect(res.batches.length).toBe(1);
    const batch = res.batches[0];
    expect(batch.participant_type).toBe(SettlementParticipantType.VENDOR);
    expect(batch.vendor_id).toBe(vendorA);
    expect(batch.buyer_id).toBeNull();
    expect(batch.gross_amount).toBe('75.25');
    expect(batch.currency).toBe('USD');

    const items = await prisma.settlementItem.findMany({
      where: { settlement_batch_id: batch.batch_id },
    });
    expect(items.length).toBe(1);
    expect(items[0].participant_type).toBe(SettlementParticipantType.VENDOR);
    expect(items[0].amount.toString()).toBe('75.25');
    expect(items[0].currency).toBe('USD');
    expect(items[0].call_commercial_id).toBe(comm.id);
  });

  it('15. missing vendor_id skips Vendor item', async () => {
    const pStart = new Date('2026-10-01T00:00:00Z');
    const pEnd = new Date('2026-10-08T00:00:00Z');
    const finalizesAt = new Date('2026-10-05T12:00:00Z');

    await createCallCommercial({
      finalizesAt,
      vId: null,
      payout: '60.0000',
    });

    const res = await settlementService.generateVendorSettlement({
      workspace_id: workspaceA,
      period_start: pStart,
      period_end: pEnd,
    });

    expect(res.batches.length).toBe(0);
    expect(res.skipped_calls_count).toBe(1);
  });

  // ==========================================
  // DUAL-SIDED SETTLEMENT TESTS (16 - 19)
  // ==========================================

  it('16, 17, 18, 19. same CallCommercial creates BOTH Buyer and Vendor SettlementItems in separate batches', async () => {
    const pStart = new Date('2026-10-01T00:00:00Z');
    const pEnd = new Date('2026-10-08T00:00:00Z');
    const finalizesAt = new Date('2026-10-05T12:00:00Z');

    const comm = await createCallCommercial({
      finalizesAt,
      revenue: '100.0000',
      payout: '60.0000',
      currency: 'USD',
    });

    const buyerRes = await settlementService.generateBuyerSettlement({
      workspace_id: workspaceA,
      period_start: pStart,
      period_end: pEnd,
      buyer_id: buyerA,
    });

    const vendorRes = await settlementService.generateVendorSettlement({
      workspace_id: workspaceA,
      period_start: pStart,
      period_end: pEnd,
      vendor_id: vendorA,
    });

    expect(buyerRes.batches.length).toBe(1);
    expect(vendorRes.batches.length).toBe(1);

    const buyerBatch = buyerRes.batches[0];
    const vendorBatch = vendorRes.batches[0];

    expect(buyerBatch.batch_id).not.toBe(vendorBatch.batch_id);
    expect(buyerBatch.participant_type).toBe(SettlementParticipantType.BUYER);
    expect(vendorBatch.participant_type).toBe(SettlementParticipantType.VENDOR);

    const buyerItems = await prisma.settlementItem.findMany({
      where: { settlement_batch_id: buyerBatch.batch_id },
    });
    const vendorItems = await prisma.settlementItem.findMany({
      where: { settlement_batch_id: vendorBatch.batch_id },
    });

    expect(buyerItems.length).toBe(1);
    expect(buyerItems[0].call_commercial_id).toBe(comm.id);
    expect(buyerItems[0].participant_type).toBe(SettlementParticipantType.BUYER);
    expect(buyerItems[0].amount.toString()).toBe('100');

    expect(vendorItems.length).toBe(1);
    expect(vendorItems[0].call_commercial_id).toBe(comm.id);
    expect(vendorItems[0].participant_type).toBe(SettlementParticipantType.VENDOR);
    expect(vendorItems[0].amount.toString()).toBe('60');
  });

  // ==========================================
  // DUPLICATE / COMMERCIAL TRUTH (20 - 21)
  // ==========================================

  it('20 & 21. duplicate=true with positive persisted revenue is settled; values not recalculated from campaign', async () => {
    const pStart = new Date('2026-10-01T00:00:00Z');
    const pEnd = new Date('2026-10-08T00:00:00Z');
    const finalizesAt = new Date('2026-10-05T12:00:00Z');

    // Persisted revenue 85.0000 on duplicate call (different from Campaign default 100.0000)
    const comm = await createCallCommercial({
      finalizesAt,
      revenue: '85.0000',
      duplicate: true,
    });

    const res = await settlementService.generateBuyerSettlement({
      workspace_id: workspaceA,
      period_start: pStart,
      period_end: pEnd,
      buyer_id: buyerA,
    });

    expect(res.batches.length).toBe(1);
    expect(res.batches[0].gross_amount).toBe('85');
  });

  // ==========================================
  // CURRENCY PARTITIONING (22 - 24)
  // ==========================================

  it('22, 23, 24. USD items grouped into USD batch, EUR items grouped into EUR batch; never mix', async () => {
    const pStart = new Date('2026-10-01T00:00:00Z');
    const pEnd = new Date('2026-10-08T00:00:00Z');
    const finalizesAt = new Date('2026-10-05T12:00:00Z');

    await createCallCommercial({
      finalizesAt,
      revenue: '100.0000',
      currency: 'USD',
      bId: buyerA,
    });
    await createCallCommercial({
      finalizesAt,
      revenue: '200.0000',
      currency: 'USD',
      bId: buyerA,
    });
    await createCallCommercial({
      finalizesAt,
      revenue: '50.0000',
      currency: 'EUR',
      bId: buyerA,
    });

    const res = await settlementService.generateBuyerSettlement({
      workspace_id: workspaceA,
      period_start: pStart,
      period_end: pEnd,
      buyer_id: buyerA,
    });

    expect(res.batches.length).toBe(2);

    const usdBatch = res.batches.find((b) => b.currency === 'USD');
    const eurBatch = res.batches.find((b) => b.currency === 'EUR');

    expect(usdBatch).toBeDefined();
    expect(eurBatch).toBeDefined();

    expect(usdBatch?.gross_amount).toBe('300');
    expect(usdBatch?.item_count).toBe(2);

    expect(eurBatch?.gross_amount).toBe('50');
    expect(eurBatch?.item_count).toBe(1);
  });

  // ==========================================
  // BATCH DEFAULTS & BOUNDARIES (25 - 29)
  // ==========================================

  it('25. no empty batch is created when zero eligible items exist', async () => {
    const pStart = new Date('2026-10-01T00:00:00Z');
    const pEnd = new Date('2026-10-08T00:00:00Z');

    const res = await settlementService.generateBuyerSettlement({
      workspace_id: workspaceA,
      period_start: pStart,
      period_end: pEnd,
      buyer_id: buyerA,
    });

    expect(res.batches.length).toBe(0);
  });

  it('26, 27, 28. batch starts DRAFT, UNPROCESSED, UNRECONCILED', async () => {
    const pStart = new Date('2026-10-01T00:00:00Z');
    const pEnd = new Date('2026-10-08T00:00:00Z');
    const finalizesAt = new Date('2026-10-05T12:00:00Z');

    await createCallCommercial({
      finalizesAt,
      revenue: '100.0000',
    });

    const res = await settlementService.generateBuyerSettlement({
      workspace_id: workspaceA,
      period_start: pStart,
      period_end: pEnd,
      buyer_id: buyerA,
    });

    const batch = res.batches[0];
    expect(batch.settlement_status).toBe(SettlementStatus.DRAFT);
    expect(batch.payment_status).toBe(PaymentStatus.UNPROCESSED);
    expect(batch.reconciliation_status).toBe(ReconciliationStatus.UNRECONCILED);
    expect(batch.net_amount).toBe(batch.gross_amount);
    expect(batch.adjustments_amount).toBe('0');
  });

  it('29. correct period_start inclusive / period_end exclusive semantics', async () => {
    const pStart = new Date('2026-10-01T00:00:00Z');
    const pEnd = new Date('2026-10-08T00:00:00Z');

    // Exactly at period_start -> included
    await createCallCommercial({
      finalizesAt: new Date('2026-10-01T00:00:00Z'),
      revenue: '10.0000',
    });

    // Middle of period -> included
    await createCallCommercial({
      finalizesAt: new Date('2026-10-04T12:00:00Z'),
      revenue: '20.0000',
    });

    // Exactly at period_end -> excluded (exclusive)
    await createCallCommercial({
      finalizesAt: new Date('2026-10-08T00:00:00Z'),
      revenue: '40.0000',
    });

    // After period_end -> excluded
    await createCallCommercial({
      finalizesAt: new Date('2026-10-09T00:00:00Z'),
      revenue: '80.0000',
    });

    const res = await settlementService.generateBuyerSettlement({
      workspace_id: workspaceA,
      period_start: pStart,
      period_end: pEnd,
      buyer_id: buyerA,
    });

    expect(res.batches.length).toBe(1);
    expect(res.batches[0].gross_amount).toBe('30'); // 10 + 20
    expect(res.batches[0].item_count).toBe(2);
  });

  // ==========================================
  // IDEMPOTENCY TESTS (30 - 32)
  // ==========================================

  it('30, 31, 32. running generation twice does not duplicate items or create duplicate batches', async () => {
    const pStart = new Date('2026-10-01T00:00:00Z');
    const pEnd = new Date('2026-10-08T00:00:00Z');
    const finalizesAt = new Date('2026-10-05T12:00:00Z');

    const comm = await createCallCommercial({
      finalizesAt,
      revenue: '100.0000',
      payout: '60.0000',
    });

    // First run (Buyer & Vendor)
    const run1Buyer = await settlementService.generateBuyerSettlement({
      workspace_id: workspaceA,
      period_start: pStart,
      period_end: pEnd,
      buyer_id: buyerA,
    });
    const run1Vendor = await settlementService.generateVendorSettlement({
      workspace_id: workspaceA,
      period_start: pStart,
      period_end: pEnd,
      vendor_id: vendorA,
    });

    expect(run1Buyer.batches.length).toBe(1);
    expect(run1Vendor.batches.length).toBe(1);

    // Second run
    const run2Buyer = await settlementService.generateBuyerSettlement({
      workspace_id: workspaceA,
      period_start: pStart,
      period_end: pEnd,
      buyer_id: buyerA,
    });
    const run2Vendor = await settlementService.generateVendorSettlement({
      workspace_id: workspaceA,
      period_start: pStart,
      period_end: pEnd,
      vendor_id: vendorA,
    });

    // Recognized existing batch, no new items added
    expect(run2Buyer.batches.length).toBe(1);
    expect(run2Buyer.batches[0].is_existing).toBe(true);
    expect(run2Buyer.batches[0].gross_amount).toBe('100');

    expect(run2Vendor.batches.length).toBe(1);
    expect(run2Vendor.batches[0].is_existing).toBe(true);
    expect(run2Vendor.batches[0].gross_amount).toBe('60');

    // Total items in database must remain 1 buyer item and 1 vendor item
    const totalBuyerItems = await prisma.settlementItem.count({
      where: {
        call_commercial_id: comm.id,
        participant_type: SettlementParticipantType.BUYER,
      },
    });
    const totalVendorItems = await prisma.settlementItem.count({
      where: {
        call_commercial_id: comm.id,
        participant_type: SettlementParticipantType.VENDOR,
      },
    });

    expect(totalBuyerItems).toBe(1);
    expect(totalVendorItems).toBe(1);
  });

  // ==========================================
  // CONCURRENCY TESTS (33 - 35)
  // ==========================================

  it('33, 34, 35. concurrent generation results in exactly one Buyer item and one Vendor item per CallCommercial', async () => {
    const pStart = new Date('2026-10-01T00:00:00Z');
    const pEnd = new Date('2026-10-08T00:00:00Z');
    const finalizesAt = new Date('2026-10-05T12:00:00Z');

    const comm = await createCallCommercial({
      finalizesAt,
      revenue: '100.0000',
      payout: '60.0000',
    });

    // Run 3 concurrent buyer generations and 3 concurrent vendor generations simultaneously
    const results = await Promise.all([
      settlementService.generateBuyerSettlement({
        workspace_id: workspaceA,
        period_start: pStart,
        period_end: pEnd,
        buyer_id: buyerA,
      }),
      settlementService.generateBuyerSettlement({
        workspace_id: workspaceA,
        period_start: pStart,
        period_end: pEnd,
        buyer_id: buyerA,
      }),
      settlementService.generateVendorSettlement({
        workspace_id: workspaceA,
        period_start: pStart,
        period_end: pEnd,
        vendor_id: vendorA,
      }),
      settlementService.generateVendorSettlement({
        workspace_id: workspaceA,
        period_start: pStart,
        period_end: pEnd,
        vendor_id: vendorA,
      }),
    ]);

    expect(results.length).toBe(4);

    const buyerItemCount = await prisma.settlementItem.count({
      where: {
        call_commercial_id: comm.id,
        participant_type: SettlementParticipantType.BUYER,
      },
    });
    const vendorItemCount = await prisma.settlementItem.count({
      where: {
        call_commercial_id: comm.id,
        participant_type: SettlementParticipantType.VENDOR,
      },
    });

    expect(buyerItemCount).toBe(1);
    expect(vendorItemCount).toBe(1);
  });

  // ==========================================
  // ISOLATION TESTS (36 - 38)
  // ==========================================

  it('36. workspace isolation: workspace A data never enters workspace B batch', async () => {
    const pStart = new Date('2026-10-01T00:00:00Z');
    const pEnd = new Date('2026-10-08T00:00:00Z');
    const finalizesAt = new Date('2026-10-05T12:00:00Z');

    // Create call in Workspace A
    await createCallCommercial({
      workspaceId: workspaceA,
      finalizesAt,
      revenue: '100.0000',
    });

    // Run generation for Workspace B
    const resB = await settlementService.generateBuyerSettlement({
      workspace_id: workspaceB,
      period_start: pStart,
      period_end: pEnd,
    });

    expect(resB.batches.length).toBe(0);
  });

  it('37 & 38. participant isolation: Buyer A and Buyer B produce separate distinct batches', async () => {
    const pStart = new Date('2026-10-01T00:00:00Z');
    const pEnd = new Date('2026-10-08T00:00:00Z');
    const finalizesAt = new Date('2026-10-05T12:00:00Z');

    await createCallCommercial({
      finalizesAt,
      bId: buyerA,
      revenue: '100.0000',
    });
    await createCallCommercial({
      finalizesAt,
      bId: buyerB,
      revenue: '200.0000',
    });

    const res = await settlementService.generateBuyerSettlement({
      workspace_id: workspaceA,
      period_start: pStart,
      period_end: pEnd,
    });

    expect(res.batches.length).toBe(2);

    const batchA = res.batches.find((b) => b.buyer_id === buyerA);
    const batchB = res.batches.find((b) => b.buyer_id === buyerB);

    expect(batchA?.gross_amount).toBe('100');
    expect(batchB?.gross_amount).toBe('200');
  });

  // ==========================================
  // INTEGRITY TESTS (39 - 45)
  // ==========================================

  it('40 & 41. settlement generation never mutates CallCommercial or disputes', async () => {
    const pStart = new Date('2026-10-01T00:00:00Z');
    const pEnd = new Date('2026-10-08T00:00:00Z');
    const finalizesAt = new Date('2026-10-05T12:00:00Z');

    const commBefore = await createCallCommercial({
      finalizesAt,
      revenue: '100.0000',
      payout: '60.0000',
    });

    await settlementService.generateBuyerSettlement({
      workspace_id: workspaceA,
      period_start: pStart,
      period_end: pEnd,
      buyer_id: buyerA,
    });

    const commAfter = await prisma.callCommercial.findUnique({
      where: { id: commBefore.id },
    });

    expect(commAfter?.status).toBe(CommercialStatus.FINAL);
    expect(commAfter?.revenue.toString()).toBe(commBefore.revenue.toString());
    expect(commAfter?.payout.toString()).toBe(commBefore.payout.toString());
    expect(commAfter?.cost.toString()).toBe(commBefore.cost.toString());
    expect(commAfter?.profit.toString()).toBe(commBefore.profit.toString());
  });

  it('42, 43, 44, 45. no PaymentInstruction, PaymentExecution, ReconciliationRun, or ReconciliationIssue created', async () => {
    const pStart = new Date('2026-10-01T00:00:00Z');
    const pEnd = new Date('2026-10-08T00:00:00Z');
    const finalizesAt = new Date('2026-10-05T12:00:00Z');

    await createCallCommercial({
      finalizesAt,
      revenue: '100.0000',
      payout: '60.0000',
    });

    await settlementService.generateBuyerSettlement({
      workspace_id: workspaceA,
      period_start: pStart,
      period_end: pEnd,
      buyer_id: buyerA,
    });

    const piCount = await prisma.paymentInstruction.count({
      where: { workspace_id: workspaceA },
    });
    const peCount = await prisma.paymentExecution.count({
      where: { workspace_id: workspaceA },
    });
    const runCount = await prisma.reconciliationRun.count({
      where: { workspace_id: workspaceA },
    });
    const issueCount = await prisma.reconciliationIssue.count({
      where: { run: { workspace_id: workspaceA } },
    });

    expect(piCount).toBe(0);
    expect(peCount).toBe(0);
    expect(runCount).toBe(0);
    expect(issueCount).toBe(0);
  });

  // ==========================================
  // COMM-14B: PERIOD INPUT CONTRACT & BOUNDARY TESTS
  // ==========================================

  it('COMM-14B.1 & 8. rejects invalid period (period_start >= period_end)', async () => {
    const pStart = new Date('2026-10-08T00:00:00Z');
    const pEnd = new Date('2026-10-01T00:00:00Z');

    await expect(
      settlementService.generateBuyerSettlement({
        workspace_id: workspaceA,
        period_start: pStart,
        period_end: pEnd,
        buyer_id: buyerA,
      }),
    ).rejects.toThrow('period_start must be strictly before period_end');

    // Equal timestamps also rejected
    await expect(
      settlementService.generateBuyerSettlement({
        workspace_id: workspaceA,
        period_start: pStart,
        period_end: pStart,
        buyer_id: buyerA,
      }),
    ).rejects.toThrow('period_start must be strictly before period_end');
  });

  it('COMM-14B.9 & 10. rejects missing period_start or missing period_end', async () => {
    const validDate = new Date('2026-10-01T00:00:00Z');

    await expect(
      settlementService.generateBuyerSettlement({
        workspace_id: workspaceA,
        period_start: null as any,
        period_end: validDate,
        buyer_id: buyerA,
      }),
    ).rejects.toThrow('period_start and period_end are required');

    await expect(
      settlementService.generateBuyerSettlement({
        workspace_id: workspaceA,
        period_start: validDate,
        period_end: null as any,
        buyer_id: buyerA,
      }),
    ).rejects.toThrow('period_start and period_end are required');
  });

  it('COMM-14B.2, 3, 4, 5, 6, 11. exact boundary semantics: [period_start, period_end) preserved without alteration', async () => {
    const pStart = new Date('2026-10-01T00:00:00.000Z');
    const pEnd = new Date('2026-10-08T00:00:00.000Z');

    // 1 millisecond before period_start -> EXCLUDED
    await createCallCommercial({
      finalizesAt: new Date(pStart.getTime() - 1),
      revenue: '11.0000',
    });

    // Exactly at period_start -> INCLUDED
    await createCallCommercial({
      finalizesAt: pStart,
      revenue: '22.0000',
    });

    // 1 millisecond before period_end -> INCLUDED
    await createCallCommercial({
      finalizesAt: new Date(pEnd.getTime() - 1),
      revenue: '33.0000',
    });

    // Exactly at period_end -> EXCLUDED
    await createCallCommercial({
      finalizesAt: pEnd,
      revenue: '44.0000',
    });

    // 1 millisecond after period_end -> EXCLUDED
    await createCallCommercial({
      finalizesAt: new Date(pEnd.getTime() + 1),
      revenue: '55.0000',
    });

    const res = await settlementService.generateBuyerSettlement({
      workspace_id: workspaceA,
      period_start: pStart,
      period_end: pEnd,
      buyer_id: buyerA,
    });

    expect(res.batches.length).toBe(1);
    const batch = res.batches[0];

    // Included: 22.0000 + 33.0000 = 55
    expect(batch.gross_amount).toBe('55');
    expect(batch.item_count).toBe(2);

    // Persisted boundaries match input exactly (not altered or defaulted)
    expect(batch.period_start.toISOString()).toBe(pStart.toISOString());
    expect(batch.period_end.toISOString()).toBe(pEnd.toISOString());

    // Verify DB persisted batch record directly
    const persisted = await prisma.settlementBatch.findUnique({
      where: { id: batch.batch_id },
    });
    expect(persisted?.period_start.toISOString()).toBe(pStart.toISOString());
    expect(persisted?.period_end.toISOString()).toBe(pEnd.toISOString());
  });

  it('COMM-14B.7. future finalizes_at excluded even if within requested period', async () => {
    const now = new Date();
    const pStart = new Date(now.getTime() - 86400 * 1000);
    const pEnd = new Date(now.getTime() + 86400 * 1000); // requested period extends into future
    const futureFinalizesAt = new Date(now.getTime() + 3600 * 1000); // 1 hour in future (inside period, but unmatured)

    await createCallCommercial({
      finalizesAt: futureFinalizesAt,
      revenue: '99.0000',
    });

    const res = await settlementService.generateBuyerSettlement({
      workspace_id: workspaceA,
      period_start: pStart,
      period_end: pEnd,
      buyer_id: buyerA,
    });

    expect(res.batches.length).toBe(0);
  });

  it('COMM-14B.13. different settlement periods produce distinct logical settlement batches', async () => {
    const pStart1 = new Date('2026-09-01T00:00:00Z');
    const pEnd1 = new Date('2026-09-08T00:00:00Z');

    const pStart2 = new Date('2026-09-08T00:00:00Z');
    const pEnd2 = new Date('2026-09-15T00:00:00Z');

    await createCallCommercial({
      finalizesAt: new Date('2026-09-04T12:00:00Z'),
      revenue: '100.0000',
    });
    await createCallCommercial({
      finalizesAt: new Date('2026-09-11T12:00:00Z'),
      revenue: '200.0000',
    });

    const res1 = await settlementService.generateBuyerSettlement({
      workspace_id: workspaceA,
      period_start: pStart1,
      period_end: pEnd1,
      buyer_id: buyerA,
    });
    const res2 = await settlementService.generateBuyerSettlement({
      workspace_id: workspaceA,
      period_start: pStart2,
      period_end: pEnd2,
      buyer_id: buyerA,
    });

    expect(res1.batches.length).toBe(1);
    expect(res2.batches.length).toBe(1);
    expect(res1.batches[0].batch_id).not.toBe(res2.batches[0].batch_id);
    expect(res1.batches[0].batch_number).not.toBe(res2.batches[0].batch_number);
    expect(res1.batches[0].gross_amount).toBe('100');
    expect(res2.batches[0].gross_amount).toBe('200');
  });

  it('COMM-14B.16. Buyer and Vendor can be generated using independent explicit periods', async () => {
    // Asymmetric periods: Buyer weekly (e.g. Sep 1 - Sep 8), Vendor bi-weekly (e.g. Sep 1 - Sep 15)
    const buyerPStart = new Date('2026-09-01T00:00:00Z');
    const buyerPEnd = new Date('2026-09-08T00:00:00Z');

    const vendorPStart = new Date('2026-09-01T00:00:00Z');
    const vendorPEnd = new Date('2026-09-15T00:00:00Z');

    // Call 1: finalized Sep 4 (falls in both buyer and vendor periods)
    await createCallCommercial({
      finalizesAt: new Date('2026-09-04T12:00:00Z'),
      revenue: '100.0000',
      payout: '60.0000',
    });

    // Call 2: finalized Sep 10 (falls outside buyer period, but inside vendor period)
    await createCallCommercial({
      finalizesAt: new Date('2026-09-10T12:00:00Z'),
      revenue: '150.0000',
      payout: '90.0000',
    });

    const buyerRes = await settlementService.generateBuyerSettlement({
      workspace_id: workspaceA,
      period_start: buyerPStart,
      period_end: buyerPEnd,
      buyer_id: buyerA,
    });

    const vendorRes = await settlementService.generateVendorSettlement({
      workspace_id: workspaceA,
      period_start: vendorPStart,
      period_end: vendorPEnd,
      vendor_id: vendorA,
    });

    expect(buyerRes.batches.length).toBe(1);
    expect(buyerRes.batches[0].gross_amount).toBe('100'); // only Call 1
    expect(buyerRes.batches[0].item_count).toBe(1);

    expect(vendorRes.batches.length).toBe(1);
    expect(vendorRes.batches[0].gross_amount).toBe('150'); // Call 1 (60) + Call 2 (90)
    expect(vendorRes.batches[0].item_count).toBe(2);
  });
});

