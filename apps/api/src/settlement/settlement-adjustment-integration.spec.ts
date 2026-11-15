import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { SettlementBatchService } from './settlement-batch.service.js';
import { ReconciliationService } from './reconciliation.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  SettlementParticipantType,
  SettlementStatus,
  PaymentStatus,
  ReconciliationStatus,
  CommercialStatus,
  AdjustmentDirection,
  AdjustmentStatus,
  Prisma,
} from '@prisma/client';

describe('SettlementAdjustment Forward Offsets & Reconciliation (Agent 2 Integrity Suite)', () => {
  let settlementService: SettlementBatchService;
  let reconciliationService: ReconciliationService;
  let prisma: any;

  const mockDate = new Date('2026-10-15T12:00:00.000Z');
  const periodStart = new Date('2026-10-01T00:00:00.000Z');
  const periodEnd = new Date('2026-10-08T00:00:00.000Z');

  const getBaseBatch = () => ({
    id: 'batch-target-1',
    workspace_id: 'ws-1',
    batch_number: 'SB-BUYER-buyer-1-USD-20261001-20261008',
    participant_type: SettlementParticipantType.BUYER,
    buyer_id: 'buyer-1',
    vendor_id: null,
    currency: 'USD',
    period_start: periodStart,
    period_end: periodEnd,
    gross_amount: new Prisma.Decimal('100.0000'),
    adjustments_amount: new Prisma.Decimal('-50.0000'),
    net_amount: new Prisma.Decimal('50.0000'),
    item_count: 1,
    settlement_status: SettlementStatus.DRAFT,
    payment_status: PaymentStatus.UNPROCESSED,
    reconciliation_status: ReconciliationStatus.UNRECONCILED,
    created_by_user_id: 'admin-1',
    items: [
      {
        id: 'item-1',
        workspace_id: 'ws-1',
        settlement_batch_id: 'batch-target-1',
        call_commercial_id: 'comm-new-1',
        participant_type: SettlementParticipantType.BUYER,
        amount: new Prisma.Decimal('100.0000'),
        currency: 'USD',
      },
    ],
    adjustments: [
      {
        id: 'adj-1',
        workspace_id: 'ws-1',
        target_settlement_batch_id: 'batch-target-1',
        direction: AdjustmentDirection.CREDIT,
        amount: new Prisma.Decimal('50.0000'),
        currency: 'USD',
        status: AdjustmentStatus.APPLIED,
      },
    ],
  });

  beforeEach(async () => {
    prisma = {
      $transaction: vi.fn(async (cb) => cb(prisma)),
      workspace: {
        findUnique: vi.fn().mockResolvedValue({ id: 'ws-1' }),
      },
      buyer: {
        findFirst: vi.fn().mockResolvedValue({ id: 'buyer-1', workspace_id: 'ws-1' }),
      },
      vendor: {
        findFirst: vi.fn().mockResolvedValue({ id: 'vendor-1', workspace_id: 'ws-1' }),
      },
      callCommercial: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'comm-new-1',
            workspace_id: 'ws-1',
            buyer_id: 'buyer-1',
            vendor_id: 'vendor-1',
            currency: 'USD',
            revenue: new Prisma.Decimal('100.0000'),
            payout: new Prisma.Decimal('60.0000'),
            cost: new Prisma.Decimal('0.0000'),
            profit: new Prisma.Decimal('40.0000'),
            status: CommercialStatus.FINAL,
            finalizes_at: new Date('2026-10-05T00:00:00Z'),
            dispute: null,
            settlement_items: [],
          },
        ]),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      settlementBatch: {
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn().mockImplementation(() => Promise.resolve(getBaseBatch())),
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockImplementation((args) => Promise.resolve({ id: 'batch-target-1', ...args.data })),
        update: vi.fn().mockImplementation((args) => Promise.resolve({ ...getBaseBatch(), ...args.data })),
      },
      settlementItem: {
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
        aggregate: vi.fn().mockResolvedValue({
          _sum: { amount: new Prisma.Decimal('100.0000') },
          _count: { id: 1 },
        }),
        findMany: vi.fn().mockResolvedValue([]),
      },
      settlementAdjustment: {
        findMany: vi.fn().mockImplementation((args) => {
          if (args?.where?.status === AdjustmentStatus.PENDING) {
            return Promise.resolve([
              {
                id: 'adj-1',
                workspace_id: 'ws-1',
                direction: AdjustmentDirection.CREDIT,
                amount: new Prisma.Decimal('50.0000'),
                currency: 'USD',
                status: AdjustmentStatus.PENDING,
              },
            ]);
          }
          if (args?.where?.target_settlement_batch_id) {
            return Promise.resolve([
              {
                id: 'adj-1',
                workspace_id: 'ws-1',
                target_settlement_batch_id: 'batch-target-1',
                direction: AdjustmentDirection.CREDIT,
                amount: new Prisma.Decimal('50.0000'),
                currency: 'USD',
                status: AdjustmentStatus.APPLIED,
              },
            ]);
          }
          return Promise.resolve([]);
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      reconciliationRun: {
        create: vi.fn().mockImplementation((args) => Promise.resolve({ id: 'rec-1', ...args.data })),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SettlementBatchService,
        ReconciliationService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    settlementService = module.get<SettlementBatchService>(SettlementBatchService);
    reconciliationService = module.get<ReconciliationService>(ReconciliationService);
  });

  it('1. generateBuyerSettlement pulls pending SettlementAdjustment credit and applies to batch', async () => {
    const summary = await settlementService.generateBuyerSettlement({
      workspace_id: 'ws-1',
      period_start: periodStart,
      period_end: periodEnd,
      buyer_id: 'buyer-1',
    });

    expect(summary.batches.length).toBe(1);
    const batchResult = summary.batches[0];

    // Verified: gross is 100, adjustments is -50, net is 50
    expect(batchResult.gross_amount).toBe('100');
    expect(batchResult.adjustments_amount).toBe('-50');
    expect(batchResult.net_amount).toBe('50');

    // Verified: pending adjustments were updated to APPLIED
    expect(prisma.settlementAdjustment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['adj-1'] } },
        data: expect.objectContaining({
          status: AdjustmentStatus.APPLIED,
          target_settlement_batch_id: 'batch-target-1',
        }),
      }),
    );
  });

  it('2. Batch with applied forward adjustment reconciles with zero discrepancies (INV-5)', async () => {
    const run = await reconciliationService.runBatchReconciliation('ws-1', 'batch-target-1');

    expect(run.status).toBe(ReconciliationStatus.RECONCILED);
    expect(run.discrepancy_count).toBe(0);
    expect(prisma.settlementBatch.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { reconciliation_status: ReconciliationStatus.RECONCILED },
      }),
    );
  });

  it('3. When no pending adjustments exist, adjustments_amount is 0.0000 and net equals gross', async () => {
    prisma.settlementAdjustment.findMany.mockResolvedValue([]);

    const summary = await settlementService.generateBuyerSettlement({
      workspace_id: 'ws-1',
      period_start: periodStart,
      period_end: periodEnd,
      buyer_id: 'buyer-1',
    });

    expect(summary.batches.length).toBe(1);
    const batchResult = summary.batches[0];

    expect(batchResult.gross_amount).toBe('100');
    expect(batchResult.adjustments_amount).toBe('0');
    expect(batchResult.net_amount).toBe('100');
  });
});
