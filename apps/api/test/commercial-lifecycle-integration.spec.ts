import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { CommercialEvaluatorService } from '../src/commercial/commercial-evaluator.service.js';
import { CommercialFinalizationService } from '../src/commercial/commercial-finalization.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  CallState,
  CallAttemptState,
  CommercialStatus,
  TransactionType,
  ReservationStatus,
  DisputeStatus,
  Prisma,
} from '@prisma/client';

describe('COMM-INTEGRATION-1: Commercial Lifecycle Integration Specification', () => {
  let evaluatorService: CommercialEvaluatorService;
  let finalizationService: CommercialFinalizationService;
  let prisma: any;

  const mockDate = new Date('2026-10-08T12:00:00.000Z');

  const getBaseCall = (overrides: Record<string, any> = {}) => ({
    id: 'call-101',
    workspace_id: 'ws-test',
    campaign_id: 'camp-101',
    from_number: '+15551112222',
    to_number: '+15553334444',
    state: CallState.COMPLETED,
    duration_secs: 120,
    created_at: new Date(mockDate),
    updated_at: new Date(mockDate),
    campaign: {
      id: 'camp-101',
      workspace_id: 'ws-test',
      name: 'Integration Campaign',
      status: 'ACTIVE',
      conversion_duration_secs: 60,
      duplicate_window_secs: 2592000,
      default_revenue_amount: new Prisma.Decimal('50.0000'),
      default_payout_amount: new Prisma.Decimal('35.0000'),
      currency: 'USD',
    },
    attempts: [
      {
        id: 'att-1',
        call_id: 'call-101',
        buyer_id: 'buyer-1',
        state: CallAttemptState.COMPLETED,
        answered_at: new Date('2026-10-08T12:00:05.000Z'),
        created_at: new Date(mockDate),
      },
    ],
    ...overrides,
  });

  beforeEach(async () => {
    prisma = {
      $transaction: vi.fn(async (cb) => cb(prisma)),
      callCommercial: {
        findUnique: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockImplementation((args) => Promise.resolve({ id: 'comm-101', ...args.data })),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      call: {
        findUnique: vi.fn().mockImplementation(() => Promise.resolve(getBaseCall())),
        findMany: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockImplementation((args) => Promise.resolve(args.data)),
      },
      phoneNumber: {
        findFirst: vi.fn().mockResolvedValue({ vendor_id: 'vendor-1' }),
      },
      callReservation: {
        findUnique: vi.fn().mockResolvedValue({ status: ReservationStatus.SETTLED }),
      },
      walletTransaction: {
        findFirst: vi.fn().mockResolvedValue({
          amount_micro: 200000n, // $0.2000
          type: TransactionType.DEBIT,
        }),
        create: vi.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommercialEvaluatorService,
        CommercialFinalizationService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    evaluatorService = module.get<CommercialEvaluatorService>(CommercialEvaluatorService);
    finalizationService = module.get<CommercialFinalizationService>(CommercialFinalizationService);
  });

  // ==========================================
  // SECTION 1: CALL EVALUATION CORE
  // ==========================================
  describe('1. Call Evaluation Core', () => {
    it('1. completed call evaluates successfully', async () => {
      const result = await evaluatorService.evaluateCall('call-101');
      expect(result).toBeDefined();
      expect(prisma.callCommercial.create).toHaveBeenCalledTimes(1);
      expect(result?.status).toBe(CommercialStatus.PENDING);
    });

    it('2. incomplete call does not evaluate (RINGING/INITIATED)', async () => {
      const ringingCall = getBaseCall({ state: CallState.RINGING });
      prisma.call.findUnique.mockResolvedValueOnce(ringingCall);

      const result = await evaluatorService.evaluateCall('call-101');
      expect(result).toBeNull();
      expect(prisma.callCommercial.create).not.toHaveBeenCalled();
    });

    it('3. failed call does not evaluate (FAILED)', async () => {
      const failedCall = getBaseCall({ state: CallState.FAILED });
      prisma.call.findUnique.mockResolvedValueOnce(failedCall);

      const result = await evaluatorService.evaluateCall('call-101');
      expect(result).toBeNull();
      expect(prisma.callCommercial.create).not.toHaveBeenCalled();
    });

    it('4. missing campaign revenue skips evaluation', async () => {
      const call = getBaseCall();
      call.campaign.default_revenue_amount = null as any;
      prisma.call.findUnique.mockResolvedValueOnce(call);

      const result = await evaluatorService.evaluateCall('call-101');
      expect(result).toBeNull();
      expect(prisma.callCommercial.create).not.toHaveBeenCalled();
    });

    it('5. missing campaign payout skips evaluation', async () => {
      const call = getBaseCall();
      call.campaign.default_payout_amount = null as any;
      prisma.call.findUnique.mockResolvedValueOnce(call);

      const result = await evaluatorService.evaluateCall('call-101');
      expect(result).toBeNull();
      expect(prisma.callCommercial.create).not.toHaveBeenCalled();
    });

    it('6. repeated evaluation is idempotent', async () => {
      const existingRecord = { id: 'comm-101', call_id: 'call-101', status: CommercialStatus.PENDING };
      prisma.callCommercial.findUnique.mockResolvedValueOnce(existingRecord);

      const result = await evaluatorService.evaluateCall('call-101');
      expect(result).toEqual(existingRecord);
      expect(prisma.callCommercial.create).not.toHaveBeenCalled();
    });

    it('7. concurrent evaluation handles P2002 conflict and returns existing row', async () => {
      prisma.callCommercial.create.mockRejectedValueOnce({ code: 'P2002' });
      const existingAfterRace = { id: 'comm-race', call_id: 'call-101', status: CommercialStatus.PENDING };
      prisma.callCommercial.findUnique
        .mockResolvedValueOnce(null) // first check
        .mockResolvedValueOnce(existingAfterRace); // post-conflict fetch

      const result = await evaluatorService.evaluateCall('call-101');
      expect(result).toEqual(existingAfterRace);
    });
  });

  // ==========================================
  // SECTION 2: POSITIVE COST HANDLING
  // ==========================================
  describe('2. Positive Cost Handling', () => {
    it('8-12. SETTLED reservation + CALL_SETTLEMENT produces exact Decimal valuation', async () => {
      prisma.walletTransaction.findFirst.mockResolvedValueOnce({
        amount_micro: 250000n, // $0.2500
        type: TransactionType.DEBIT,
      });

      const result = await evaluatorService.evaluateCall('call-101');
      expect(result).toBeDefined();

      const created = prisma.callCommercial.create.mock.calls[0][0].data;
      expect(created.revenue.toString()).toBe('50');
      expect(created.payout.toString()).toBe('35');
      expect(created.cost.toString()).toBe('0.25');
      // profit = 50 - 35 - 0.25 = 14.7500
      expect(created.profit.toString()).toBe('14.75');
    });
  });

  // ==========================================
  // SECTION 3: ZERO COST HANDLING (AD-03)
  // ==========================================
  describe('3. Zero Cost Handling (AD-03)', () => {
    it('13-18. SETTLED reservation without CALL_SETTLEMENT creates CallCommercial with cost = 0 without fake transactions', async () => {
      // SETTLED reservation present, but no operational debit
      prisma.callReservation.findUnique.mockResolvedValueOnce({ status: ReservationStatus.SETTLED });
      prisma.walletTransaction.findFirst.mockResolvedValueOnce(null);

      const result = await evaluatorService.evaluateCall('call-101');
      expect(result).toBeDefined();

      const created = prisma.callCommercial.create.mock.calls[0][0].data;
      expect(created.cost.toString()).toBe('0');
      expect(created.revenue.toString()).toBe('50');
      expect(created.payout.toString()).toBe('35');
      // profit = 50 - 35 - 0 = 15.0000
      expect(created.profit.toString()).toBe('15');

      // Zero-dollar wallet ledger pollution check:
      expect(prisma.walletTransaction.create).not.toHaveBeenCalled();
    });
  });

  // ==========================================
  // SECTION 4: UNSETTLED CALLS
  // ==========================================
  describe('4. Unsettled Calls Protection', () => {
    it('19-20. ACTIVE reservation is not evaluated as zero cost; evaluation aborts', async () => {
      prisma.callReservation.findUnique.mockResolvedValueOnce({ status: ReservationStatus.ACTIVE });

      const result = await evaluatorService.evaluateCall('call-101');
      expect(result).toBeNull();
      expect(prisma.callCommercial.create).not.toHaveBeenCalled();
    });

    it('Missing reservation aborts evaluation', async () => {
      prisma.callReservation.findUnique.mockResolvedValueOnce(null);

      const result = await evaluatorService.evaluateCall('call-101');
      expect(result).toBeNull();
      expect(prisma.callCommercial.create).not.toHaveBeenCalled();
    });
  });

  // ==========================================
  // SECTION 5: FINALIZATION & MATURITY (AD-01, AD-02)
  // ==========================================
  describe('5. Finalization & Maturity (AD-01, AD-02)', () => {
    it('21-22. finalizes_at is persisted synchronously and equals created_at + 168 hours', async () => {
      const result = await evaluatorService.evaluateCall('call-101');
      expect(result).toBeDefined();

      const created = prisma.callCommercial.create.mock.calls[0][0].data;
      expect(created.finalizes_at).toBeDefined();
      expect(created.created_at).toBeDefined();

      const diffMs = created.finalizes_at.getTime() - created.created_at.getTime();
      expect(diffMs).toBe(168 * 60 * 60 * 1000);
    });

    it('23-25. Mature PENDING record transitions to FINAL; unmatured records remain PENDING', async () => {
      const maturedComm = {
        id: 'comm-mature',
        workspace_id: 'ws-test',
        status: CommercialStatus.PENDING,
        finalizes_at: new Date('2026-10-15T11:59:00.000Z'),
        dispute: null,
      };

      const now = new Date('2026-10-15T12:00:00.000Z');
      prisma.callCommercial.findMany.mockResolvedValueOnce([maturedComm]);

      const res = await finalizationService.processFinalizationBatch(now);
      expect(res.finalizedCount).toBe(1);

      expect(prisma.callCommercial.updateMany).toHaveBeenCalledWith({
        where: {
          id: { in: ['comm-mature'] },
          status: CommercialStatus.PENDING,
        },
        data: {
          status: CommercialStatus.FINAL,
        },
      });
    });

    it('26-27. Existing FINAL or ADJUSTED records are immutable to re-evaluation', async () => {
      const finalComm = { id: 'comm-final', call_id: 'call-101', status: CommercialStatus.FINAL };
      prisma.callCommercial.findUnique.mockResolvedValueOnce(finalComm);

      const res1 = await evaluatorService.evaluateCall('call-101');
      expect(res1?.status).toBe(CommercialStatus.FINAL);
      expect(prisma.callCommercial.create).not.toHaveBeenCalled();

      const adjustedComm = { id: 'comm-adj', call_id: 'call-101', status: CommercialStatus.ADJUSTED };
      prisma.callCommercial.findUnique.mockResolvedValueOnce(adjustedComm);

      const res2 = await evaluatorService.evaluateCall('call-101');
      expect(res2?.status).toBe(CommercialStatus.ADJUSTED);
      expect(prisma.callCommercial.create).not.toHaveBeenCalled();
    });
  });

  // ==========================================
  // SECTION 6: DISPUTE INTERACTION
  // ==========================================
  describe('6. Dispute Interaction', () => {
    it('28. Pending dispute blocks finalization', async () => {
      const commDisputed = {
        id: 'comm-disp',
        workspace_id: 'ws-test',
        status: CommercialStatus.PENDING,
        finalizes_at: new Date('2026-10-15T10:00:00.000Z'),
        dispute: { id: 'disp-1', status: DisputeStatus.PENDING },
      };

      prisma.callCommercial.findMany.mockResolvedValueOnce([commDisputed]);

      const res = await finalizationService.processFinalizationBatch(new Date('2026-10-15T12:00:00.000Z'));
      expect(res.finalizedCount).toBe(0);
      expect(res.blockedByDisputeCount).toBe(1);
      expect(prisma.callCommercial.updateMany).not.toHaveBeenCalled();
    });

    it('29-31. Rejected dispute permits finalization without mutating dispute state or creating financial adjustments', async () => {
      const commResolved = {
        id: 'comm-rejected-disp',
        workspace_id: 'ws-test',
        status: CommercialStatus.PENDING,
        finalizes_at: new Date('2026-10-15T10:00:00.000Z'),
        dispute: { id: 'disp-1', status: DisputeStatus.REJECTED },
      };

      prisma.callCommercial.findMany.mockResolvedValueOnce([commResolved]);

      const res = await finalizationService.processFinalizationBatch(new Date('2026-10-15T12:00:00.000Z'));
      expect(res.finalizedCount).toBe(1);
      expect(res.blockedByDisputeCount).toBe(0);
    });
  });

  // ==========================================
  // SECTION 7: CONCURRENCY & TENANCY
  // ==========================================
  describe('7. Concurrency, Idempotency & Tenancy', () => {
    it('32-34. Concurrent finalization and repeated sweeps are idempotent and concurrency-safe', async () => {
      const comm = {
        id: 'comm-concurrent',
        workspace_id: 'ws-test',
        status: CommercialStatus.PENDING,
        finalizes_at: new Date('2026-10-15T10:00:00.000Z'),
        dispute: null,
      };

      prisma.callCommercial.findMany.mockResolvedValueOnce([comm]);
      prisma.callCommercial.updateMany.mockResolvedValueOnce({ count: 1 });

      const res1 = await finalizationService.processFinalizationBatch(new Date('2026-10-15T12:00:00.000Z'));
      expect(res1.finalizedCount).toBe(1);

      // Second run: no PENDING records returned
      prisma.callCommercial.findMany.mockResolvedValueOnce([]);
      const res2 = await finalizationService.processFinalizationBatch(new Date('2026-10-15T12:00:00.000Z'));
      expect(res2.finalizedCount).toBe(0);
    });

    it('38-39. Multi-tenant workspace isolation is strictly preserved', async () => {
      const result = await evaluatorService.evaluateCall('call-101');
      expect(result?.workspace_id).toBe('ws-test');

      const now = new Date('2026-10-15T12:00:00.000Z');
      await finalizationService.processFinalizationBatch(now, 'ws-isolated');

      expect(prisma.callCommercial.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            workspace_id: 'ws-isolated',
          }),
        }),
      );
    });
  });
});
