import { vi, describe, it, expect, beforeEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { CommercialEvaluatorService } from './commercial-evaluator.service.js';
import { CommercialFinalizationService } from './commercial-finalization.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  CallState,
  CallAttemptState,
  CommercialStatus,
  DisputeStatus,
  ReservationStatus,
  TransactionType,
} from '@prisma/client';

describe('Layer 1 & 2 Regression: Commercial 168h Maturity & Zero-Cost Handling', () => {
  let evaluatorService: CommercialEvaluatorService;
  let finalizationService: CommercialFinalizationService;
  let prismaMock: any;

  const mockWorkspaceId = 'ws-reg-comm-1';
  const mockCallId = 'call-reg-comm-1';
  const mockCampaignId = 'camp-reg-comm-1';

  beforeEach(async () => {
    prismaMock = {
      callCommercial: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
        updateMany: vi.fn(),
      },
      call: {
        findUnique: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
      },
      phoneNumber: {
        findFirst: vi.fn(),
      },
      callReservation: {
        findUnique: vi.fn(),
      },
      walletTransaction: {
        findFirst: vi.fn(),
      },
      $queryRaw: vi.fn(),
      $executeRaw: vi.fn().mockResolvedValue(1),
      $transaction: vi.fn(async (cb) => {
        if (typeof cb === 'function') {
          return cb(prismaMock);
        }
        return cb;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommercialEvaluatorService,
        CommercialFinalizationService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    evaluatorService = module.get<CommercialEvaluatorService>(CommercialEvaluatorService);
    finalizationService = module.get<CommercialFinalizationService>(CommercialFinalizationService);
  });

  describe('Synchronous 168-Hour Maturity Calculation', () => {
    it('sets finalizes_at to exactly created_at + 168 hours and status to PENDING', async () => {
      const call = {
        id: mockCallId,
        workspace_id: mockWorkspaceId,
        campaign_id: mockCampaignId,
        state: CallState.COMPLETED,
        from_number: '+15551234567',
        to_number: '+15559876543',
        attributed_vendor_id: 'ven-1',
        answered_at: new Date('2026-02-01T10:00:00Z'),
        ended_at: new Date('2026-02-01T10:02:00Z'), // 120s connected talk
        created_at: new Date('2026-02-01T09:59:50Z'),
        campaign: {
          id: mockCampaignId,
          currency: 'USD',
          default_revenue_amount: new Prisma.Decimal('50.0000'),
          default_payout_amount: new Prisma.Decimal('30.0000'),
          conversion_duration_secs: 60,
          duplicate_window_secs: 2592000,
        },
        attempts: [
          {
            id: 'attempt-1',
            buyer_id: 'buyer-1',
            state: CallAttemptState.COMPLETED,
            answered_at: new Date('2026-02-01T10:00:00Z'),
            ended_at: new Date('2026-02-01T10:02:00Z'),
            created_at: new Date('2026-02-01T10:00:00Z'),
          },
        ],
      };

      prismaMock.callCommercial.findUnique.mockResolvedValue(null);
      prismaMock.call.findUnique.mockResolvedValue(call);
      prismaMock.callReservation.findUnique.mockResolvedValue({
        status: ReservationStatus.SETTLED,
      });
      // Settlement transaction with $1.50 cost
      prismaMock.walletTransaction.findFirst.mockResolvedValue({
        amount_micro: BigInt(1500000), // $1.50
      });
      prismaMock.call.findMany.mockResolvedValue([]); // no duplicate candidates

      prismaMock.callCommercial.create.mockImplementation((args: any) =>
        Promise.resolve({ id: 'comm-1', ...args.data }),
      );

      const beforeTime = Date.now();
      const result = await evaluatorService.evaluateCall(mockCallId);
      const afterTime = Date.now();

      expect(result).toBeDefined();
      expect(result.status).toBe(CommercialStatus.PENDING);
      expect(result.finalizes_at).toBeDefined();

      // Invariant check: finalizes_at - created_at must equal exactly 168 hours (7 days)
      const maturityDeltaMs = result.finalizes_at.getTime() - result.created_at.getTime();
      const expectedDeltaMs = 168 * 60 * 60 * 1000; // 604,800,000 ms
      expect(maturityDeltaMs).toBe(expectedDeltaMs);

      // Verify Decimal financial figures
      expect(result.revenue.toString()).toBe('50');
      expect(result.payout.toString()).toBe('30');
      expect(result.cost.toString()).toBe('1.5');
      // Profit = 50 - 30 - 1.5 = 18.5
      expect(result.profit.toString()).toBe('18.5');
      expect(result.qualified).toBe(true);
      expect(result.converted).toBe(true);
      expect(result.duplicate).toBe(false);
    });
  });

  describe('Zero Operational Cost Handling (AD-03 Invariants)', () => {
    const baseCall = {
      id: mockCallId,
      workspace_id: mockWorkspaceId,
      campaign_id: mockCampaignId,
      state: CallState.COMPLETED,
      from_number: '+15551234567',
      to_number: '+15559876543',
      attributed_vendor_id: 'ven-1',
      answered_at: new Date('2026-02-01T10:00:00Z'),
      ended_at: new Date('2026-02-01T10:01:30Z'), // 90s
      created_at: new Date('2026-02-01T09:59:50Z'),
      campaign: {
        id: mockCampaignId,
        currency: 'USD',
        default_revenue_amount: new Prisma.Decimal('40.0000'),
        default_payout_amount: new Prisma.Decimal('25.0000'),
        conversion_duration_secs: 60,
      },
      attempts: [
        {
          id: 'attempt-1',
          buyer_id: 'buyer-1',
          state: CallAttemptState.COMPLETED,
          answered_at: new Date('2026-02-01T10:00:00Z'),
          ended_at: new Date('2026-02-01T10:01:30Z'),
          created_at: new Date('2026-02-01T10:00:00Z'),
        },
      ],
    };

    it('Case B: SETTLED reservation without CALL_SETTLEMENT transaction produces legitimate zero cost (0.0000)', async () => {
      prismaMock.callCommercial.findUnique.mockResolvedValue(null);
      prismaMock.call.findUnique.mockResolvedValue(baseCall);
      prismaMock.callReservation.findUnique.mockResolvedValue({
        status: ReservationStatus.SETTLED,
      });
      // No CALL_SETTLEMENT transaction (e.g. flat rate tier, internal bypass, or zero provider charge)
      prismaMock.walletTransaction.findFirst.mockResolvedValue(null);
      prismaMock.call.findMany.mockResolvedValue([]);

      prismaMock.callCommercial.create.mockImplementation((args: any) =>
        Promise.resolve({ id: 'comm-zero-cost', ...args.data }),
      );

      const result = await evaluatorService.evaluateCall(mockCallId);

      expect(result).toBeDefined();
      expect(result.cost.toString()).toBe('0');
      // Profit = 40 - 25 - 0 = 15.0000
      expect(result.profit.toString()).toBe('15');
      expect(result.status).toBe(CommercialStatus.PENDING);
    });

    it('Case C: Missing or non-SETTLED reservation defers commercial evaluation (returns null)', async () => {
      prismaMock.callCommercial.findUnique.mockResolvedValue(null);
      prismaMock.call.findUnique.mockResolvedValue(baseCall);
      // Reservation is still ACTIVE (wallet settlement has not yet completed)
      prismaMock.callReservation.findUnique.mockResolvedValue({
        status: ReservationStatus.ACTIVE,
      });

      const result = await evaluatorService.evaluateCall(mockCallId);

      // Must defer evaluation until settlement is SETTLED
      expect(result).toBeNull();
      expect(prismaMock.callCommercial.create).not.toHaveBeenCalled();
    });

    it('Case C2: Completely missing reservation defers commercial evaluation (returns null)', async () => {
      prismaMock.callCommercial.findUnique.mockResolvedValue(null);
      prismaMock.call.findUnique.mockResolvedValue(baseCall);
      prismaMock.callReservation.findUnique.mockResolvedValue(null);

      const result = await evaluatorService.evaluateCall(mockCallId);
      expect(result).toBeNull();
      expect(prismaMock.callCommercial.create).not.toHaveBeenCalled();
    });
  });

  describe('Non-Eligible State & Configuration Filtering', () => {
    it('skips non-COMPLETED calls (e.g. CallState.NO_ANSWER or FAILED)', async () => {
      prismaMock.callCommercial.findUnique.mockResolvedValue(null);
      prismaMock.call.findUnique.mockResolvedValue({
        id: mockCallId,
        state: CallState.NO_ANSWER,
        campaign: { default_revenue_amount: 10, default_payout_amount: 5 },
      });

      const result = await evaluatorService.evaluateCall(mockCallId);
      expect(result).toBeNull();
      expect(prismaMock.callCommercial.create).not.toHaveBeenCalled();
    });

    it('skips calls for campaigns without commercial configuration (null revenue or payout)', async () => {
      prismaMock.callCommercial.findUnique.mockResolvedValue(null);
      prismaMock.call.findUnique.mockResolvedValue({
        id: mockCallId,
        state: CallState.COMPLETED,
        campaign: {
          default_revenue_amount: null, // Unconfigured
          default_payout_amount: new Prisma.Decimal('10.0000'),
        },
      });

      const result = await evaluatorService.evaluateCall(mockCallId);
      expect(result).toBeNull();
      expect(prismaMock.callCommercial.create).not.toHaveBeenCalled();
    });

    it('idempotently returns existing CallCommercial without re-evaluating', async () => {
      const existingRecord = {
        id: 'comm-existing-1',
        call_id: mockCallId,
        status: CommercialStatus.PENDING,
        revenue: new Prisma.Decimal('50.0000'),
      };
      prismaMock.callCommercial.findUnique.mockResolvedValue(existingRecord);

      const result = await evaluatorService.evaluateCall(mockCallId);
      expect(result).toEqual(existingRecord);
      expect(prismaMock.call.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('Duplicate Detection & Commercial Qualification', () => {
    it('deflects duplicate call when prior converted call exists for same caller + destination within window', async () => {
      const callerNumber = '+15551234567';
      const destinationNumber = '+15559876543';

      const currentCall = {
        id: 'call-second',
        workspace_id: mockWorkspaceId,
        campaign_id: mockCampaignId,
        state: CallState.COMPLETED,
        from_number: callerNumber,
        to_number: destinationNumber,
        answered_at: new Date('2026-02-02T10:00:00Z'),
        ended_at: new Date('2026-02-02T10:02:00Z'), // 120s (converted)
        created_at: new Date('2026-02-02T09:59:50Z'),
        campaign: {
          id: mockCampaignId,
          currency: 'USD',
          default_revenue_amount: new Prisma.Decimal('100.0000'),
          default_payout_amount: new Prisma.Decimal('60.0000'),
          conversion_duration_secs: 60,
          duplicate_window_secs: 2592000,
        },
        attempts: [
          {
            id: 'attempt-2',
            buyer_id: 'buyer-1',
            state: CallAttemptState.COMPLETED,
            answered_at: new Date('2026-02-02T10:00:00Z'),
            ended_at: new Date('2026-02-02T10:02:00Z'),
            created_at: new Date('2026-02-02T10:00:00Z'),
          },
        ],
      };

      const priorOriginalCall = {
        id: 'call-first-original',
        workspace_id: mockWorkspaceId,
        campaign_id: mockCampaignId,
        state: CallState.COMPLETED,
        from_number: callerNumber,
        to_number: destinationNumber,
        created_at: new Date('2026-02-01T10:00:00Z'), // 1 day earlier
        commercial: {
          id: 'comm-first',
          converted: true,
          duplicate: false,
          duplicate_of_call_id: null,
        },
        attempts: [],
      };

      prismaMock.callCommercial.findUnique.mockResolvedValue(null);
      prismaMock.call.findUnique.mockResolvedValue(currentCall);
      prismaMock.callReservation.findUnique.mockResolvedValue({
        status: ReservationStatus.SETTLED,
      });
      prismaMock.walletTransaction.findFirst.mockResolvedValue(null); // 0 cost
      // Return prior original call in candidate query
      prismaMock.call.findMany.mockResolvedValue([priorOriginalCall]);

      prismaMock.callCommercial.create.mockImplementation((args: any) =>
        Promise.resolve({ id: 'comm-dup', ...args.data }),
      );

      const result = await evaluatorService.evaluateCall('call-second');

      expect(result.duplicate).toBe(true);
      expect(result.qualified).toBe(false);
      expect(result.duplicate_of_call_id).toBe('call-first-original');
      // Duplicate calls yield 0 revenue and 0 payout!
      expect(result.revenue.toString()).toBe('0');
      expect(result.payout.toString()).toBe('0');
      expect(result.cost.toString()).toBe('0');
      expect(result.profit.toString()).toBe('0');
    });

    it('does NOT trigger duplicate when caller is anonymous or unidentifiable', async () => {
      const currentCall = {
        id: 'call-anon-2',
        workspace_id: mockWorkspaceId,
        campaign_id: mockCampaignId,
        state: CallState.COMPLETED,
        from_number: 'anonymous', // non-identifiable
        to_number: '+15559876543',
        answered_at: new Date('2026-02-02T10:00:00Z'),
        ended_at: new Date('2026-02-02T10:02:00Z'),
        created_at: new Date('2026-02-02T09:59:50Z'),
        campaign: {
          id: mockCampaignId,
          currency: 'USD',
          default_revenue_amount: new Prisma.Decimal('50.0000'),
          default_payout_amount: new Prisma.Decimal('30.0000'),
          conversion_duration_secs: 60,
        },
        attempts: [
          {
            id: 'attempt-1',
            buyer_id: 'buyer-1',
            state: CallAttemptState.COMPLETED,
            answered_at: new Date('2026-02-02T10:00:00Z'),
            ended_at: new Date('2026-02-02T10:02:00Z'),
            created_at: new Date('2026-02-02T10:00:00Z'),
          },
        ],
      };

      prismaMock.callCommercial.findUnique.mockResolvedValue(null);
      prismaMock.call.findUnique.mockResolvedValue(currentCall);
      prismaMock.callReservation.findUnique.mockResolvedValue({
        status: ReservationStatus.SETTLED,
      });
      prismaMock.walletTransaction.findFirst.mockResolvedValue(null);

      prismaMock.callCommercial.create.mockImplementation((args: any) =>
        Promise.resolve({ id: 'comm-anon', ...args.data }),
      );

      const result = await evaluatorService.evaluateCall('call-anon-2');

      expect(result.duplicate).toBe(false);
      expect(result.qualified).toBe(true);
      expect(result.revenue.toString()).toBe('50');
      expect(prismaMock.call.findMany).not.toHaveBeenCalled(); // duplicate search skipped for unidentifiable caller
    });
  });

  describe('Commercial Batch Finalization Invariants (AD-02)', () => {
    it('finalizes matured PENDING records when finalizes_at <= referenceTime', async () => {
      const now = new Date('2026-02-08T12:00:00Z');
      const maturedPending = [
        {
          id: 'comm-matured-1',
          status: CommercialStatus.PENDING,
          finalizes_at: new Date('2026-02-08T10:00:00Z'), // matured 2 hours ago
          dispute: null,
          revenue: new Prisma.Decimal('50.0000'),
          payout: new Prisma.Decimal('30.0000'),
          cost: new Prisma.Decimal('1.0000'),
          profit: new Prisma.Decimal('19.0000'),
        },
      ];

      prismaMock.callCommercial.findMany.mockResolvedValue(maturedPending);
      prismaMock.callCommercial.updateMany.mockResolvedValue({ count: 1 });

      const batchResult = await finalizationService.processFinalizationBatch(now);

      expect(batchResult.candidateCount).toBe(1);
      expect(batchResult.finalizedCount).toBe(1);
      expect(batchResult.blockedByDisputeCount).toBe(0);

      // Verify atomic update strictly transitions status to FINAL without touching financial fields
      expect(prismaMock.callCommercial.updateMany).toHaveBeenCalledWith({
        where: {
          id: { in: ['comm-matured-1'] },
          status: CommercialStatus.PENDING, // concurrency lock
        },
        data: {
          status: CommercialStatus.FINAL,
        },
      });
    });

    it('strictly BLOCKS finalization when record has an active PENDING dispute', async () => {
      const now = new Date('2026-02-08T12:00:00Z');
      const disputedPending = [
        {
          id: 'comm-disputed-1',
          status: CommercialStatus.PENDING,
          finalizes_at: new Date('2026-02-08T10:00:00Z'), // matured
          dispute: {
            id: 'disp-1',
            status: DisputeStatus.PENDING, // Active dispute!
          },
        },
      ];

      prismaMock.callCommercial.findMany.mockResolvedValue(disputedPending);

      const batchResult = await finalizationService.processFinalizationBatch(now);

      expect(batchResult.candidateCount).toBe(1);
      expect(batchResult.finalizedCount).toBe(0);
      expect(batchResult.blockedByDisputeCount).toBe(1);
      expect(prismaMock.callCommercial.updateMany).not.toHaveBeenCalled();
    });

    it('allows finalization when dispute is already RESOLVED or REJECTED', async () => {
      const now = new Date('2026-02-08T12:00:00Z');
      const resolvedDisputeRecord = [
        {
          id: 'comm-resolved-1',
          status: CommercialStatus.PENDING,
          finalizes_at: new Date('2026-02-08T10:00:00Z'),
          dispute: {
            id: 'disp-1',
            status: DisputeStatus.RESOLVED,
          },
        },
      ];

      prismaMock.callCommercial.findMany.mockResolvedValue(resolvedDisputeRecord);
      prismaMock.callCommercial.updateMany.mockResolvedValue({ count: 1 });

      const batchResult = await finalizationService.processFinalizationBatch(now);

      expect(batchResult.finalizedCount).toBe(1);
      expect(batchResult.blockedByDisputeCount).toBe(0);
      expect(prismaMock.callCommercial.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: { in: ['comm-resolved-1'] } }),
        }),
      );
    });

    it('skips records whose finalizes_at has not yet matured (finalizes_at > referenceTime)', async () => {
      const now = new Date('2026-02-08T12:00:00Z');
      // findMany query has lte: now filter, so immature records return empty
      prismaMock.callCommercial.findMany.mockResolvedValue([]);

      const batchResult = await finalizationService.processFinalizationBatch(now);

      expect(batchResult.candidateCount).toBe(0);
      expect(batchResult.finalizedCount).toBe(0);
      expect(prismaMock.callCommercial.updateMany).not.toHaveBeenCalled();
    });
  });
});
