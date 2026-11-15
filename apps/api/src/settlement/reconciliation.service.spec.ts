import { Test, TestingModule } from '@nestjs/testing';
import { ReconciliationService } from './reconciliation.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  SettlementStatus,
  PaymentStatus,
  ReconciliationStatus,
  ReconciliationRunType,
  ReconciliationIssueType,
  ExecutionStatus,
  SettlementParticipantType,
  Prisma,
} from '@prisma/client';
import { vi, describe, it, expect, beforeEach } from 'vitest';

describe('ReconciliationService Unit Tests', () => {
  let service: ReconciliationService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReconciliationService,
        {
          provide: PrismaService,
          useValue: {
            $transaction: vi.fn(async (cb) => cb(prisma)),
            settlementBatch: {
              findFirst: vi.fn(),
              findMany: vi.fn(),
              update: vi.fn(),
            },
            settlementItem: {
              findMany: vi.fn(),
            },
            reconciliationRun: {
              create: vi.fn(),
              findMany: vi.fn(),
              findFirst: vi.fn(),
            },
            reconciliationIssue: {
              findMany: vi.fn(),
            },
          },
        },
      ],
    }).compile();

    service = module.get<ReconciliationService>(ReconciliationService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  describe('runBatchReconciliation', () => {
    it('1. clean closed batch with successful payment reconciles with zero discrepancies', async () => {
      const mockBatch: any = {
        id: 'batch-clean',
        batch_number: 'SB-001',
        workspace_id: 'ws-1',
        settlement_status: SettlementStatus.CLOSED,
        payment_status: PaymentStatus.SUCCEEDED,
        currency: 'USD',
        gross_amount: new Prisma.Decimal('100.0000'),
        adjustments_amount: new Prisma.Decimal('0.0000'),
        net_amount: new Prisma.Decimal('100.0000'),
        participant_type: SettlementParticipantType.BUYER,
        items: [
          {
            id: 'item-1',
            call_commercial_id: 'comm-1',
            amount: new Prisma.Decimal('100.0000'),
            currency: 'USD',
            participant_type: SettlementParticipantType.BUYER,
          },
        ],
        adjustments: [],
        payment_instruction: {
          currency: 'USD',
          executions: [
            {
              id: 'exec-1',
              status: ExecutionStatus.SUCCEEDED,
              amount: new Prisma.Decimal('100.0000'),
              currency: 'USD',
            },
          ],
        },
      };

      vi.spyOn(prisma.settlementBatch, 'findFirst').mockResolvedValue(mockBatch);
      vi.spyOn(prisma.settlementItem, 'findMany').mockResolvedValue([]);
      vi.spyOn(prisma.reconciliationRun, 'create').mockResolvedValue({
        id: 'run-clean',
        status: ReconciliationStatus.RECONCILED,
        discrepancy_count: 0,
        items_checked: 1,
        issues: [],
      } as any);
      vi.spyOn(prisma.settlementBatch, 'update').mockResolvedValue({} as any);

      const result = await service.runBatchReconciliation('ws-1', 'batch-clean');

      expect(prisma.reconciliationRun.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: ReconciliationStatus.RECONCILED,
            discrepancy_count: 0,
            items_checked: 1,
          }),
        }),
      );
      expect(prisma.settlementBatch.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'batch-clean' },
          data: { reconciliation_status: ReconciliationStatus.RECONCILED },
        }),
      );
    });

    it('2. detects SUM_MISMATCH when items sum does not equal net_amount', async () => {
      const mockBatch: any = {
        id: 'batch-mismatch',
        batch_number: 'SB-002',
        workspace_id: 'ws-1',
        settlement_status: SettlementStatus.CLOSED,
        payment_status: PaymentStatus.SUCCEEDED,
        currency: 'USD',
        gross_amount: new Prisma.Decimal('150.0000'),
        adjustments_amount: new Prisma.Decimal('0.0000'),
        net_amount: new Prisma.Decimal('150.0000'),
        participant_type: SettlementParticipantType.BUYER,
        items: [
          {
            id: 'item-1',
            call_commercial_id: 'comm-1',
            amount: new Prisma.Decimal('100.0000'), // Sum is 100 != 150
            currency: 'USD',
            participant_type: SettlementParticipantType.BUYER,
          },
        ],
        adjustments: [],
        payment_instruction: {
          currency: 'USD',
          executions: [
            {
              id: 'exec-1',
              status: ExecutionStatus.SUCCEEDED,
              amount: new Prisma.Decimal('150.0000'),
              currency: 'USD',
            },
          ],
        },
      };

      vi.spyOn(prisma.settlementBatch, 'findFirst').mockResolvedValue(mockBatch);
      vi.spyOn(prisma.settlementItem, 'findMany').mockResolvedValue([]);
      vi.spyOn(prisma.reconciliationRun, 'create').mockResolvedValue({
        id: 'run-mismatch',
        status: ReconciliationStatus.DISCREPANCY,
        discrepancy_count: 1,
      } as any);
      vi.spyOn(prisma.settlementBatch, 'update').mockResolvedValue({} as any);

      await service.runBatchReconciliation('ws-1', 'batch-mismatch');

      expect(prisma.reconciliationRun.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: ReconciliationStatus.DISCREPANCY,
            discrepancy_count: 1,
            issues: {
              create: [
                expect.objectContaining({
                  issue_type: ReconciliationIssueType.SUM_MISMATCH,
                }),
              ],
            },
          }),
        }),
      );
    });

    it('3. detects CURRENCY_MISMATCH when item currency differs from batch currency', async () => {
      const mockBatch: any = {
        id: 'batch-curr-mismatch',
        batch_number: 'SB-003',
        workspace_id: 'ws-1',
        settlement_status: SettlementStatus.CLOSED,
        payment_status: PaymentStatus.SUCCEEDED,
        currency: 'USD',
        gross_amount: new Prisma.Decimal('100.0000'),
        adjustments_amount: new Prisma.Decimal('0.0000'),
        net_amount: new Prisma.Decimal('100.0000'),
        participant_type: SettlementParticipantType.BUYER,
        items: [
          {
            id: 'item-1',
            call_commercial_id: 'comm-1',
            amount: new Prisma.Decimal('100.0000'),
            currency: 'EUR', // Mismatch!
            participant_type: SettlementParticipantType.BUYER,
          },
        ],
        adjustments: [],
        payment_instruction: {
          currency: 'USD',
          executions: [
            {
              id: 'exec-1',
              status: ExecutionStatus.SUCCEEDED,
              amount: new Prisma.Decimal('100.0000'),
              currency: 'USD',
            },
          ],
        },
      };

      vi.spyOn(prisma.settlementBatch, 'findFirst').mockResolvedValue(mockBatch);
      vi.spyOn(prisma.settlementItem, 'findMany').mockResolvedValue([]);
      vi.spyOn(prisma.reconciliationRun, 'create').mockResolvedValue({
        id: 'run-curr',
        status: ReconciliationStatus.DISCREPANCY,
      } as any);
      vi.spyOn(prisma.settlementBatch, 'update').mockResolvedValue({} as any);

      await service.runBatchReconciliation('ws-1', 'batch-curr-mismatch');

      expect(prisma.reconciliationRun.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: ReconciliationStatus.DISCREPANCY,
            issues: {
              create: expect.arrayContaining([
                expect.objectContaining({
                  issue_type: ReconciliationIssueType.CURRENCY_MISMATCH,
                }),
              ]),
            },
          }),
        }),
      );
    });

    it('4. detects MISSING_PAYMENT when finalized batch lacks successful payment', async () => {
      const mockBatch: any = {
        id: 'batch-missing-pay',
        batch_number: 'SB-004',
        workspace_id: 'ws-1',
        settlement_status: SettlementStatus.FINALIZED,
        payment_status: PaymentStatus.UNPROCESSED,
        currency: 'USD',
        gross_amount: new Prisma.Decimal('200.0000'),
        adjustments_amount: new Prisma.Decimal('0.0000'),
        net_amount: new Prisma.Decimal('200.0000'),
        participant_type: SettlementParticipantType.BUYER,
        items: [
          {
            id: 'item-1',
            call_commercial_id: 'comm-1',
            amount: new Prisma.Decimal('200.0000'),
            currency: 'USD',
            participant_type: SettlementParticipantType.BUYER,
          },
        ],
        adjustments: [],
        payment_instruction: null, // Missing payment!
      };

      vi.spyOn(prisma.settlementBatch, 'findFirst').mockResolvedValue(mockBatch);
      vi.spyOn(prisma.settlementItem, 'findMany').mockResolvedValue([]);
      vi.spyOn(prisma.reconciliationRun, 'create').mockResolvedValue({
        id: 'run-missing',
        status: ReconciliationStatus.DISCREPANCY,
      } as any);
      vi.spyOn(prisma.settlementBatch, 'update').mockResolvedValue({} as any);

      await service.runBatchReconciliation('ws-1', 'batch-missing-pay');

      expect(prisma.reconciliationRun.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: ReconciliationStatus.DISCREPANCY,
            issues: {
              create: expect.arrayContaining([
                expect.objectContaining({
                  issue_type: ReconciliationIssueType.MISSING_PAYMENT,
                }),
              ]),
            },
          }),
        }),
      );
    });

    it('5. detects DUPLICATE_CALL when item is settled across batches', async () => {
      const mockBatch: any = {
        id: 'batch-dup',
        batch_number: 'SB-005',
        workspace_id: 'ws-1',
        settlement_status: SettlementStatus.CLOSED,
        payment_status: PaymentStatus.SUCCEEDED,
        currency: 'USD',
        gross_amount: new Prisma.Decimal('100.0000'),
        adjustments_amount: new Prisma.Decimal('0.0000'),
        net_amount: new Prisma.Decimal('100.0000'),
        participant_type: SettlementParticipantType.BUYER,
        items: [
          {
            id: 'item-1',
            call_commercial_id: 'comm-dup-1',
            amount: new Prisma.Decimal('100.0000'),
            currency: 'USD',
            participant_type: SettlementParticipantType.BUYER,
          },
        ],
        adjustments: [],
        payment_instruction: {
          currency: 'USD',
          executions: [
            {
              id: 'exec-1',
              status: ExecutionStatus.SUCCEEDED,
              amount: new Prisma.Decimal('100.0000'),
              currency: 'USD',
            },
          ],
        },
      };

      vi.spyOn(prisma.settlementBatch, 'findFirst').mockResolvedValue(mockBatch);
      vi.spyOn(prisma.settlementItem, 'findMany').mockResolvedValue([
        {
          id: 'item-other',
          call_commercial_id: 'comm-dup-1',
          settlement_batch_id: 'batch-previous',
          participant_type: SettlementParticipantType.BUYER,
        } as any,
      ]);
      vi.spyOn(prisma.reconciliationRun, 'create').mockResolvedValue({
        id: 'run-dup',
        status: ReconciliationStatus.DISCREPANCY,
      } as any);
      vi.spyOn(prisma.settlementBatch, 'update').mockResolvedValue({} as any);

      await service.runBatchReconciliation('ws-1', 'batch-dup');

      expect(prisma.reconciliationRun.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: ReconciliationStatus.DISCREPANCY,
            issues: {
              create: expect.arrayContaining([
                expect.objectContaining({
                  issue_type: ReconciliationIssueType.DUPLICATE_CALL,
                  call_commercial_id: 'comm-dup-1',
                }),
              ]),
            },
          }),
        }),
      );
    });

    it('6. regression: valid Buyer + Vendor pair in the same batch must NOT be reported as duplicate', async () => {
      const mockBatch: any = {
        id: 'batch-buyer-vendor-pair',
        batch_number: 'SB-006',
        workspace_id: 'ws-1',
        settlement_status: SettlementStatus.CLOSED,
        payment_status: PaymentStatus.SUCCEEDED,
        currency: 'USD',
        gross_amount: new Prisma.Decimal('150.0000'),
        adjustments_amount: new Prisma.Decimal('0.0000'),
        net_amount: new Prisma.Decimal('150.0000'),
        participant_type: SettlementParticipantType.BUYER,
        items: [
          {
            id: 'item-buyer-1',
            call_commercial_id: 'comm-shared-1',
            amount: new Prisma.Decimal('100.0000'),
            currency: 'USD',
            participant_type: SettlementParticipantType.BUYER,
          },
          {
            id: 'item-vendor-1',
            call_commercial_id: 'comm-shared-1',
            amount: new Prisma.Decimal('50.0000'),
            currency: 'USD',
            participant_type: SettlementParticipantType.VENDOR,
          },
        ],
        adjustments: [],
        payment_instruction: {
          currency: 'USD',
          executions: [
            {
              id: 'exec-1',
              status: ExecutionStatus.SUCCEEDED,
              amount: new Prisma.Decimal('150.0000'),
              currency: 'USD',
            },
          ],
        },
      };

      vi.spyOn(prisma.settlementBatch, 'findFirst').mockResolvedValue(mockBatch);
      vi.spyOn(prisma.settlementItem, 'findMany').mockResolvedValue([]);
      vi.spyOn(prisma.reconciliationRun, 'create').mockResolvedValue({
        id: 'run-clean-pair',
        status: ReconciliationStatus.RECONCILED,
        discrepancy_count: 0,
      } as any);
      vi.spyOn(prisma.settlementBatch, 'update').mockResolvedValue({} as any);

      await service.runBatchReconciliation('ws-1', 'batch-buyer-vendor-pair');

      expect(prisma.reconciliationRun.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: ReconciliationStatus.RECONCILED,
            discrepancy_count: 0,
            issues: {
              create: [],
            },
          }),
        }),
      );
    });

    it('7. regression: duplicate BUYER items for the same CallCommercial in the same batch must be detected', async () => {
      const mockBatch: any = {
        id: 'batch-dup-buyer',
        batch_number: 'SB-007',
        workspace_id: 'ws-1',
        settlement_status: SettlementStatus.CLOSED,
        payment_status: PaymentStatus.SUCCEEDED,
        currency: 'USD',
        gross_amount: new Prisma.Decimal('200.0000'),
        adjustments_amount: new Prisma.Decimal('0.0000'),
        net_amount: new Prisma.Decimal('200.0000'),
        participant_type: SettlementParticipantType.BUYER,
        items: [
          {
            id: 'item-buyer-1',
            call_commercial_id: 'comm-dup-buyer',
            amount: new Prisma.Decimal('100.0000'),
            currency: 'USD',
            participant_type: SettlementParticipantType.BUYER,
          },
          {
            id: 'item-buyer-2',
            call_commercial_id: 'comm-dup-buyer', // Duplicate BUYER!
            amount: new Prisma.Decimal('100.0000'),
            currency: 'USD',
            participant_type: SettlementParticipantType.BUYER,
          },
        ],
        adjustments: [],
        payment_instruction: {
          currency: 'USD',
          executions: [
            {
              id: 'exec-1',
              status: ExecutionStatus.SUCCEEDED,
              amount: new Prisma.Decimal('200.0000'),
              currency: 'USD',
            },
          ],
        },
      };

      vi.spyOn(prisma.settlementBatch, 'findFirst').mockResolvedValue(mockBatch);
      vi.spyOn(prisma.settlementItem, 'findMany').mockResolvedValue([]);
      vi.spyOn(prisma.reconciliationRun, 'create').mockResolvedValue({
        id: 'run-dup-buyer',
        status: ReconciliationStatus.DISCREPANCY,
      } as any);
      vi.spyOn(prisma.settlementBatch, 'update').mockResolvedValue({} as any);

      await service.runBatchReconciliation('ws-1', 'batch-dup-buyer');

      expect(prisma.reconciliationRun.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: ReconciliationStatus.DISCREPANCY,
            issues: {
              create: expect.arrayContaining([
                expect.objectContaining({
                  issue_type: ReconciliationIssueType.DUPLICATE_CALL,
                  call_commercial_id: 'comm-dup-buyer',
                  description: expect.stringContaining('BUYER'),
                }),
              ]),
            },
          }),
        }),
      );
    });

    it('8. regression: duplicate VENDOR items for the same CallCommercial in the same batch must be detected', async () => {
      const mockBatch: any = {
        id: 'batch-dup-vendor',
        batch_number: 'SB-008',
        workspace_id: 'ws-1',
        settlement_status: SettlementStatus.CLOSED,
        payment_status: PaymentStatus.SUCCEEDED,
        currency: 'USD',
        gross_amount: new Prisma.Decimal('80.0000'),
        adjustments_amount: new Prisma.Decimal('0.0000'),
        net_amount: new Prisma.Decimal('80.0000'),
        participant_type: SettlementParticipantType.VENDOR,
        items: [
          {
            id: 'item-vendor-1',
            call_commercial_id: 'comm-dup-vendor',
            amount: new Prisma.Decimal('40.0000'),
            currency: 'USD',
            participant_type: SettlementParticipantType.VENDOR,
          },
          {
            id: 'item-vendor-2',
            call_commercial_id: 'comm-dup-vendor', // Duplicate VENDOR!
            amount: new Prisma.Decimal('40.0000'),
            currency: 'USD',
            participant_type: SettlementParticipantType.VENDOR,
          },
        ],
        adjustments: [],
        payment_instruction: {
          currency: 'USD',
          executions: [
            {
              id: 'exec-1',
              status: ExecutionStatus.SUCCEEDED,
              amount: new Prisma.Decimal('80.0000'),
              currency: 'USD',
            },
          ],
        },
      };

      vi.spyOn(prisma.settlementBatch, 'findFirst').mockResolvedValue(mockBatch);
      vi.spyOn(prisma.settlementItem, 'findMany').mockResolvedValue([]);
      vi.spyOn(prisma.reconciliationRun, 'create').mockResolvedValue({
        id: 'run-dup-vendor',
        status: ReconciliationStatus.DISCREPANCY,
      } as any);
      vi.spyOn(prisma.settlementBatch, 'update').mockResolvedValue({} as any);

      await service.runBatchReconciliation('ws-1', 'batch-dup-vendor');

      expect(prisma.reconciliationRun.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: ReconciliationStatus.DISCREPANCY,
            issues: {
              create: expect.arrayContaining([
                expect.objectContaining({
                  issue_type: ReconciliationIssueType.DUPLICATE_CALL,
                  call_commercial_id: 'comm-dup-vendor',
                  description: expect.stringContaining('VENDOR'),
                }),
              ]),
            },
          }),
        }),
      );
    });

    it('9. regression: historical settlement records with same CallCommercial across separate batches for BUYER and VENDOR must NOT conflict', async () => {
      // Historical batch: VENDOR item for 'comm-historical-1'
      // Current batch: BUYER item for 'comm-historical-1'
      const mockBatch: any = {
        id: 'batch-buyer-hist',
        batch_number: 'SB-009',
        workspace_id: 'ws-1',
        settlement_status: SettlementStatus.CLOSED,
        payment_status: PaymentStatus.SUCCEEDED,
        currency: 'USD',
        gross_amount: new Prisma.Decimal('100.0000'),
        adjustments_amount: new Prisma.Decimal('0.0000'),
        net_amount: new Prisma.Decimal('100.0000'),
        participant_type: SettlementParticipantType.BUYER,
        items: [
          {
            id: 'item-buyer',
            call_commercial_id: 'comm-historical-1',
            amount: new Prisma.Decimal('100.0000'),
            currency: 'USD',
            participant_type: SettlementParticipantType.BUYER,
          },
        ],
        adjustments: [],
        payment_instruction: {
          currency: 'USD',
          executions: [
            {
              id: 'exec-1',
              status: ExecutionStatus.SUCCEEDED,
              amount: new Prisma.Decimal('100.0000'),
              currency: 'USD',
            },
          ],
        },
      };

      vi.spyOn(prisma.settlementBatch, 'findFirst').mockResolvedValue(mockBatch);
      // Querying settlementItem for BUYER returns empty because existing item is for VENDOR
      vi.spyOn(prisma.settlementItem, 'findMany').mockImplementation(async (args: any) => {
        if (args?.where?.participant_type === SettlementParticipantType.BUYER) {
          return []; // No other BUYER item exists
        }
        return [
          {
            id: 'item-vendor-hist',
            call_commercial_id: 'comm-historical-1',
            settlement_batch_id: 'batch-vendor-hist',
            participant_type: SettlementParticipantType.VENDOR,
          } as any,
        ];
      });
      vi.spyOn(prisma.reconciliationRun, 'create').mockResolvedValue({
        id: 'run-clean-hist',
        status: ReconciliationStatus.RECONCILED,
        discrepancy_count: 0,
      } as any);
      vi.spyOn(prisma.settlementBatch, 'update').mockResolvedValue({} as any);

      await service.runBatchReconciliation('ws-1', 'batch-buyer-hist');

      expect(prisma.reconciliationRun.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: ReconciliationStatus.RECONCILED,
            discrepancy_count: 0,
            issues: {
              create: [],
            },
          }),
        }),
      );
    });
  });
});
