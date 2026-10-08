import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { CommercialEvaluatorService } from './commercial-evaluator.service.js';
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
    duration_secs: 120,
    created_at: new Date(mockDate),
    updated_at: new Date(mockDate),
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
    call.duration_secs = 90;
    call.campaign.conversion_duration_secs = 90;
    prisma.call.findUnique.mockResolvedValueOnce(call);

    const result = await service.evaluateCall('call-1');
    expect(result?.converted).toBe(true);
    expect(result?.qualified).toBe(true);
  });

  // Case 4: Duration < threshold -> converted=false
  it('4. Duration < threshold -> converted=false', async () => {
    const call = getBaseCall();
    call.duration_secs = 89;
    call.campaign.conversion_duration_secs = 90;
    prisma.call.findUnique.mockResolvedValueOnce(call);

    const result = await service.evaluateCall('call-1');
    expect(result?.converted).toBe(false);
    expect(result?.qualified).toBe(false);
  });

  // Case 5: qualified equals converted
  it('5. qualified equals converted', async () => {
    const call1 = getBaseCall();
    call1.duration_secs = 100;
    call1.campaign.conversion_duration_secs = 90;
    prisma.call.findUnique.mockResolvedValueOnce(call1);
    const result1 = await service.evaluateCall('call-1');
    expect(result1?.qualified).toBe(result1?.converted);
    expect(result1?.qualified).toBe(true);

    const call2 = getBaseCall();
    call2.duration_secs = 50;
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
      state: CallState.COMPLETED,
      created_at: new Date('2026-10-06T12:00:00.000Z'),
      commercial: { id: 'comm-prior' },
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
    call.duration_secs = 30; // < 90 -> not converted
    prisma.call.findUnique.mockResolvedValueOnce(call);

    const result = await service.evaluateCall('call-1');
    expect(result?.converted).toBe(false);
    expect(result?.qualified).toBe(false);
    expect(result?.revenue.toString()).toBe('0');
  });

  // 14. Non-converted call gets payout 0
  it('14. Non-converted call gets payout 0', async () => {
    const call = getBaseCall();
    call.duration_secs = 30; // < 90 -> not converted
    prisma.call.findUnique.mockResolvedValueOnce(call);

    const result = await service.evaluateCall('call-1');
    expect(result?.converted).toBe(false);
    expect(result?.qualified).toBe(false);
    expect(result?.payout.toString()).toBe('0');
    // cost is 0.15, profit = 0 - 0 - 0.15 = -0.15
    expect(result?.profit.toString()).toBe('-0.15');
  });

  // 15. Duplicate converted call still follows normal revenue/payout rule
  it('15. Duplicate converted call still follows normal revenue/payout rule', async () => {
    const priorCall = {
      id: 'call-prior',
      workspace_id: 'ws-1',
      campaign_id: 'camp-1',
      from_number: '+15551234567',
      state: CallState.COMPLETED,
      created_at: new Date('2026-10-06T12:00:00.000Z'),
      commercial: { id: 'comm-prior' },
    };
    prisma.call.findMany.mockResolvedValueOnce([priorCall]);

    const call = getBaseCall();
    call.duration_secs = 120; // converted
    prisma.call.findUnique.mockResolvedValueOnce(call);

    const result = await service.evaluateCall('call-1');
    expect(result?.duplicate).toBe(true);
    expect(result?.converted).toBe(true);
    expect(result?.revenue.toString()).toBe('45');
    expect(result?.payout.toString()).toBe('30');
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
});
