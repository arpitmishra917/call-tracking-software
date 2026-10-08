import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  SettlementParticipantType,
  SettlementStatus,
  PaymentStatus,
  PaymentDirection,
  AdjustmentDirection,
  AdjustmentStatus,
  InstructionStatus,
  ExecutionStatus,
  ReconciliationStatus,
  ReconciliationRunType,
  ReconciliationIssueType,
  Prisma,
} from '@prisma/client';

describe('COMM-13 Settlement Schema Implementation E2E', () => {
  const uniqueId = (base: string) => `${base}_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  let app: INestApplication;
  let prisma: PrismaService;

  let workspaceId: string;
  let buyerId: string;
  let vendorId: string;
  let campaignId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get<PrismaService>(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    const url = process.env.DATABASE_URL || '';
    if (!url.includes('_test')) {
      throw new Error('Safety check failed: E2E tests must use the test database');
    }

    const ws = await prisma.workspace.create({
      data: { name: 'Settlement Test WS', slug: uniqueId('settlement-ws') },
    });
    workspaceId = ws.id;

    const b = await prisma.buyer.create({
      data: {
        workspace_id: workspaceId,
        name: 'Buyer Alpha',
        destination_number: '+12025550101',
      },
    });
    buyerId = b.id;

    const v = await prisma.vendor.create({
      data: {
        workspace_id: workspaceId,
        name: 'Vendor One',
      },
    });
    vendorId = v.id;

    const camp = await prisma.campaign.create({
      data: {
        workspace_id: workspaceId,
        name: 'Campaign 1',
        default_revenue_amount: new Prisma.Decimal('100.0000'),
        default_payout_amount: new Prisma.Decimal('60.0000'),
        currency: 'USD',
      },
    });
    campaignId = camp.id;
  });

  // Helper to create CallCommercial
  async function createCallCommercial(options?: {
    revenue?: string;
    payout?: string;
    cost?: string;
    profit?: string;
    currency?: string;
    bId?: string;
    vId?: string;
  }) {
    const call = await prisma.call.create({
      data: {
        workspace_id: workspaceId,
        campaign_id: campaignId,
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
        workspace_id: workspaceId,
        call_id: call.id,
        campaign_id: campaignId,
        buyer_id: options?.bId ?? buyerId,
        vendor_id: options?.vId ?? vendorId,
        qualified: true,
        converted: true,
        currency: options?.currency ?? 'USD',
        revenue: new Prisma.Decimal(options?.revenue ?? '100.0000'),
        payout: new Prisma.Decimal(options?.payout ?? '60.0000'),
        cost: new Prisma.Decimal(options?.cost ?? '5.0000'),
        profit: new Prisma.Decimal(options?.profit ?? '35.0000'),
        status: 'FINAL',
      },
    });
  }

  it('1. should create a valid Buyer SettlementBatch with correct defaults and relations', async () => {
    const batch = await prisma.settlementBatch.create({
      data: {
        workspace_id: workspaceId,
        batch_number: uniqueId('SB-BUYER'),
        participant_type: SettlementParticipantType.BUYER,
        buyer_id: buyerId,
        currency: 'USD',
        period_start: new Date('2026-10-01T00:00:00Z'),
        period_end: new Date('2026-10-07T23:59:59Z'),
        created_by_user_id: uniqueId('user'),
      },
    });

    expect(batch.id).toBeDefined();
    expect(batch.participant_type).toBe(SettlementParticipantType.BUYER);
    expect(batch.buyer_id).toBe(buyerId);
    expect(batch.vendor_id).toBeNull();
    expect(batch.settlement_status).toBe(SettlementStatus.DRAFT);
    expect(batch.payment_status).toBe(PaymentStatus.UNPROCESSED);
    expect(batch.reconciliation_status).toBe(ReconciliationStatus.UNRECONCILED);
    expect(batch.gross_amount.toString()).toBe('0');
    expect(batch.adjustments_amount.toString()).toBe('0');
    expect(batch.net_amount.toString()).toBe('0');
    expect(batch.item_count).toBe(0);
  });

  it('2. should create a valid Vendor SettlementBatch with correct defaults and relations', async () => {
    const batch = await prisma.settlementBatch.create({
      data: {
        workspace_id: workspaceId,
        batch_number: uniqueId('SB-VENDOR'),
        participant_type: SettlementParticipantType.VENDOR,
        vendor_id: vendorId,
        currency: 'USD',
        period_start: new Date('2026-10-01T00:00:00Z'),
        period_end: new Date('2026-10-07T23:59:59Z'),
        created_by_user_id: uniqueId('user'),
      },
    });

    expect(batch.id).toBeDefined();
    expect(batch.participant_type).toBe(SettlementParticipantType.VENDOR);
    expect(batch.vendor_id).toBe(vendorId);
    expect(batch.buyer_id).toBeNull();
  });

  it('3. should enforce mutual exclusivity CHECK constraint on participant_type and participant IDs', async () => {
    // Both buyer_id and vendor_id provided
    await expect(
      prisma.settlementBatch.create({
        data: {
          workspace_id: workspaceId,
          batch_number: uniqueId('SB-ERR-1'),
          participant_type: SettlementParticipantType.BUYER,
          buyer_id: buyerId,
          vendor_id: vendorId,
          currency: 'USD',
          period_start: new Date(),
          period_end: new Date(),
          created_by_user_id: uniqueId('user'),
        },
      }),
    ).rejects.toThrow();

    // BUYER type with neither ID provided
    await expect(
      prisma.settlementBatch.create({
        data: {
          workspace_id: workspaceId,
          batch_number: uniqueId('SB-ERR-2'),
          participant_type: SettlementParticipantType.BUYER,
          currency: 'USD',
          period_start: new Date(),
          period_end: new Date(),
          created_by_user_id: uniqueId('user'),
        },
      }),
    ).rejects.toThrow();

    // VENDOR type with buyer_id provided instead
    await expect(
      prisma.settlementBatch.create({
        data: {
          workspace_id: workspaceId,
          batch_number: uniqueId('SB-ERR-3'),
          participant_type: SettlementParticipantType.VENDOR,
          buyer_id: buyerId,
          currency: 'USD',
          period_start: new Date(),
          period_end: new Date(),
          created_by_user_id: uniqueId('user'),
        },
      }),
    ).rejects.toThrow();
  });

  it('4. should enforce unique batch_number per workspace', async () => {
    const batchNumber = uniqueId('BATCH-DUP');
    await prisma.settlementBatch.create({
      data: {
        workspace_id: workspaceId,
        batch_number: batchNumber,
        participant_type: SettlementParticipantType.BUYER,
        buyer_id: buyerId,
        currency: 'USD',
        period_start: new Date(),
        period_end: new Date(),
        created_by_user_id: uniqueId('user'),
      },
    });

    await expect(
      prisma.settlementBatch.create({
        data: {
          workspace_id: workspaceId,
          batch_number: batchNumber,
          participant_type: SettlementParticipantType.BUYER,
          buyer_id: buyerId,
          currency: 'USD',
          period_start: new Date(),
          period_end: new Date(),
          created_by_user_id: uniqueId('user'),
        },
      }),
    ).rejects.toThrow();
  });

  it('5. should link SettlementItem to CallCommercial and SettlementBatch with exact Decimal precision and participant_type', async () => {
    const comm = await createCallCommercial({ revenue: '150.2550' });
    const batch = await prisma.settlementBatch.create({
      data: {
        workspace_id: workspaceId,
        batch_number: uniqueId('SB-ITEM'),
        participant_type: SettlementParticipantType.BUYER,
        buyer_id: buyerId,
        currency: 'USD',
        period_start: new Date(),
        period_end: new Date(),
        created_by_user_id: uniqueId('user'),
      },
    });

    const item = await prisma.settlementItem.create({
      data: {
        workspace_id: workspaceId,
        settlement_batch_id: batch.id,
        call_commercial_id: comm.id,
        participant_type: SettlementParticipantType.BUYER,
        amount: new Prisma.Decimal('150.2550'),
        currency: 'USD',
      },
    });

    expect(item.id).toBeDefined();
    expect(item.participant_type).toBe(SettlementParticipantType.BUYER);
    expect(item.amount.toString()).toBe('150.255');
    expect(item.currency).toBe('USD');

    const retrieved = await prisma.settlementItem.findUnique({
      where: { id: item.id },
      include: { batch: true, commercial: true },
    });
    expect(retrieved?.batch.id).toBe(batch.id);
    expect(retrieved?.commercial.id).toBe(comm.id);
  });

  it('6. should enforce INV-1 uniqueness: a CallCommercial can belong to at most one SettlementItem per participant_type', async () => {
    const comm = await createCallCommercial({ revenue: '100.0000', payout: '60.0000' });
    const buyerBatch1 = await prisma.settlementBatch.create({
      data: {
        workspace_id: workspaceId,
        batch_number: uniqueId('SB-B1'),
        participant_type: SettlementParticipantType.BUYER,
        buyer_id: buyerId,
        currency: 'USD',
        period_start: new Date(),
        period_end: new Date(),
        created_by_user_id: uniqueId('user'),
      },
    });
    const buyerBatch2 = await prisma.settlementBatch.create({
      data: {
        workspace_id: workspaceId,
        batch_number: uniqueId('SB-B2'),
        participant_type: SettlementParticipantType.BUYER,
        buyer_id: buyerId,
        currency: 'USD',
        period_start: new Date(),
        period_end: new Date(),
        created_by_user_id: uniqueId('user'),
      },
    });
    const vendorBatch1 = await prisma.settlementBatch.create({
      data: {
        workspace_id: workspaceId,
        batch_number: uniqueId('SB-V1'),
        participant_type: SettlementParticipantType.VENDOR,
        vendor_id: vendorId,
        currency: 'USD',
        period_start: new Date(),
        period_end: new Date(),
        created_by_user_id: uniqueId('user'),
      },
    });
    const vendorBatch2 = await prisma.settlementBatch.create({
      data: {
        workspace_id: workspaceId,
        batch_number: uniqueId('SB-V2'),
        participant_type: SettlementParticipantType.VENDOR,
        vendor_id: vendorId,
        currency: 'USD',
        period_start: new Date(),
        period_end: new Date(),
        created_by_user_id: uniqueId('user'),
      },
    });

    // 1. One BUYER SettlementItem for CallCommercial -> PASS
    const buyerItem1 = await prisma.settlementItem.create({
      data: {
        workspace_id: workspaceId,
        settlement_batch_id: buyerBatch1.id,
        call_commercial_id: comm.id,
        participant_type: SettlementParticipantType.BUYER,
        amount: new Prisma.Decimal('100.0000'),
        currency: 'USD',
      },
    });
    expect(buyerItem1.id).toBeDefined();

    // 2. One VENDOR SettlementItem for SAME CallCommercial -> PASS (Two-sided settlement)
    const vendorItem1 = await prisma.settlementItem.create({
      data: {
        workspace_id: workspaceId,
        settlement_batch_id: vendorBatch1.id,
        call_commercial_id: comm.id,
        participant_type: SettlementParticipantType.VENDOR,
        amount: new Prisma.Decimal('60.0000'),
        currency: 'USD',
      },
    });
    expect(vendorItem1.id).toBeDefined();

    // 3. Second BUYER SettlementItem for SAME CallCommercial -> REJECT
    await expect(
      prisma.settlementItem.create({
        data: {
          workspace_id: workspaceId,
          settlement_batch_id: buyerBatch2.id,
          call_commercial_id: comm.id,
          participant_type: SettlementParticipantType.BUYER,
          amount: new Prisma.Decimal('100.0000'),
          currency: 'USD',
        },
      }),
    ).rejects.toThrow();

    // 4. Second VENDOR SettlementItem for SAME CallCommercial -> REJECT
    await expect(
      prisma.settlementItem.create({
        data: {
          workspace_id: workspaceId,
          settlement_batch_id: vendorBatch2.id,
          call_commercial_id: comm.id,
          participant_type: SettlementParticipantType.VENDOR,
          amount: new Prisma.Decimal('60.0000'),
          currency: 'USD',
        },
      }),
    ).rejects.toThrow();

    // 5. Different CallCommercial with BUYER and VENDOR -> PASS
    const comm2 = await createCallCommercial({ revenue: '200.0000', payout: '120.0000' });
    const diffBuyerItem = await prisma.settlementItem.create({
      data: {
        workspace_id: workspaceId,
        settlement_batch_id: buyerBatch1.id,
        call_commercial_id: comm2.id,
        participant_type: SettlementParticipantType.BUYER,
        amount: new Prisma.Decimal('200.0000'),
        currency: 'USD',
      },
    });
    expect(diffBuyerItem.id).toBeDefined();

    const diffVendorItem = await prisma.settlementItem.create({
      data: {
        workspace_id: workspaceId,
        settlement_batch_id: vendorBatch1.id,
        call_commercial_id: comm2.id,
        participant_type: SettlementParticipantType.VENDOR,
        amount: new Prisma.Decimal('120.0000'),
        currency: 'USD',
      },
    });
    expect(diffVendorItem.id).toBeDefined();
  });

  it('7. should enforce onDelete: Restrict on CallCommercial when referenced by SettlementItem', async () => {
    const comm = await createCallCommercial();
    const batch = await prisma.settlementBatch.create({
      data: {
        workspace_id: workspaceId,
        batch_number: uniqueId('SB-RESTRICT-COMM'),
        participant_type: SettlementParticipantType.BUYER,
        buyer_id: buyerId,
        currency: 'USD',
        period_start: new Date(),
        period_end: new Date(),
        created_by_user_id: uniqueId('user'),
      },
    });

    await prisma.settlementItem.create({
      data: {
        workspace_id: workspaceId,
        settlement_batch_id: batch.id,
        call_commercial_id: comm.id,
        participant_type: SettlementParticipantType.BUYER,
        amount: new Prisma.Decimal('100.0000'),
        currency: 'USD',
      },
    });

    // Deleting CallCommercial must fail due to Restrict foreign key
    await expect(
      prisma.callCommercial.delete({
        where: { id: comm.id },
      }),
    ).rejects.toThrow();
  });

  it('8. should enforce onDelete: Restrict on SettlementBatch when referenced by SettlementItem', async () => {
    const comm = await createCallCommercial();
    const batch = await prisma.settlementBatch.create({
      data: {
        workspace_id: workspaceId,
        batch_number: uniqueId('SB-RESTRICT-BATCH'),
        participant_type: SettlementParticipantType.BUYER,
        buyer_id: buyerId,
        currency: 'USD',
        period_start: new Date(),
        period_end: new Date(),
        created_by_user_id: uniqueId('user'),
      },
    });

    await prisma.settlementItem.create({
      data: {
        workspace_id: workspaceId,
        settlement_batch_id: batch.id,
        call_commercial_id: comm.id,
        participant_type: SettlementParticipantType.BUYER,
        amount: new Prisma.Decimal('100.0000'),
        currency: 'USD',
      },
    });

    // Deleting SettlementBatch must fail due to Restrict foreign key
    await expect(
      prisma.settlementBatch.delete({
        where: { id: batch.id },
      }),
    ).rejects.toThrow();
  });

  it('9. should create SettlementAdjustment linked to CallFinancialAdjustment and enforce 1:1 uniqueness', async () => {
    const comm = await createCallCommercial();
    const dispute = await prisma.callDispute.create({
      data: {
        workspace_id: workspaceId,
        call_commercial_id: comm.id,
        buyer_id: buyerId,
        reason: 'Poor quality audio',
        status: 'ACCEPTED',
        created_by_user_id: uniqueId('user'),
      },
    });

    const cfa = await prisma.callFinancialAdjustment.create({
      data: {
        workspace_id: workspaceId,
        call_commercial_id: comm.id,
        dispute_id: dispute.id,
        original_revenue: new Prisma.Decimal('100.0000'),
        original_payout: new Prisma.Decimal('60.0000'),
        adjusted_revenue: new Prisma.Decimal('0.0000'),
        adjusted_payout: new Prisma.Decimal('0.0000'),
        reason: 'Full dispute reversal',
      },
    });

    const sourceBatch = await prisma.settlementBatch.create({
      data: {
        workspace_id: workspaceId,
        batch_number: uniqueId('SB-SRC'),
        participant_type: SettlementParticipantType.BUYER,
        buyer_id: buyerId,
        currency: 'USD',
        period_start: new Date(),
        period_end: new Date(),
        created_by_user_id: uniqueId('user'),
      },
    });

    const adj = await prisma.settlementAdjustment.create({
      data: {
        workspace_id: workspaceId,
        call_financial_adjustment_id: cfa.id,
        source_call_commercial_id: comm.id,
        source_settlement_batch_id: sourceBatch.id,
        participant_type: SettlementParticipantType.BUYER,
        buyer_id: buyerId,
        direction: AdjustmentDirection.CREDIT,
        amount: new Prisma.Decimal('100.0000'),
        currency: 'USD',
        reason: 'Buyer dispute refund credit',
        status: AdjustmentStatus.PENDING,
      },
    });

    expect(adj.id).toBeDefined();
    expect(adj.direction).toBe(AdjustmentDirection.CREDIT);
    expect(adj.status).toBe(AdjustmentStatus.PENDING);

    // Duplicate reference to same call_financial_adjustment_id must fail
    await expect(
      prisma.settlementAdjustment.create({
        data: {
          workspace_id: workspaceId,
          call_financial_adjustment_id: cfa.id,
          source_call_commercial_id: comm.id,
          source_settlement_batch_id: sourceBatch.id,
          participant_type: SettlementParticipantType.BUYER,
          buyer_id: buyerId,
          direction: AdjustmentDirection.CREDIT,
          amount: new Prisma.Decimal('100.0000'),
          currency: 'USD',
          reason: 'Duplicate adjustment attempt',
        },
      }),
    ).rejects.toThrow();
  });

  it('10. should create PaymentInstruction with unique idempotency_key and batch_id', async () => {
    const batch = await prisma.settlementBatch.create({
      data: {
        workspace_id: workspaceId,
        batch_number: uniqueId('SB-PI'),
        participant_type: SettlementParticipantType.BUYER,
        buyer_id: buyerId,
        currency: 'USD',
        period_start: new Date(),
        period_end: new Date(),
        created_by_user_id: uniqueId('user'),
      },
    });

    const idempotencyKey = uniqueId('ik-pi-1');
    const pi = await prisma.paymentInstruction.create({
      data: {
        workspace_id: workspaceId,
        settlement_batch_id: batch.id,
        direction: PaymentDirection.COLLECTION,
        participant_type: SettlementParticipantType.BUYER,
        buyer_id: buyerId,
        amount: new Prisma.Decimal('500.0000'),
        currency: 'USD',
        idempotency_key: idempotencyKey,
        status: InstructionStatus.CREATED,
      },
    });

    expect(pi.id).toBeDefined();
    expect(pi.status).toBe(InstructionStatus.CREATED);

    // Duplicate settlement_batch_id on PaymentInstruction must fail
    await expect(
      prisma.paymentInstruction.create({
        data: {
          workspace_id: workspaceId,
          settlement_batch_id: batch.id,
          direction: PaymentDirection.COLLECTION,
          participant_type: SettlementParticipantType.BUYER,
          buyer_id: buyerId,
          amount: new Prisma.Decimal('500.0000'),
          currency: 'USD',
          idempotency_key: uniqueId('ik-pi-2'),
        },
      }),
    ).rejects.toThrow();

    // Duplicate idempotency_key must fail
    const anotherBatch = await prisma.settlementBatch.create({
      data: {
        workspace_id: workspaceId,
        batch_number: uniqueId('SB-PI-2'),
        participant_type: SettlementParticipantType.BUYER,
        buyer_id: buyerId,
        currency: 'USD',
        period_start: new Date(),
        period_end: new Date(),
        created_by_user_id: uniqueId('user'),
      },
    });

    await expect(
      prisma.paymentInstruction.create({
        data: {
          workspace_id: workspaceId,
          settlement_batch_id: anotherBatch.id,
          direction: PaymentDirection.COLLECTION,
          participant_type: SettlementParticipantType.BUYER,
          buyer_id: buyerId,
          amount: new Prisma.Decimal('500.0000'),
          currency: 'USD',
          idempotency_key: idempotencyKey,
        },
      }),
    ).rejects.toThrow();
  });

  it('11. should record PaymentExecution attempts with attempt sequencing and uniqueness', async () => {
    const batch = await prisma.settlementBatch.create({
      data: {
        workspace_id: workspaceId,
        batch_number: uniqueId('SB-PE'),
        participant_type: SettlementParticipantType.BUYER,
        buyer_id: buyerId,
        currency: 'USD',
        period_start: new Date(),
        period_end: new Date(),
        created_by_user_id: uniqueId('user'),
      },
    });

    const pi = await prisma.paymentInstruction.create({
      data: {
        workspace_id: workspaceId,
        settlement_batch_id: batch.id,
        direction: PaymentDirection.COLLECTION,
        participant_type: SettlementParticipantType.BUYER,
        buyer_id: buyerId,
        amount: new Prisma.Decimal('500.0000'),
        currency: 'USD',
        idempotency_key: uniqueId('ik-pi-exec'),
      },
    });

    const pe1 = await prisma.paymentExecution.create({
      data: {
        workspace_id: workspaceId,
        payment_instruction_id: pi.id,
        attempt_number: 1,
        provider: 'stripe',
        idempotency_key: uniqueId('ik-pe-1'),
        amount: new Prisma.Decimal('500.0000'),
        currency: 'USD',
        status: ExecutionStatus.FAILED,
        failure_code: 'card_declined',
        failure_reason: 'Insufficient funds',
      },
    });

    expect(pe1.id).toBeDefined();
    expect(pe1.attempt_number).toBe(1);
    expect(pe1.status).toBe(ExecutionStatus.FAILED);

    const pe2 = await prisma.paymentExecution.create({
      data: {
        workspace_id: workspaceId,
        payment_instruction_id: pi.id,
        attempt_number: 2,
        provider: 'stripe',
        idempotency_key: uniqueId('ik-pe-2'),
        amount: new Prisma.Decimal('500.0000'),
        currency: 'USD',
        status: ExecutionStatus.SUCCEEDED,
      },
    });

    expect(pe2.id).toBeDefined();
    expect(pe2.attempt_number).toBe(2);
    expect(pe2.status).toBe(ExecutionStatus.SUCCEEDED);

    // Duplicate [payment_instruction_id, attempt_number] must fail
    await expect(
      prisma.paymentExecution.create({
        data: {
          workspace_id: workspaceId,
          payment_instruction_id: pi.id,
          attempt_number: 1,
          provider: 'stripe',
          idempotency_key: uniqueId('ik-pe-dup'),
          amount: new Prisma.Decimal('500.0000'),
          currency: 'USD',
        },
      }),
    ).rejects.toThrow();
  });

  it('12. should enforce onDelete: Restrict on PaymentInstruction when referenced by PaymentExecution', async () => {
    const batch = await prisma.settlementBatch.create({
      data: {
        workspace_id: workspaceId,
        batch_number: uniqueId('SB-RESTRICT-PI'),
        participant_type: SettlementParticipantType.BUYER,
        buyer_id: buyerId,
        currency: 'USD',
        period_start: new Date(),
        period_end: new Date(),
        created_by_user_id: uniqueId('user'),
      },
    });

    const pi = await prisma.paymentInstruction.create({
      data: {
        workspace_id: workspaceId,
        settlement_batch_id: batch.id,
        direction: PaymentDirection.COLLECTION,
        participant_type: SettlementParticipantType.BUYER,
        buyer_id: buyerId,
        amount: new Prisma.Decimal('500.0000'),
        currency: 'USD',
        idempotency_key: uniqueId('ik-pi-restrict'),
      },
    });

    await prisma.paymentExecution.create({
      data: {
        workspace_id: workspaceId,
        payment_instruction_id: pi.id,
        attempt_number: 1,
        provider: 'stripe',
        idempotency_key: uniqueId('ik-pe-restrict'),
        amount: new Prisma.Decimal('500.0000'),
        currency: 'USD',
      },
    });

    // Deleting PaymentInstruction must fail due to Restrict
    await expect(
      prisma.paymentInstruction.delete({
        where: { id: pi.id },
      }),
    ).rejects.toThrow();
  });

  it('13. should create ReconciliationRun and ReconciliationIssue records', async () => {
    const batch = await prisma.settlementBatch.create({
      data: {
        workspace_id: workspaceId,
        batch_number: uniqueId('SB-REC'),
        participant_type: SettlementParticipantType.BUYER,
        buyer_id: buyerId,
        currency: 'USD',
        period_start: new Date(),
        period_end: new Date(),
        created_by_user_id: uniqueId('user'),
      },
    });

    const recRun = await prisma.reconciliationRun.create({
      data: {
        workspace_id: workspaceId,
        settlement_batch_id: batch.id,
        run_type: ReconciliationRunType.BATCH_LEVEL,
        status: ReconciliationStatus.DISCREPANCY,
        items_checked: 10,
        discrepancy_count: 1,
      },
    });

    expect(recRun.id).toBeDefined();
    expect(recRun.status).toBe(ReconciliationStatus.DISCREPANCY);

    const issue = await prisma.reconciliationIssue.create({
      data: {
        reconciliation_run_id: recRun.id,
        issue_type: ReconciliationIssueType.SUM_MISMATCH,
        description: 'Batch gross_amount does not match line item total',
        expected_amount: new Prisma.Decimal('1000.0000'),
        actual_amount: new Prisma.Decimal('900.0000'),
      },
    });

    expect(issue.id).toBeDefined();
    expect(issue.issue_type).toBe(ReconciliationIssueType.SUM_MISMATCH);
    expect(issue.expected_amount?.toString()).toBe('1000');
    expect(issue.actual_amount?.toString()).toBe('900');
  });

  it('14. should enforce onDelete: Restrict on Buyer and Vendor when referenced by SettlementBatch', async () => {
    await prisma.settlementBatch.create({
      data: {
        workspace_id: workspaceId,
        batch_number: uniqueId('SB-RESTRICT-BV-BUYER'),
        participant_type: SettlementParticipantType.BUYER,
        buyer_id: buyerId,
        currency: 'USD',
        period_start: new Date(),
        period_end: new Date(),
        created_by_user_id: uniqueId('user'),
      },
    });

    await prisma.settlementBatch.create({
      data: {
        workspace_id: workspaceId,
        batch_number: uniqueId('SB-RESTRICT-BV-VENDOR'),
        participant_type: SettlementParticipantType.VENDOR,
        vendor_id: vendorId,
        currency: 'USD',
        period_start: new Date(),
        period_end: new Date(),
        created_by_user_id: uniqueId('user'),
      },
    });

    // Deleting Buyer or Vendor must fail due to Restrict
    await expect(
      prisma.buyer.delete({
        where: { id: buyerId },
      }),
    ).rejects.toThrow();

    await expect(
      prisma.vendor.delete({
        where: { id: vendorId },
      }),
    ).rejects.toThrow();
  });

  it('15. should cascade delete all settlement records on Workspace deletion', async () => {
    // Create an isolated workspace with complete settlement chain
    const isoWs = await prisma.workspace.create({
      data: { name: 'Cascade WS', slug: uniqueId('cascade-ws') },
    });
    const isoBuyer = await prisma.buyer.create({
      data: {
        workspace_id: isoWs.id,
        name: 'Cascade Buyer',
        destination_number: '+12025550999',
      },
    });
    const isoBatch = await prisma.settlementBatch.create({
      data: {
        workspace_id: isoWs.id,
        batch_number: uniqueId('SB-CASCADE'),
        participant_type: SettlementParticipantType.BUYER,
        buyer_id: isoBuyer.id,
        currency: 'USD',
        period_start: new Date(),
        period_end: new Date(),
        created_by_user_id: uniqueId('user'),
      },
    });
    const isoPi = await prisma.paymentInstruction.create({
      data: {
        workspace_id: isoWs.id,
        settlement_batch_id: isoBatch.id,
        direction: PaymentDirection.COLLECTION,
        participant_type: SettlementParticipantType.BUYER,
        buyer_id: isoBuyer.id,
        amount: new Prisma.Decimal('100.0000'),
        currency: 'USD',
        idempotency_key: uniqueId('ik-cascade-pi'),
      },
    });
    await prisma.paymentExecution.create({
      data: {
        workspace_id: isoWs.id,
        payment_instruction_id: isoPi.id,
        attempt_number: 1,
        provider: 'stripe',
        idempotency_key: uniqueId('ik-cascade-pe'),
        amount: new Prisma.Decimal('100.0000'),
        currency: 'USD',
      },
    });
    const isoRec = await prisma.reconciliationRun.create({
      data: {
        workspace_id: isoWs.id,
        settlement_batch_id: isoBatch.id,
        status: ReconciliationStatus.BALANCED,
      },
    });
    await prisma.reconciliationIssue.create({
      data: {
        reconciliation_run_id: isoRec.id,
        issue_type: ReconciliationIssueType.DUPLICATE_CALL,
        description: 'Test issue',
      },
    });

    // Delete workspace
    await prisma.workspace.delete({
      where: { id: isoWs.id },
    });

    // Verify all cascading records are deleted
    const batches = await prisma.settlementBatch.findMany({ where: { workspace_id: isoWs.id } });
    const pis = await prisma.paymentInstruction.findMany({ where: { workspace_id: isoWs.id } });
    const pes = await prisma.paymentExecution.findMany({ where: { workspace_id: isoWs.id } });
    const recs = await prisma.reconciliationRun.findMany({ where: { workspace_id: isoWs.id } });

    expect(batches.length).toBe(0);
    expect(pis.length).toBe(0);
    expect(pes.length).toBe(0);
    expect(recs.length).toBe(0);
  });
});
