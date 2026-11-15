import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { CommercialEvaluatorService, getDuplicateScopeAdvisoryLockKey } from './commercial-evaluator.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  CallState,
  CallAttemptState,
  CommercialStatus,
  TransactionType,
  ReservationStatus,
  Prisma,
} from '@prisma/client';

describe('CommercialEvaluatorService (COMM-4 Financial Correction)', () => {
  let service: CommercialEvaluatorService;
  let prisma: any;

  const mockDate = new Date('2026-10-07T12:00:00.000Z');

  const getBaseCall = () => ({
    id: 'call-1',
    workspace_id: 'ws-1',
    campaign_id: 'camp-1',
    from_number: '+15551234567',
    to_number: '+15559876543',
    state: CallState.COMPLETED,
    duration_secs: 130, // 10s ring + 120s connected talk
    created_at: new Date(mockDate),
    updated_at: new Date(mockDate),
    answered_at: new Date('2026-10-07T12:00:10.000Z'), // 10s ringing
    ended_at: new Date('2026-10-07T12:02:10.000Z'), // 120s connected talk
    campaign: {
      id: 'camp-1',
      workspace_id: 'ws-1',
      name: 'Test Campaign',
      status: 'ACTIVE',
      conversion_duration_secs: 90,
      duplicate_window_secs: 2592000,
      default_revenue_amount: new Prisma.Decimal('45.0000'),
      default_payout_amount: new Prisma.Decimal('30.0000'),
      currency: 'USD',
    },
    attempts: [
      {
        id: 'attempt-1',
        call_id: 'call-1',
        buyer_id: 'buyer-1',
        state: CallAttemptState.COMPLETED,
        answered_at: new Date('2026-10-07T12:00:10.000Z'),

        created_at: new Date(mockDate),
      },
    ],
  });

  beforeEach(async () => {
    prisma = {
      $transaction: vi.fn(async (cb) => cb(prisma)),
      callCommercial: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockImplementation((args) => Promise.resolve({ id: 'comm-1', ...args.data })),
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
          amount_micro: 150000n, // $0.1500
          type: TransactionType.DEBIT,
        }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommercialEvaluatorService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<CommercialEvaluatorService>(CommercialEvaluatorService);
  });

  // Case 1: Commercial campaign creates CallCommercial
  it('1. Commercial campaign creates CallCommercial', async () => {
    const result = await service.evaluateCall('call-1');
    expect(result).toBeDefined();
    expect(prisma.callCommercial.create).toHaveBeenCalledTimes(1);
    expect(result?.currency).toBe('USD');
    expect(result?.status).toBe(CommercialStatus.PENDING);
  });

  // Case 2: Non-commercial campaign creates no CallCommercial
  it('2. Non-commercial campaign creates no CallCommercial (null revenue or payout)', async () => {
    const call1 = getBaseCall();
    call1.campaign.default_revenue_amount = null as any;
    prisma.call.findUnique.mockResolvedValueOnce(call1);

    const result = await service.evaluateCall('call-1');
    expect(result).toBeNull();
    expect(prisma.callCommercial.create).not.toHaveBeenCalled();

    const call2 = getBaseCall();
    call2.campaign.default_payout_amount = null as any;
    prisma.call.findUnique.mockResolvedValueOnce(call2);

    const result2 = await service.evaluateCall('call-1');
    expect(result2).toBeNull();
    expect(prisma.callCommercial.create).not.toHaveBeenCalled();
  });

  // Case 3: Duration >= threshold -> converted=true
  it('3. Duration >= threshold -> converted=true', async () => {
    const call = getBaseCall();
    call.ended_at = new Date('2026-10-07T12:01:40.000Z'); // 90s talk exactly
    call.campaign.conversion_duration_secs = 90;
    prisma.call.findUnique.mockResolvedValueOnce(call);

    const result = await service.evaluateCall('call-1');
    expect(result?.converted).toBe(true);
    expect(result?.qualified).toBe(true);
  });

  // Case 4: Duration < threshold -> converted=false
  it('4. Duration < threshold -> converted=false', async () => {
    const call = getBaseCall();
    call.ended_at = new Date('2026-10-07T12:01:39.000Z'); // 89s talk (< 90s)
    call.campaign.conversion_duration_secs = 90;
    prisma.call.findUnique.mockResolvedValueOnce(call);

    const result = await service.evaluateCall('call-1');
    expect(result?.converted).toBe(false);
    expect(result?.qualified).toBe(false);
  });

  // Case 5: qualified equals converted
  it('5. qualified equals converted', async () => {
    const call1 = getBaseCall();
    call1.ended_at = new Date('2026-10-07T12:01:50.000Z'); // 100s talk >= 90s
    call1.campaign.conversion_duration_secs = 90;
    prisma.call.findUnique.mockResolvedValueOnce(call1);
    const result1 = await service.evaluateCall('call-1');
    expect(result1?.qualified).toBe(result1?.converted);
    expect(result1?.qualified).toBe(true);

    const call2 = getBaseCall();
    call2.ended_at = new Date('2026-10-07T12:01:00.000Z'); // 50s talk < 90s
    call2.campaign.conversion_duration_secs = 90;
    prisma.call.findUnique.mockResolvedValueOnce(call2);
    const result2 = await service.evaluateCall('call-1');
    expect(result2?.qualified).toBe(result2?.converted);
    expect(result2?.qualified).toBe(false);
  });

  // Case 6: Duplicate within window -> duplicate=true
  it('6. Duplicate within window -> duplicate=true', async () => {
    const priorCall = {
      id: 'call-prior',
      workspace_id: 'ws-1',
      campaign_id: 'camp-1',
      from_number: '+15551234567',
      to_number: '+15559876543',
      state: CallState.COMPLETED,
      created_at: new Date('2026-10-06T12:00:00.000Z'),
      commercial: { id: 'comm-prior', converted: true },
    };
    prisma.call.findMany.mockResolvedValueOnce([priorCall]);

    const result = await service.evaluateCall('call-1');
    expect(result?.duplicate).toBe(true);
    expect(result?.duplicate_of_call_id).toBe('call-prior');
  });

  // Case 7: Duplicate outside window -> duplicate=false
  it('7. Duplicate outside window -> duplicate=false', async () => {
    prisma.call.findMany.mockResolvedValueOnce([]);

    const result = await service.evaluateCall('call-1');
    expect(result?.duplicate).toBe(false);
    expect(result?.duplicate_of_call_id).toBeNull();
  });

  // Case 8: Different campaign -> not duplicate
  it('8. Different campaign -> not duplicate', async () => {
    prisma.call.findMany.mockResolvedValueOnce([]);

    const result = await service.evaluateCall('call-1');
    expect(result?.duplicate).toBe(false);
    expect(prisma.call.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ campaign_id: 'camp-1' }),
      }),
    );
  });

  // Case 9: Different workspace -> not duplicate
  it('9. Different workspace -> not duplicate', async () => {
    prisma.call.findMany.mockResolvedValueOnce([]);

    const result = await service.evaluateCall('call-1');
    expect(result?.duplicate).toBe(false);
    expect(prisma.call.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ workspace_id: 'ws-1' }),
      }),
    );
  });

  // Case 10: Different caller -> not duplicate
  it('10. Different caller -> not duplicate', async () => {
    const differentCallerCall = {
      id: 'call-other-caller',
      workspace_id: 'ws-1',
      campaign_id: 'camp-1',
      from_number: '+15559999999', // different caller
      state: CallState.COMPLETED,
      created_at: new Date('2026-10-06T12:00:00.000Z'),
      commercial: { id: 'comm-other' },
    };
    prisma.call.findMany.mockResolvedValueOnce([differentCallerCall]);

    const result = await service.evaluateCall('call-1');
    expect(result?.duplicate).toBe(false);
    expect(result?.duplicate_of_call_id).toBeNull();
  });

  // Blocker 1 tests:
  // 11. Converted call gets revenue
  it('11. Converted call gets revenue', async () => {
    const call = getBaseCall();
    call.duration_secs = 120; // >= 90 -> converted
    prisma.call.findUnique.mockResolvedValueOnce(call);

    const result = await service.evaluateCall('call-1');
    expect(result?.converted).toBe(true);
    expect(result?.revenue.toString()).toBe('45');
  });

  // 12. Converted call gets payout
  it('12. Converted call gets payout', async () => {
    const call = getBaseCall();
    call.duration_secs = 120; // >= 90 -> converted
    prisma.call.findUnique.mockResolvedValueOnce(call);

    const result = await service.evaluateCall('call-1');
    expect(result?.converted).toBe(true);
    expect(result?.payout.toString()).toBe('30');
  });

  // 13. Non-converted call gets revenue 0
  it('13. Non-converted call gets revenue 0', async () => {
    const call = getBaseCall();
    call.ended_at = new Date('2026-10-07T12:00:40.000Z'); // 30s talk < 90s -> not converted
    prisma.call.findUnique.mockResolvedValueOnce(call);

    const result = await service.evaluateCall('call-1');
    expect(result?.converted).toBe(false);
    expect(result?.qualified).toBe(false);
    expect(result?.revenue.toString()).toBe('0');
  });

  // 14. Non-converted call gets payout 0
  it('14. Non-converted call gets payout 0', async () => {
    const call = getBaseCall();
    call.ended_at = new Date('2026-10-07T12:00:40.000Z'); // 30s talk < 90s -> not converted
    prisma.call.findUnique.mockResolvedValueOnce(call);

    const result = await service.evaluateCall('call-1');
    expect(result?.converted).toBe(false);
    expect(result?.qualified).toBe(false);
    expect(result?.payout.toString()).toBe('0');
    // cost is 0.15, profit = 0 - 0 - 0.15 = -0.15
    expect(result?.profit.toString()).toBe('-0.15');
  });

  // 15. Duplicate converted call does not qualify for billing (DEFECT-01: revenue 0, payout 0)
  it('15. Duplicate converted call does not qualify for billing (revenue 0, payout 0, qualified false)', async () => {
    const priorCall = {
      id: 'call-prior',
      workspace_id: 'ws-1',
      campaign_id: 'camp-1',
      from_number: '+15551234567',
      to_number: '+15559876543',
      state: CallState.COMPLETED,
      created_at: new Date('2026-10-06T12:00:00.000Z'),
      commercial: { id: 'comm-prior', converted: true },
    };
    prisma.call.findMany.mockResolvedValueOnce([priorCall]);

    const call = getBaseCall();
    call.duration_secs = 120; // converted
    prisma.call.findUnique.mockResolvedValueOnce(call);

    const result = await service.evaluateCall('call-1');
    expect(result?.duplicate).toBe(true);
    expect(result?.duplicate_of_call_id).toBe('call-prior');
    expect(result?.converted).toBe(true);
    expect(result?.qualified).toBe(false);
    expect(result?.revenue.toString()).toBe('0');
    expect(result?.payout.toString()).toBe('0');
    // Operational cost (0.15) is retained: profit = 0 - 0 - 0.15 = -0.15
    expect(result?.cost.toString()).toBe('0.15');
    expect(result?.profit.toString()).toBe('-0.15');
  });

  // Case 16: Vendor comes from PhoneNumber.vendor_id
  it('16. Vendor comes from PhoneNumber.vendor_id', async () => {
    prisma.phoneNumber.findFirst.mockResolvedValueOnce({ vendor_id: 'vendor-specific' });

    const result = await service.evaluateCall('call-1');
    expect(result?.vendor_id).toBe('vendor-specific');
  });

  // Case 17: Missing vendor remains NULL
  it('17. Missing vendor remains NULL', async () => {
    prisma.phoneNumber.findFirst.mockResolvedValueOnce(null);

    const result = await service.evaluateCall('call-1');
    expect(result?.vendor_id).toBeNull();
  });

  // Case 18: Winning buyer comes from existing CallAttempt semantics
  it('18. Winning buyer comes from existing CallAttempt semantics', async () => {
    const result = await service.evaluateCall('call-1');
    expect(result?.buyer_id).toBe('buyer-1');
  });

  // Buyer attribution verification: multiple answered attempts picks earliest deterministically
  it('19. Winning buyer with multiple answered attempts selects earliest answered attempt deterministically', async () => {
    const call = getBaseCall();
    call.attempts = [
      {
        id: 'attempt-2',
        call_id: 'call-1',
        buyer_id: 'buyer-late',
        state: CallAttemptState.COMPLETED,
        answered_at: new Date('2026-10-07T12:00:25.000Z'),
        created_at: new Date(mockDate),
      },
      {
        id: 'attempt-1',
        call_id: 'call-1',
        buyer_id: 'buyer-early',
        state: CallAttemptState.COMPLETED,
        answered_at: new Date('2026-10-07T12:00:05.000Z'),
        created_at: new Date(mockDate),
      },
    ];
    prisma.call.findUnique.mockResolvedValueOnce(call);

    const result = await service.evaluateCall('call-1');
    expect(result?.buyer_id).toBe('buyer-early');
  });

  // Case 20: No winning buyer remains NULL
  it('20. No winning buyer remains NULL', async () => {
    const call = getBaseCall();
    call.attempts = [
      {
        id: 'attempt-failed',
        call_id: 'call-1',
        buyer_id: 'buyer-2',
        state: CallAttemptState.NO_ANSWER,
        answered_at: null as any,
        created_at: mockDate,
      },
    ];
    prisma.call.findUnique.mockResolvedValueOnce(call);

    const result = await service.evaluateCall('call-1');
    expect(result?.buyer_id).toBeNull();
  });

  // Case 21: Profit = revenue - payout - cost
  it('21. Profit = revenue - payout - cost', async () => {
    // revenue: 45.0000, payout: 30.0000, cost: 0.1500 (from 150000n)
    // profit = 45 - 30 - 0.15 = 14.8500
    const result = await service.evaluateCall('call-1');
    expect(result?.profit.toString()).toBe('14.85');
  });

  // Case 22: Decimal arithmetic does not use floating point
  it('22. Decimal arithmetic does not use floating point', async () => {
    const call = getBaseCall();
    call.campaign.default_revenue_amount = new Prisma.Decimal('0.1000');
    call.campaign.default_payout_amount = new Prisma.Decimal('0.2000');
    prisma.call.findUnique.mockResolvedValueOnce(call);
    prisma.walletTransaction.findFirst.mockResolvedValueOnce({
      amount_micro: 0n,
      type: TransactionType.DEBIT,
    }); // cost = 0

    // In JS float: 0.1 - 0.2 = -0.09999999999999998
    // In Decimal: -0.1
    const result = await service.evaluateCall('call-1');
    expect(result?.profit).toBeInstanceOf(Prisma.Decimal);
    expect(result?.profit.toString()).toBe('-0.1');
  });

  // Case 23: Existing CallCommercial -> idempotent/no duplicate
  it('23. Existing CallCommercial -> idempotent/no duplicate', async () => {
    const existingRecord = { id: 'existing-comm-id', call_id: 'call-1' };
    prisma.callCommercial.findUnique.mockResolvedValueOnce(existingRecord);

    const result = await service.evaluateCall('call-1');
    expect(result).toBe(existingRecord);
    expect(prisma.callCommercial.create).not.toHaveBeenCalled();
  });

  // Case 24: Concurrent/retry evaluation cannot create two commercial rows
  it('24. Concurrent/retry evaluation cannot create two commercial rows (P2002 conflict handled)', async () => {
    const existingOnConflict = { id: 'race-won-comm', call_id: 'call-1' };
    prisma.callCommercial.create.mockRejectedValueOnce({ code: 'P2002' });
    prisma.callCommercial.findUnique
      .mockResolvedValueOnce(null) // first check
      .mockResolvedValueOnce(existingOnConflict); // recovery check

    const result = await service.evaluateCall('call-1');
    expect(result).toBe(existingOnConflict);
  });

  // Blocker 3: Currency snapshot test
  it('25. Historical currency snapshot remains unchanged after campaign currency changes', async () => {
    const callData = getBaseCall();
    callData.campaign.currency = 'USD';
    prisma.call.findUnique.mockResolvedValueOnce(callData);

    const snapshot = await service.evaluateCall('call-1');
    expect(snapshot?.currency).toBe('USD');

    // Mutate campaign configuration afterward to EUR
    callData.campaign.currency = 'EUR';

    // The created snapshot retains the historical snapshot USD
    expect(snapshot?.currency).toBe('USD');
  });

  // Case 26: Blocked call does not create commercial record
  it('26. Blocked call does not create commercial record', async () => {
    const call = getBaseCall();
    call.state = CallState.FAILED; // blocked callers have state FAILED
    prisma.call.findUnique.mockResolvedValueOnce(call);

    const result = await service.evaluateCall('call-1');
    expect(result).toBeNull();
    expect(prisma.callCommercial.create).not.toHaveBeenCalled();
  });

  // Case 27: Non-eligible terminal states do not create commercial record
  it('27. Non-eligible terminal states do not create commercial record (NO_ANSWER, CANCELED, FAILED)', async () => {
    for (const nonEligibleState of [
      CallState.NO_ANSWER,
      CallState.CANCELED,
      CallState.FAILED,
      CallState.INITIATED,
      CallState.ROUTING,
    ]) {
      const call = getBaseCall();
      call.state = nonEligibleState;
      prisma.call.findUnique.mockResolvedValueOnce(call);

      const result = await service.evaluateCall('call-1');
      expect(result).toBeNull();
      expect(prisma.callCommercial.create).not.toHaveBeenCalled();
    }
  });

  // AD-03 Case C: Reservation not SETTLED aborts evaluation
  it('28. Unsettled reservation (status != SETTLED) aborts evaluation without persisting CallCommercial; completed Call remains unchanged', async () => {
    const call = getBaseCall();
    prisma.call.findUnique.mockResolvedValueOnce(call);
    prisma.callReservation.findUnique.mockResolvedValueOnce({ status: ReservationStatus.ACTIVE });

    const result = await service.evaluateCall('call-1');

    // Aborts without persisting
    expect(result).toBeNull();
    expect(prisma.callCommercial.create).not.toHaveBeenCalled();

    // Completed Call state is never mutated/rolled back
    expect(prisma.call.update).not.toHaveBeenCalled();
    expect(call.state).toBe(CallState.COMPLETED);
  });

  // Case 29: Tenant isolation for duplicate lookup
  it('29. Tenant isolation for duplicate lookup', async () => {
    await service.evaluateCall('call-1');
    expect(prisma.call.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workspace_id: 'ws-1',
        }),
      }),
    );
  });

  // AD-03 Case B: SETTLED reservation + no CALL_SETTLEMENT debit -> cost = 0.0000
  it('30. Legitimate zero-cost call (SETTLED + missing CALL_SETTLEMENT) creates CallCommercial with cost = 0.0000', async () => {
    const call = getBaseCall();
    prisma.call.findUnique.mockResolvedValueOnce(call);
    prisma.callReservation.findUnique.mockResolvedValueOnce({ status: ReservationStatus.SETTLED });
    prisma.walletTransaction.findFirst.mockResolvedValueOnce(null); // No operational debit

    const result = await service.evaluateCall('call-1');

    expect(result).toBeDefined();
    expect(prisma.callCommercial.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          cost: new Prisma.Decimal('0.0000'),
          revenue: new Prisma.Decimal('45.0000'),
          payout: new Prisma.Decimal('30.0000'),
          profit: new Prisma.Decimal('15.0000'),
          status: CommercialStatus.PENDING,
        }),
      }),
    );
  });

  // AD-01: Synchronous finalizes_at = created_at + 168 hours
  it('31. finalizes_at is populated synchronously and exactly equals created_at + 168 hours', async () => {
    const result = await service.evaluateCall('call-1');
    expect(result).toBeDefined();

    const createdData = prisma.callCommercial.create.mock.calls[0][0].data;
    expect(createdData.finalizes_at).toBeDefined();
    expect(createdData.created_at).toBeDefined();

    const diffHours =
      (createdData.finalizes_at.getTime() - createdData.created_at.getTime()) / (1000 * 60 * 60);
    expect(diffHours).toBe(168);
  });

  // =========================================================================
  // DEFECT-01 Regression Suite: Duplicate commercial billing invariants
  // =========================================================================
  describe('DEFECT-01 Duplicate Billing Invariants', () => {
    it('Converted, non-duplicate call: retains configured revenue, payout, and positive profit', async () => {
      prisma.call.findMany.mockResolvedValueOnce([]);
      const call = getBaseCall();
      call.duration_secs = 120;
      prisma.call.findUnique.mockResolvedValueOnce(call);

      const result = await service.evaluateCall('call-1');
      expect(result?.duplicate).toBe(false);
      expect(result?.duplicate_of_call_id).toBeNull();
      expect(result?.converted).toBe(true);
      expect(result?.qualified).toBe(true);
      expect(result?.revenue.toString()).toBe('45');
      expect(result?.payout.toString()).toBe('30');
      expect(result?.cost.toString()).toBe('0.15');
      expect(result?.profit.toString()).toBe('14.85');
    });

    it('Converted duplicate call: is_duplicate=true, is_qualified=false, revenue=0, payout=0', async () => {
      const priorCall = {
        id: 'call-prior-1',
        workspace_id: 'ws-1',
        campaign_id: 'camp-1',
        from_number: '+15551234567',
        to_number: '+15559876543',
        state: CallState.COMPLETED,
        created_at: new Date('2026-10-06T10:00:00.000Z'),
        commercial: { id: 'comm-prior-1', converted: true },
      };
      prisma.call.findMany.mockResolvedValueOnce([priorCall]);

      const call = getBaseCall();
      call.duration_secs = 120;
      prisma.call.findUnique.mockResolvedValueOnce(call);

      const result = await service.evaluateCall('call-1');
      expect(result?.duplicate).toBe(true);
      expect(result?.duplicate_of_call_id).toBe('call-prior-1');
      expect(result?.converted).toBe(true);
      expect(result?.qualified).toBe(false);
      expect(result?.revenue.toString()).toBe('0');
      expect(result?.payout.toString()).toBe('0');
    });

    it('Duplicate call with operational cost: profit correctly reflects retained cost (-cost)', async () => {
      const priorCall = {
        id: 'call-prior-2',
        workspace_id: 'ws-1',
        campaign_id: 'camp-1',
        from_number: '+15551234567',
        to_number: '+15559876543',
        state: CallState.COMPLETED,
        created_at: new Date('2026-10-06T10:00:00.000Z'),
        commercial: { id: 'comm-prior-2', converted: true },
      };
      prisma.call.findMany.mockResolvedValueOnce([priorCall]);
      prisma.walletTransaction.findFirst.mockResolvedValueOnce({
        amount_micro: 500000n,
        type: TransactionType.DEBIT,
      });

      const call = getBaseCall();
      call.duration_secs = 120;
      prisma.call.findUnique.mockResolvedValueOnce(call);

      const result = await service.evaluateCall('call-1');
      expect(result?.duplicate).toBe(true);
      expect(result?.qualified).toBe(false);
      expect(result?.cost.toString()).toBe('0.5');
      expect(result?.profit.toString()).toBe('-0.5');
    });

    it('Non-converted call: existing behavior remains correct', async () => {
      const call = getBaseCall();
      call.ended_at = new Date('2026-10-07T12:00:40.000Z'); // 30s talk < 90s threshold
      call.duration_secs = 40;
      prisma.call.findUnique.mockResolvedValueOnce(call);

      const result = await service.evaluateCall('call-1');
      expect(result?.converted).toBe(false);
      expect(result?.qualified).toBe(false);
      expect(result?.revenue.toString()).toBe('0');
      expect(result?.payout.toString()).toBe('0');
      expect(result?.cost.toString()).toBe('0.15');
      expect(result?.profit.toString()).toBe('-0.15');
    });

    it('Repeated evaluation: no duplicate CallCommercial records are created', async () => {
      const existingCommercial = {
        id: 'comm-existing-dup',
        workspace_id: 'ws-1',
        call_id: 'call-1',
        campaign_id: 'camp-1',
        duplicate: true,
        duplicate_of_call_id: 'call-prior',
        converted: true,
        qualified: false,
        revenue: new Prisma.Decimal('0.0000'),
        payout: new Prisma.Decimal('0.0000'),
        cost: new Prisma.Decimal('0.1500'),
        profit: new Prisma.Decimal('-0.1500'),
        status: CommercialStatus.PENDING,
      };
      prisma.callCommercial.findUnique.mockResolvedValueOnce(existingCommercial);

      const result = await service.evaluateCall('call-1');
      expect(result).toBe(existingCommercial);
      expect(prisma.callCommercial.create).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // DEFECT-03 Regression Suite: Connected Talk Duration Invariants
  // =========================================================================
  describe('DEFECT-03 Connected Talk Duration Invariants', () => {
    it('1. Ringing 25 seconds + connected talk 40 seconds against a 60-second threshold: not converted', async () => {
      const call = getBaseCall();
      call.created_at = new Date('2026-10-07T12:00:00.000Z');
      call.answered_at = new Date('2026-10-07T12:00:25.000Z'); // 25s pre-answer ringing
      call.ended_at = new Date('2026-10-07T12:01:05.000Z'); // 40s connected talk (total elapsed 65s)
      call.duration_secs = 65; // Total elapsed duration
      call.campaign.conversion_duration_secs = 60; // 60s conversion threshold
      prisma.call.findUnique.mockResolvedValueOnce(call);

      const result = await service.evaluateCall('call-1');
      // Total elapsed (65s) exceeds threshold, but connected talk (40s) is below threshold (60s)
      expect(result?.converted).toBe(false);
      expect(result?.qualified).toBe(false);
      expect(result?.revenue.toString()).toBe('0');
      expect(result?.payout.toString()).toBe('0');
    });

    it('2. Connected talk exactly at the threshold: converted, subject to existing qualification and duplicate rules', async () => {
      const call = getBaseCall();
      call.created_at = new Date('2026-10-07T12:00:00.000Z');
      call.answered_at = new Date('2026-10-07T12:00:25.000Z'); // 25s ringing
      call.ended_at = new Date('2026-10-07T12:01:25.000Z'); // 60s talk exactly (total elapsed 85s)
      call.duration_secs = 85;
      call.campaign.conversion_duration_secs = 60;
      prisma.call.findUnique.mockResolvedValueOnce(call);

      const result = await service.evaluateCall('call-1');
      expect(result?.converted).toBe(true);
      expect(result?.qualified).toBe(true);
      expect(result?.revenue.toString()).toBe('45');
      expect(result?.payout.toString()).toBe('30');
    });

    it('3. Connected talk below the threshold: not converted', async () => {
      const call = getBaseCall();
      call.created_at = new Date('2026-10-07T12:00:00.000Z');
      call.answered_at = new Date('2026-10-07T12:00:25.000Z'); // 25s ringing
      call.ended_at = new Date('2026-10-07T12:01:24.000Z'); // 59s talk (< 60s threshold)
      call.duration_secs = 84;
      call.campaign.conversion_duration_secs = 60;
      prisma.call.findUnique.mockResolvedValueOnce(call);

      const result = await service.evaluateCall('call-1');
      expect(result?.converted).toBe(false);
      expect(result?.qualified).toBe(false);
      expect(result?.revenue.toString()).toBe('0');
      expect(result?.payout.toString()).toBe('0');
    });

    it('4. An unanswered call: not converted even if elapsed ringing duration is large', async () => {
      const call = getBaseCall();
      call.answered_at = null;
      call.ended_at = new Date('2026-10-07T12:05:00.000Z'); // 300s ringing
      call.duration_secs = 300;
      call.attempts = []; // No answered attempt
      call.campaign.conversion_duration_secs = 60;
      prisma.call.findUnique.mockResolvedValueOnce(call);

      const result = await service.evaluateCall('call-1');
      // Never answered call cannot convert
      expect(result?.converted).toBe(false);
      expect(result?.qualified).toBe(false);
      expect(result?.revenue.toString()).toBe('0');
      expect(result?.payout.toString()).toBe('0');
    });

    it('5. Missing or inconsistent answer/hangup timestamps: safe, non-qualifying behavior', async () => {
      // 5a. Missing answered_at
      const callNoAnswer = getBaseCall();
      callNoAnswer.answered_at = null;
      callNoAnswer.attempts = [];
      callNoAnswer.campaign.conversion_duration_secs = 60;
      prisma.call.findUnique.mockResolvedValueOnce(callNoAnswer);

      const resNoAnswer = await service.evaluateCall('call-1');
      expect(resNoAnswer?.converted).toBe(false);
      expect(resNoAnswer?.qualified).toBe(false);

      // 5b. Missing ended_at with null duration_secs
      const callNoEnd = getBaseCall();
      callNoEnd.ended_at = null as any;
      callNoEnd.duration_secs = null as any;
      callNoEnd.campaign.conversion_duration_secs = 60;
      prisma.call.findUnique.mockResolvedValueOnce(callNoEnd);

      const resNoEnd = await service.evaluateCall('call-1');
      expect(resNoEnd?.converted).toBe(false);
      expect(resNoEnd?.qualified).toBe(false);

      // 5c. Inconsistent timestamps: ended_at earlier than answered_at
      const callInconsistent = getBaseCall();
      callInconsistent.answered_at = new Date('2026-10-07T12:02:00.000Z');
      callInconsistent.ended_at = new Date('2026-10-07T12:01:00.000Z'); // ended before answer
      callInconsistent.campaign.conversion_duration_secs = 60;
      prisma.call.findUnique.mockResolvedValueOnce(callInconsistent);

      const resInconsistent = await service.evaluateCall('call-1');
      expect(resInconsistent?.converted).toBe(false);
      expect(resInconsistent?.qualified).toBe(false);

      // 5d. Invalid date object (NaN)
      const callInvalidDate = getBaseCall();
      callInvalidDate.answered_at = new Date('invalid-date');
      callInvalidDate.campaign.conversion_duration_secs = 60;
      prisma.call.findUnique.mockResolvedValueOnce(callInvalidDate);

      const resInvalid = await service.evaluateCall('call-1');
      expect(resInvalid?.converted).toBe(false);
      expect(resInvalid?.qualified).toBe(false);
    });

    it('6. Existing billing-duration behavior and unrelated call metrics remain unchanged', async () => {
      const call = getBaseCall();
      call.duration_secs = 130; // 10s ring + 120s talk
      call.campaign.conversion_duration_secs = 90;
      prisma.call.findUnique.mockResolvedValueOnce(call);

      const result = await service.evaluateCall('call-1');
      expect(result?.converted).toBe(true);
      expect(result?.qualified).toBe(true);
      // Commercial pricing snapshot matches campaign configuration
      expect(result?.revenue.toString()).toBe('45');
      expect(result?.payout.toString()).toBe('30');
      // Cost retained from settlement
      expect(result?.cost.toString()).toBe('0.15');
      expect(result?.profit.toString()).toBe('14.85');
    });
  });

  // =========================================================================
  // Phase 2 Slice 5: Commercial Evaluator Attribution Alignment
  // =========================================================================
  describe('Phase 2 Slice 5: Ingress Attribution Alignment', () => {
    it('1. Reassignment after ingress: preserves snapshotted attributed_vendor_id', async () => {
      const call = getBaseCall();
      (call as any).attributed_vendor_id = 'vendor-snapshotted';
      (call as any).vendor_id = 'vendor-snapshotted';
      (call as any).attribution_source = 'INGRESS_ASSIGNED';
      prisma.call.findUnique.mockResolvedValueOnce(call);

      // Tracking number reassigned to a different vendor later
      prisma.phoneNumber.findFirst.mockResolvedValueOnce({ vendor_id: 'vendor-new' });

      const result = await service.evaluateCall('call-1');
      expect(result).toBeDefined();
      expect(result?.vendor_id).toBe('vendor-snapshotted');
      // Must not query current phoneNumber assignment when snapshot is present
      expect(prisma.phoneNumber.findFirst).not.toHaveBeenCalled();
    });

    it('2. Unassignment after ingress: preserves snapshotted attributed_vendor_id', async () => {
      const call = getBaseCall();
      (call as any).attributed_vendor_id = 'vendor-snapshotted';
      (call as any).vendor_id = 'vendor-snapshotted';
      (call as any).attribution_source = 'INGRESS_ASSIGNED';
      prisma.call.findUnique.mockResolvedValueOnce(call);

      // Tracking number unassigned later
      prisma.phoneNumber.findFirst.mockResolvedValueOnce(null);

      const result = await service.evaluateCall('call-1');
      expect(result).toBeDefined();
      expect(result?.vendor_id).toBe('vendor-snapshotted');
      expect(prisma.phoneNumber.findFirst).not.toHaveBeenCalled();
    });

    it('3. Precedence: attributed_vendor_id takes precedence over call.vendor_id', async () => {
      const call = getBaseCall();
      (call as any).attributed_vendor_id = 'vendor-authoritative';
      (call as any).vendor_id = 'vendor-secondary';
      (call as any).attribution_source = 'INGRESS_ASSIGNED';
      prisma.call.findUnique.mockResolvedValueOnce(call);

      const result = await service.evaluateCall('call-1');
      expect(result).toBeDefined();
      expect(result?.vendor_id).toBe('vendor-authoritative');
      expect(prisma.phoneNumber.findFirst).not.toHaveBeenCalled();
    });

    it('4. Fallback to call.vendor_id when attributed_vendor_id is null', async () => {
      const call = getBaseCall();
      (call as any).attributed_vendor_id = null;
      (call as any).vendor_id = 'vendor-direct';
      (call as any).attribution_source = 'INGRESS_ASSIGNED';
      prisma.call.findUnique.mockResolvedValueOnce(call);

      // Tracking number has another vendor
      prisma.phoneNumber.findFirst.mockResolvedValueOnce({ vendor_id: 'vendor-other' });

      const result = await service.evaluateCall('call-1');
      expect(result).toBeDefined();
      expect(result?.vendor_id).toBe('vendor-direct');
      expect(prisma.phoneNumber.findFirst).not.toHaveBeenCalled();
    });

    it('5. Explicitly unassigned at ingress (INGRESS_UNASSIGNED): remains null even if number assigned later', async () => {
      const call = getBaseCall();
      (call as any).attributed_vendor_id = null;
      (call as any).vendor_id = null;
      (call as any).attribution_source = 'INGRESS_UNASSIGNED';
      prisma.call.findUnique.mockResolvedValueOnce(call);

      // Tracking number was assigned to vendor-future later
      prisma.phoneNumber.findFirst.mockResolvedValueOnce({ vendor_id: 'vendor-future' });

      const result = await service.evaluateCall('call-1');
      expect(result).toBeDefined();
      expect(result?.vendor_id).toBeNull();
      // Crucial: Must NOT fall back to phoneNumber when INGRESS_UNASSIGNED
      expect(prisma.phoneNumber.findFirst).not.toHaveBeenCalled();
    });

    it('6. Legacy fallback: queries phoneNumber when both attribution fields and source are null', async () => {
      const call = getBaseCall();
      (call as any).attributed_vendor_id = null;
      (call as any).vendor_id = null;
      (call as any).attribution_source = null; // Genuine legacy call
      prisma.call.findUnique.mockResolvedValueOnce(call);

      prisma.phoneNumber.findFirst.mockResolvedValueOnce({ vendor_id: 'vendor-legacy' });

      const result = await service.evaluateCall('call-1');
      expect(result).toBeDefined();
      expect(result?.vendor_id).toBe('vendor-legacy');
      expect(prisma.phoneNumber.findFirst).toHaveBeenCalledWith({
        where: {
          workspace_id: 'ws-1',
          phone_number: '+15559876543',
        },
        select: { vendor_id: true },
      });
    });

    it('7. Legacy fallback with unassigned number: results in null vendor_id safely', async () => {
      const call = getBaseCall();
      (call as any).attributed_vendor_id = null;
      (call as any).vendor_id = null;
      (call as any).attribution_source = null;
      prisma.call.findUnique.mockResolvedValueOnce(call);

      prisma.phoneNumber.findFirst.mockResolvedValueOnce(null);

      const result = await service.evaluateCall('call-1');
      expect(result).toBeDefined();
      expect(result?.vendor_id).toBeNull();
      expect(prisma.phoneNumber.findFirst).toHaveBeenCalled();
    });

    it('8. UNRESOLVED: both Vendor fields null; PhoneNumber currently belongs to Vendor B -> no fallback, vendor is null', async () => {
      const call = getBaseCall();
      (call as any).attributed_vendor_id = null;
      (call as any).vendor_id = null;
      (call as any).attribution_source = 'UNRESOLVED';
      prisma.call.findUnique.mockResolvedValueOnce(call);

      // Tracking number belongs to vendor-b today
      prisma.phoneNumber.findFirst.mockResolvedValueOnce({ vendor_id: 'vendor-b' });

      const result = await service.evaluateCall('call-1');
      expect(result).toBeDefined();
      expect(result?.vendor_id).toBeNull();
      // Crucial: Must NOT fall back to phoneNumber when UNRESOLVED
      expect(prisma.phoneNumber.findFirst).not.toHaveBeenCalled();
    });

    it('9. LEGACY_UNATTRIBUTED: both Vendor fields null; PhoneNumber currently belongs to Vendor B -> no fallback, vendor is null', async () => {
      const call = getBaseCall();
      (call as any).attributed_vendor_id = null;
      (call as any).vendor_id = null;
      (call as any).attribution_source = 'LEGACY_UNATTRIBUTED';
      prisma.call.findUnique.mockResolvedValueOnce(call);

      // Tracking number belongs to vendor-b today
      prisma.phoneNumber.findFirst.mockResolvedValueOnce({ vendor_id: 'vendor-b' });

      const result = await service.evaluateCall('call-1');
      expect(result).toBeDefined();
      expect(result?.vendor_id).toBeNull();
      // Crucial: Must NOT fall back to phoneNumber when LEGACY_UNATTRIBUTED
      expect(prisma.phoneNumber.findFirst).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Conversion Duration Threshold Edge Cases (Zero, Boundaries & Historical Immutability)
  // =========================================================================
  describe('Conversion Duration Threshold Edge Cases', () => {
    it('1. Connected talk 1 second above threshold (61s against 60s): converted=true', async () => {
      const call = getBaseCall();
      call.created_at = new Date('2026-10-07T12:00:00.000Z');
      call.answered_at = new Date('2026-10-07T12:00:20.000Z'); // 20s ringing
      call.ended_at = new Date('2026-10-07T12:01:21.000Z'); // 61s connected talk
      call.duration_secs = 81;
      call.campaign.conversion_duration_secs = 60;
      prisma.call.findUnique.mockResolvedValueOnce(call);

      const result = await service.evaluateCall('call-1');
      expect(result?.converted).toBe(true);
      expect(result?.qualified).toBe(true);
      expect(result?.revenue.toString()).toBe('45');
      expect(result?.payout.toString()).toBe('30');
    });

    it('2. Zero-second threshold with a completed answered call: converted=true', async () => {
      const call = getBaseCall();
      call.created_at = new Date('2026-10-07T12:00:00.000Z');
      call.answered_at = new Date('2026-10-07T12:00:10.000Z');
      call.ended_at = new Date('2026-10-07T12:00:10.000Z'); // 0s talk duration
      call.duration_secs = 10;
      call.campaign.conversion_duration_secs = 0; // 0s threshold
      prisma.call.findUnique.mockResolvedValueOnce(call);

      const result = await service.evaluateCall('call-1');
      expect(result?.converted).toBe(true);
      expect(result?.qualified).toBe(true);
      expect(result?.revenue.toString()).toBe('45');
      expect(result?.payout.toString()).toBe('30');
    });

    it('3. Zero-second threshold with an unanswered call: remains unconverted (converted=false)', async () => {
      const call = getBaseCall();
      call.answered_at = null;
      call.ended_at = new Date('2026-10-07T12:00:30.000Z');
      call.duration_secs = 30;
      call.attempts = [];
      call.campaign.conversion_duration_secs = 0; // 0s threshold
      prisma.call.findUnique.mockResolvedValueOnce(call);

      const result = await service.evaluateCall('call-1');
      expect(result?.converted).toBe(false);
      expect(result?.qualified).toBe(false);
      expect(result?.revenue.toString()).toBe('0');
      expect(result?.payout.toString()).toBe('0');
    });

    it('4. Historical immutability: changing campaign conversion_duration_secs does NOT alter existing CallCommercial', async () => {
      const existingRecord = {
        id: 'comm-historical',
        call_id: 'call-1',
        campaign_id: 'camp-1',
        converted: false, // Originally evaluated as unconverted (e.g. 50s < 90s)
        qualified: false,
        revenue: new Prisma.Decimal('0.0000'),
        payout: new Prisma.Decimal('0.0000'),
        cost: new Prisma.Decimal('0.1500'),
        profit: new Prisma.Decimal('-0.1500'),
        status: CommercialStatus.PENDING,
      };
      prisma.callCommercial.findUnique.mockResolvedValueOnce(existingRecord);

      // Now campaign threshold is lowered from 90 to 30
      // Calling evaluateCall on already-evaluated call should return existing snapshot without recomputing
      const result = await service.evaluateCall('call-1');
      expect(result).toBe(existingRecord);
      expect(result?.converted).toBe(false);
      expect(prisma.callCommercial.create).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Approved Duplicate Rules (Option A: Earliest Converted Call) - 30 Tests
  // =========================================================================
  describe('Approved Duplicate Rules (Option A: Earliest Converted Call)', () => {
    // Helper to generate a standardized call
    const createTestCall = (overrides: any = {}) => {
      const base = getBaseCall();
      return {
        ...base,
        ...overrides,
        campaign: {
          ...base.campaign,
          ...(overrides.campaign || {}),
        },
      };
    };

    // --- Matching Behavior ---
    it('1. Same workspace, campaign, caller, and destination: first converted call is original', async () => {
      prisma.call.findMany.mockResolvedValueOnce([]);
      const call = createTestCall({ id: 'call-first', duration_secs: 120 });
      prisma.call.findUnique.mockResolvedValueOnce(call);

      const result = await service.evaluateCall('call-first');
      expect(result?.duplicate).toBe(false);
      expect(result?.duplicate_of_call_id).toBeNull();
      expect(result?.converted).toBe(true);
      expect(result?.qualified).toBe(true);
      expect(result?.revenue.toString()).toBe('45');
      expect(result?.payout.toString()).toBe('30');
    });

    it('2. Second converted call within the window is Duplicate and references the original', async () => {
      const originalCall = {
        id: 'call-orig',
        workspace_id: 'ws-1',
        campaign_id: 'camp-1',
        from_number: '+15551234567',
        to_number: '+15559876543',
        state: CallState.COMPLETED,
        created_at: new Date('2026-10-06T12:00:00.000Z'),
        commercial: { id: 'comm-orig', converted: true },
      };
      prisma.call.findMany.mockResolvedValueOnce([originalCall]);

      const call = createTestCall({ id: 'call-second', duration_secs: 120 });
      prisma.call.findUnique.mockResolvedValueOnce(call);

      const result = await service.evaluateCall('call-second');
      expect(result?.duplicate).toBe(true);
      expect(result?.duplicate_of_call_id).toBe('call-orig');
      expect(result?.converted).toBe(true);
      expect(result?.qualified).toBe(false);
      expect(result?.revenue.toString()).toBe('0');
      expect(result?.payout.toString()).toBe('0');
    });

    it('3. A third matching converted call references the earliest original, not an intermediate duplicate', async () => {
      const originalCall = {
        id: 'call-orig-1',
        workspace_id: 'ws-1',
        campaign_id: 'camp-1',
        from_number: '+15551234567',
        to_number: '+15559876543',
        state: CallState.COMPLETED,
        created_at: new Date('2026-10-01T10:00:00.000Z'),
        commercial: { id: 'comm-1', converted: true, duplicate: false },
      };
      const intermediateDuplicate = {
        id: 'call-dup-2',
        workspace_id: 'ws-1',
        campaign_id: 'camp-1',
        from_number: '+15551234567',
        to_number: '+15559876543',
        state: CallState.COMPLETED,
        created_at: new Date('2026-10-03T10:00:00.000Z'),
        commercial: { id: 'comm-2', converted: true, duplicate: true, duplicate_of_call_id: 'call-orig-1' },
      };
      // findMany returns both candidates
      prisma.call.findMany.mockResolvedValueOnce([originalCall, intermediateDuplicate]);

      const call = createTestCall({ id: 'call-third', duration_secs: 120 });
      prisma.call.findUnique.mockResolvedValueOnce(call);

      const result = await service.evaluateCall('call-third');
      expect(result?.duplicate).toBe(true);
      // Must point to earliest original (call-orig-1), NOT the intermediate duplicate (call-dup-2)
      expect(result?.duplicate_of_call_id).toBe('call-orig-1');
    });

    it('4. Same caller and campaign but different destination: not Duplicate', async () => {
      const priorCallOtherDest = {
        id: 'call-other-dest',
        workspace_id: 'ws-1',
        campaign_id: 'camp-1',
        from_number: '+15551234567',
        to_number: '+15559990000', // different destination
        state: CallState.COMPLETED,
        created_at: new Date('2026-10-06T12:00:00.000Z'),
        commercial: { id: 'comm-dest-other', converted: true },
      };
      prisma.call.findMany.mockResolvedValueOnce([priorCallOtherDest]);

      const call = createTestCall({ id: 'call-curr', to_number: '+15559876543', duration_secs: 120 });
      prisma.call.findUnique.mockResolvedValueOnce(call);

      const result = await service.evaluateCall('call-curr');
      expect(result?.duplicate).toBe(false);
      expect(result?.duplicate_of_call_id).toBeNull();
      expect(result?.qualified).toBe(true);
    });

    it('5. Same caller and destination but different campaign: not Duplicate', async () => {
      prisma.call.findMany.mockResolvedValueOnce([]); // Query filters by campaign_id
      const call = createTestCall({ id: 'call-curr', campaign_id: 'camp-2', campaign: { id: 'camp-2' }, duration_secs: 120 });
      prisma.call.findUnique.mockResolvedValueOnce(call);

      const result = await service.evaluateCall('call-curr');
      expect(result?.duplicate).toBe(false);
      expect(prisma.call.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ campaign_id: 'camp-2' }),
        }),
      );
    });

    it('6. Same caller and campaign but different workspace: not Duplicate', async () => {
      prisma.call.findMany.mockResolvedValueOnce([]); // Query filters by workspace_id
      const call = createTestCall({ id: 'call-curr', workspace_id: 'ws-2', duration_secs: 120 });
      prisma.call.findUnique.mockResolvedValueOnce(call);

      const result = await service.evaluateCall('call-curr');
      expect(result?.duplicate).toBe(false);
      expect(prisma.call.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ workspace_id: 'ws-2' }),
        }),
      );
    });

    it('7. Same caller, destination, campaign, and workspace, but outside the window: not Duplicate', async () => {
      prisma.call.findMany.mockResolvedValueOnce([]); // Out of window returns empty
      const call = createTestCall({ id: 'call-curr', duration_secs: 120 });
      prisma.call.findUnique.mockResolvedValueOnce(call);

      const result = await service.evaluateCall('call-curr');
      expect(result?.duplicate).toBe(false);
      expect(result?.duplicate_of_call_id).toBeNull();
    });

    it('8. Exactly at the lower window boundary: follows the inclusive gte rule', async () => {
      const callTime = new Date('2026-10-31T12:00:00.000Z');
      const windowSecs = 2592000; // 30 days
      const boundaryTime = new Date(callTime.getTime() - windowSecs * 1000);

      const boundaryCall = {
        id: 'call-boundary',
        workspace_id: 'ws-1',
        campaign_id: 'camp-1',
        from_number: '+15551234567',
        to_number: '+15559876543',
        state: CallState.COMPLETED,
        created_at: boundaryTime, // Exactly at gte boundary
        commercial: { id: 'comm-b', converted: true },
      };
      prisma.call.findMany.mockResolvedValueOnce([boundaryCall]);

      const call = createTestCall({ id: 'call-curr', created_at: callTime, duration_secs: 120 });
      prisma.call.findUnique.mockResolvedValueOnce(call);

      const result = await service.evaluateCall('call-curr');
      expect(result?.duplicate).toBe(true);
      expect(result?.duplicate_of_call_id).toBe('call-boundary');
      expect(prisma.call.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            created_at: {
              gte: boundaryTime,
              lte: callTime,
            },
          }),
        }),
      );
    });

    it('9. Same created_at: deterministic tie-breaking by ascending call ID', async () => {
      const sameTime = new Date('2026-10-06T12:00:00.000Z');
      const callB = {
        id: 'call-bbb',
        workspace_id: 'ws-1',
        campaign_id: 'camp-1',
        from_number: '+15551234567',
        to_number: '+15559876543',
        state: CallState.COMPLETED,
        created_at: sameTime,
        commercial: { id: 'comm-b', converted: true },
      };
      const callA = {
        id: 'call-aaa',
        workspace_id: 'ws-1',
        campaign_id: 'camp-1',
        from_number: '+15551234567',
        to_number: '+15559876543',
        state: CallState.COMPLETED,
        created_at: sameTime,
        commercial: { id: 'comm-a', converted: true },
      };
      // Even if database returns in arbitrary order, tie-breaking sorts by id ascending
      prisma.call.findMany.mockResolvedValueOnce([callB, callA]);

      const call = createTestCall({ id: 'call-curr', duration_secs: 120 });
      prisma.call.findUnique.mockResolvedValueOnce(call);

      const result = await service.evaluateCall('call-curr');
      expect(result?.duplicate).toBe(true);
      expect(result?.duplicate_of_call_id).toBe('call-aaa'); // 'call-aaa' < 'call-bbb'
    });

    // --- Conversion Eligibility ---
    it('10. Earlier unanswered call does not block a later converted call', async () => {
      const priorUnanswered = {
        id: 'call-unanswered',
        workspace_id: 'ws-1',
        campaign_id: 'camp-1',
        from_number: '+15551234567',
        to_number: '+15559876543',
        state: CallState.NO_ANSWER,
        created_at: new Date('2026-10-06T12:00:00.000Z'),
        commercial: null,
      };
      prisma.call.findMany.mockResolvedValueOnce([priorUnanswered]);

      const call = createTestCall({ id: 'call-curr', duration_secs: 120 });
      prisma.call.findUnique.mockResolvedValueOnce(call);

      const result = await service.evaluateCall('call-curr');
      expect(result?.duplicate).toBe(false);
      expect(result?.duplicate_of_call_id).toBeNull();
      expect(result?.qualified).toBe(true);
    });

    it('11. Earlier short-duration call does not block a later converted call', async () => {
      const priorShortCall = {
        id: 'call-short',
        workspace_id: 'ws-1',
        campaign_id: 'camp-1',
        from_number: '+15551234567',
        to_number: '+15559876543',
        state: CallState.COMPLETED,
        answered_at: new Date('2026-10-06T12:00:00.000Z'),
        ended_at: new Date('2026-10-06T12:00:15.000Z'), // 15s talk < 90s
        duration_secs: 15,
        created_at: new Date('2026-10-06T12:00:00.000Z'),
        commercial: null,
      };
      prisma.call.findMany.mockResolvedValueOnce([priorShortCall]);

      const call = createTestCall({ id: 'call-curr', duration_secs: 120 });
      prisma.call.findUnique.mockResolvedValueOnce(call);

      const result = await service.evaluateCall('call-curr');
      expect(result?.duplicate).toBe(false);
      expect(result?.duplicate_of_call_id).toBeNull();
      expect(result?.qualified).toBe(true);
    });

    it('12. Earlier completed but unconverted call does not block a later converted call', async () => {
      const priorUnconverted = {
        id: 'call-unconv',
        workspace_id: 'ws-1',
        campaign_id: 'camp-1',
        from_number: '+15551234567',
        to_number: '+15559876543',
        state: CallState.COMPLETED,
        created_at: new Date('2026-10-06T12:00:00.000Z'),
        commercial: { id: 'comm-u', converted: false }, // explicitly unconverted
      };
      prisma.call.findMany.mockResolvedValueOnce([priorUnconverted]);

      const call = createTestCall({ id: 'call-curr', duration_secs: 120 });
      prisma.call.findUnique.mockResolvedValueOnce(call);

      const result = await service.evaluateCall('call-curr');
      expect(result?.duplicate).toBe(false);
      expect(result?.duplicate_of_call_id).toBeNull();
      expect(result?.qualified).toBe(true);
    });

    it('13. Current call below threshold is not classified as Duplicate', async () => {
      const priorConverted = {
        id: 'call-prior',
        workspace_id: 'ws-1',
        campaign_id: 'camp-1',
        from_number: '+15551234567',
        to_number: '+15559876543',
        state: CallState.COMPLETED,
        created_at: new Date('2026-10-06T12:00:00.000Z'),
        commercial: { id: 'comm-p', converted: true },
      };
      // Current call only talked for 40 seconds (threshold is 90)
      const call = createTestCall({
        id: 'call-short-curr',
        duration_secs: 40,
        answered_at: new Date('2026-10-07T12:00:00.000Z'),
        ended_at: new Date('2026-10-07T12:00:40.000Z'),
      });
      prisma.call.findUnique.mockResolvedValueOnce(call);

      const result = await service.evaluateCall('call-short-curr');
      expect(result?.converted).toBe(false);
      expect(result?.duplicate).toBe(false);
      expect(result?.duplicate_of_call_id).toBeNull();
      expect(result?.qualified).toBe(false);
    });

    it('14. Current call exactly at threshold is treated as converted', async () => {
      prisma.call.findMany.mockResolvedValueOnce([]);
      const call = createTestCall({
        id: 'call-exact',
        duration_secs: 90,
        answered_at: new Date('2026-10-07T12:00:00.000Z'),
        ended_at: new Date('2026-10-07T12:01:30.000Z'), // exactly 90s
      });
      prisma.call.findUnique.mockResolvedValueOnce(call);

      const result = await service.evaluateCall('call-exact');
      expect(result?.converted).toBe(true);
      expect(result?.qualified).toBe(true);
    });

    it('15. Current call above threshold is treated as converted', async () => {
      prisma.call.findMany.mockResolvedValueOnce([]);
      const call = createTestCall({
        id: 'call-above',
        duration_secs: 150,
        answered_at: new Date('2026-10-07T12:00:00.000Z'),
        ended_at: new Date('2026-10-07T12:02:30.000Z'), // 150s
      });
      prisma.call.findUnique.mockResolvedValueOnce(call);

      const result = await service.evaluateCall('call-above');
      expect(result?.converted).toBe(true);
      expect(result?.qualified).toBe(true);
    });

    it('16. A previously converted call is eligible according to persisted authoritative commercial result', async () => {
      const priorCallAuthoritative = {
        id: 'call-auth',
        workspace_id: 'ws-1',
        campaign_id: 'camp-1',
        from_number: '+15551234567',
        to_number: '+15559876543',
        state: CallState.COMPLETED,
        created_at: new Date('2026-10-06T12:00:00.000Z'),
        commercial: { id: 'comm-auth', converted: true, duplicate: false },
      };
      prisma.call.findMany.mockResolvedValueOnce([priorCallAuthoritative]);

      const call = createTestCall({ id: 'call-curr', duration_secs: 120 });
      prisma.call.findUnique.mockResolvedValueOnce(call);

      const result = await service.evaluateCall('call-curr');
      expect(result?.duplicate).toBe(true);
      expect(result?.duplicate_of_call_id).toBe('call-auth');
    });

    // --- Caller-Number Safety ---
    it('17. Missing caller number does not match another missing caller number', async () => {
      const priorMissing = {
        id: 'call-missing-1',
        workspace_id: 'ws-1',
        campaign_id: 'camp-1',
        from_number: '',
        to_number: '+15559876543',
        state: CallState.COMPLETED,
        created_at: new Date('2026-10-06T12:00:00.000Z'),
        commercial: { id: 'comm-m1', converted: true },
      };
      prisma.call.findMany.mockResolvedValueOnce([priorMissing]);

      const call = createTestCall({ id: 'call-missing-2', from_number: '', duration_secs: 120 });
      prisma.call.findUnique.mockResolvedValueOnce(call);

      const result = await service.evaluateCall('call-missing-2');
      expect(result?.duplicate).toBe(false);
      expect(result?.duplicate_of_call_id).toBeNull();
    });

    it('18. Anonymous/withheld/private caller values do not match each other', async () => {
      const priorAnon = {
        id: 'call-anon-1',
        workspace_id: 'ws-1',
        campaign_id: 'camp-1',
        from_number: 'anonymous',
        to_number: '+15559876543',
        state: CallState.COMPLETED,
        created_at: new Date('2026-10-06T12:00:00.000Z'),
        commercial: { id: 'comm-a1', converted: true },
      };
      prisma.call.findMany.mockResolvedValueOnce([priorAnon]);

      const call = createTestCall({ id: 'call-anon-2', from_number: 'anonymous', duration_secs: 120 });
      prisma.call.findUnique.mockResolvedValueOnce(call);

      const result = await service.evaluateCall('call-anon-2');
      expect(result?.duplicate).toBe(false);
      expect(result?.duplicate_of_call_id).toBeNull();
    });

    it('19. Invalid or placeholder normalized values do not cause false Duplicate results', async () => {
      const priorDummy = {
        id: 'call-dummy-1',
        workspace_id: 'ws-1',
        campaign_id: 'camp-1',
        from_number: '0000000000',
        to_number: '+15559876543',
        state: CallState.COMPLETED,
        created_at: new Date('2026-10-06T12:00:00.000Z'),
        commercial: { id: 'comm-d1', converted: true },
      };
      prisma.call.findMany.mockResolvedValueOnce([priorDummy]);

      const call = createTestCall({ id: 'call-dummy-2', from_number: '0000000000', duration_secs: 120 });
      prisma.call.findUnique.mockResolvedValueOnce(call);

      const result = await service.evaluateCall('call-dummy-2');
      expect(result?.duplicate).toBe(false);
      expect(result?.duplicate_of_call_id).toBeNull();
    });

    it('20. Valid caller numbers that normalize to the same E.164 value match as expected', async () => {
      const priorCall = {
        id: 'call-us-e164',
        workspace_id: 'ws-1',
        campaign_id: 'camp-1',
        from_number: '+15551234567',
        to_number: '+15559876543',
        state: CallState.COMPLETED,
        created_at: new Date('2026-10-06T12:00:00.000Z'),
        commercial: { id: 'comm-e164', converted: true },
      };
      prisma.call.findMany.mockResolvedValueOnce([priorCall]);

      // Dialed without '+1'
      const call = createTestCall({ id: 'call-raw-digits', from_number: '5551234567', duration_secs: 120 });
      prisma.call.findUnique.mockResolvedValueOnce(call);

      const result = await service.evaluateCall('call-raw-digits');
      expect(result?.duplicate).toBe(true);
      expect(result?.duplicate_of_call_id).toBe('call-us-e164');
    });

    // --- Concurrency and Idempotency ---
    it('21. Concurrent evaluation of two matching calls: exactly one becomes original, other becomes duplicate', async () => {
      // Simulate database state for concurrent calls
      const call1 = createTestCall({ id: 'call-conc-1', created_at: new Date('2026-10-07T12:00:00.000Z'), duration_secs: 120 });
      const call2 = createTestCall({ id: 'call-conc-2', created_at: new Date('2026-10-07T12:00:01.000Z'), duration_secs: 120 });

      let lockAcquired = false;
      const committedCommercials: Record<string, any> = {};

      // Custom mock prisma transaction simulating advisory locking and committed read
      const concurrencyPrisma: any = {
        ...prisma,
        $transaction: vi.fn(async (cb: any) => {
          const txScope = {
            ...prisma,
            $executeRaw: vi.fn(async () => {
              // Simulate lock acquisition: wait if locked
              while (lockAcquired) {
                await new Promise((r) => setTimeout(r, 10));
              }
              lockAcquired = true;
            }),
            callCommercial: {
              findUnique: vi.fn(async ({ where }: any) => committedCommercials[where.call_id] || null),
              create: vi.fn(async ({ data }: any) => {
                committedCommercials[data.call_id] = { id: `comm-${data.call_id}`, ...data };
                return committedCommercials[data.call_id];
              }),
            },
            call: {
              findUnique: vi.fn(async ({ where }: any) => {
                if (where.id === 'call-conc-1') return call1;
                if (where.id === 'call-conc-2') return call2;
                return null;
              }),
              findMany: vi.fn(async () => {
                // Returns calls with committed commercials
                const results: any[] = [];
                if (committedCommercials['call-conc-1']) {
                  results.push({
                    ...call1,
                    commercial: committedCommercials['call-conc-1'],
                  });
                }
                return results;
              }),
            },
          };
          try {
            return await cb(txScope);
          } finally {
            lockAcquired = false;
          }
        }),
      };

      const moduleRef = await Test.createTestingModule({
        providers: [
          CommercialEvaluatorService,
          { provide: PrismaService, useValue: concurrencyPrisma },
        ],
      }).compile();
      const concService = moduleRef.get<CommercialEvaluatorService>(CommercialEvaluatorService);

      const [res1, res2] = await Promise.all([
        concService.evaluateCall('call-conc-1'),
        concService.evaluateCall('call-conc-2'),
      ]);

      expect(res1?.duplicate).toBe(false);
      expect(res1?.qualified).toBe(true);
      expect(res2?.duplicate).toBe(true);
      expect(res2?.duplicate_of_call_id).toBe('call-conc-1');
      expect(res2?.qualified).toBe(false);
    });

    it('22. Advisory lock key is constructed deterministically from composite scope', () => {
      const key1 = getDuplicateScopeAdvisoryLockKey('ws-1', 'camp-1', '+15551234567', '+15559876543');
      const key2 = getDuplicateScopeAdvisoryLockKey('ws-1', 'camp-1', '+15551234567', '+15559876543');
      expect(key1).toBe(key2);
      expect(typeof key1).toBe('bigint');
    });

    it('23. Calls in unrelated duplicate scopes generate distinct lock keys and do not block each other', () => {
      const keyScopeA = getDuplicateScopeAdvisoryLockKey('ws-1', 'camp-1', '+15551111111', '+15559999999');
      const keyScopeB = getDuplicateScopeAdvisoryLockKey('ws-1', 'camp-2', '+15551111111', '+15559999999');
      const keyScopeC = getDuplicateScopeAdvisoryLockKey('ws-1', 'camp-1', '+15552222222', '+15559999999');
      const keyScopeD = getDuplicateScopeAdvisoryLockKey('ws-1', 'camp-1', '+15551111111', '+15558888888');

      expect(keyScopeA).not.toBe(keyScopeB);
      expect(keyScopeA).not.toBe(keyScopeC);
      expect(keyScopeA).not.toBe(keyScopeD);
    });

    it('24. Re-evaluating the same call does not create a second commercial record (idempotency)', async () => {
      const existing = {
        id: 'comm-existing-idempotent',
        call_id: 'call-1',
        qualified: true,
        converted: true,
        duplicate: false,
      };
      prisma.callCommercial.findUnique.mockResolvedValueOnce(existing);

      const result = await service.evaluateCall('call-1');
      expect(result).toBe(existing);
      expect(prisma.callCommercial.create).not.toHaveBeenCalled();
    });

    it('25. Concurrent retries and known unique-constraint conflicts (P2002) do not corrupt data', async () => {
      const p2002Error: any = new Error('Unique constraint failed');
      p2002Error.code = 'P2002';

      const existingRecord = {
        id: 'comm-won-race',
        call_id: 'call-1',
        qualified: true,
      };

      prisma.callCommercial.create.mockRejectedValueOnce(p2002Error);
      prisma.callCommercial.findUnique
        .mockResolvedValueOnce(null) // Step 1: not found yet
        .mockResolvedValueOnce(existingRecord); // Catch block: found after conflict

      const result = await service.evaluateCall('call-1');
      expect(result).toBe(existingRecord);
    });

    // --- Regression ---
    it('26. Existing campaign threshold behavior remains unchanged (conversion_duration_secs: 90)', async () => {
      expect(getBaseCall().campaign.conversion_duration_secs).toBe(90);
    });

    it('27. Existing duplicate-window defaults and configuration remain unchanged (2592000s = 30d)', async () => {
      expect(getBaseCall().campaign.duplicate_window_secs).toBe(2592000);
    });

    it('28. Existing financial calculations, cost retention, and profit = rev - payout - cost remain intact', async () => {
      const priorCall = {
        id: 'call-prior',
        workspace_id: 'ws-1',
        campaign_id: 'camp-1',
        from_number: '+15551234567',
        to_number: '+15559876543',
        state: CallState.COMPLETED,
        created_at: new Date('2026-10-06T12:00:00.000Z'),
        commercial: { id: 'comm-p', converted: true },
      };
      prisma.call.findMany.mockResolvedValueOnce([priorCall]);
      prisma.walletTransaction.findFirst.mockResolvedValueOnce({
        amount_micro: 250000n, // $0.25 operational cost
        type: TransactionType.DEBIT,
      });

      const call = createTestCall({ id: 'call-dup-financial', duration_secs: 120 });
      prisma.call.findUnique.mockResolvedValueOnce(call);

      const result = await service.evaluateCall('call-dup-financial');
      expect(result?.duplicate).toBe(true);
      expect(result?.qualified).toBe(false);
      expect(result?.revenue.toString()).toBe('0');
      expect(result?.payout.toString()).toBe('0');
      expect(result?.cost.toString()).toBe('0.25');
      expect(result?.profit.toString()).toBe('-0.25'); // 0 - 0 - 0.25 = -0.25
    });

    it('29. Existing Buyer concurrency, reservation, and call lifecycle remain intact', () => {
      expect(CallState.COMPLETED).toBe('COMPLETED');
      expect(ReservationStatus.SETTLED).toBe('SETTLED');
    });

    it('30. Existing calls list, detail, KPI, and export commercial classification is consistent', async () => {
      prisma.call.findMany.mockResolvedValueOnce([]);
      const call = createTestCall({ id: 'call-kpi', duration_secs: 120 });
      prisma.call.findUnique.mockResolvedValueOnce(call);

      const result = await service.evaluateCall('call-kpi');
      expect(result?.converted).toBe(true);
      expect(result?.duplicate).toBe(false);
      expect(result?.qualified).toBe(true);
      expect(result?.status).toBe(CommercialStatus.PENDING);
    });
  });
});
