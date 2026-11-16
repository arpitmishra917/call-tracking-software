import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReservationRecoveryService } from './reservation-recovery.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { WalletService } from '../billing/wallet.service.js';
import { UsageBillingService } from '../billing/usage-billing.service.js';
import type { TelephonyProvider } from './telephony.provider.js';
import { TelnyxProvider } from './telnyx/telnyx.provider.js';

describe('ReservationRecoveryService Unit Tests', () => {
  let service: ReservationRecoveryService;
  let prisma: any;
  let walletService: any;
  let usageBillingService: any;
  let provider: any;

  beforeEach(() => {
    prisma = {
      callReservation: {
        findMany: vi.fn(),
        update: vi.fn(),
      },
      buyerReservation: {
        updateMany: vi.fn(),
      },
      call: {
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      phoneNumber: {
        findFirst: vi.fn(),
      },
    };

    walletService = {
      releaseReservation: vi.fn().mockResolvedValue(undefined),
      settleReservation: vi.fn().mockResolvedValue(undefined),
    };

    usageBillingService = {
      billCallUsage: vi.fn().mockResolvedValue(undefined),
    };

    provider = {
      getCallStatus: vi.fn(),
    };

    service = new ReservationRecoveryService(
      prisma as unknown as PrismaService,
      walletService as unknown as WalletService,
      usageBillingService as unknown as UsageBillingService,
      provider as unknown as TelephonyProvider,
    );
  });

  it('1. provider ACTIVE -> refreshes heartbeat and does not release or settle', async () => {
    prisma.call.findUnique.mockResolvedValue({
      id: 'call-1',
      workspace_id: 'ws-1',
      provider_call_id: 'prov-call-1',
      state: 'ROUTING',
      created_at: new Date(),
      callReservation: {
        status: 'ACTIVE',
      },
    });
    provider.getCallStatus.mockResolvedValue('ACTIVE');

    await service.reconcileReservation('call-1');

    expect(prisma.callReservation.update).toHaveBeenCalledWith({
      where: { call_id: 'call-1' },
      data: { updated_at: expect.any(Date) },
    });
    expect(walletService.releaseReservation).not.toHaveBeenCalled();
    expect(usageBillingService.billCallUsage).not.toHaveBeenCalled();
    expect(service.getRetryState('call-1')).toBeUndefined();
  });

  it('2. provider NOT_FOUND + non-terminal local state -> defers without release or completion', async () => {
    prisma.call.findUnique.mockResolvedValue({
      id: 'call-2',
      workspace_id: 'ws-1',
      provider_call_id: 'prov-call-2',
      state: 'ROUTING',
      created_at: new Date(),
      callReservation: {
        status: 'ACTIVE',
      },
    });
    provider.getCallStatus.mockResolvedValue('NOT_FOUND');

    await service.reconcileReservation('call-2');

    expect(prisma.call.update).not.toHaveBeenCalled();
    expect(walletService.releaseReservation).not.toHaveBeenCalled();
    expect(usageBillingService.billCallUsage).not.toHaveBeenCalled();
    
    // Scheduled retry for anomaly
    const retry = service.getRetryState('call-2');
    expect(retry).toBeDefined();
    expect(retry?.lastResult).toBe('ANOMALY');
    expect(retry?.attemptCount).toBe(1);
  });

  it('3. provider NOT_FOUND + local NO_ANSWER -> recognizes terminal state, releases reservation without debit', async () => {
    prisma.call.findUnique.mockResolvedValue({
      id: 'call-3',
      workspace_id: 'ws-1',
      provider_call_id: 'prov-call-3',
      state: 'NO_ANSWER',
      created_at: new Date(),
      answered_at: null,
      callReservation: {
        status: 'ACTIVE',
      },
    });
    provider.getCallStatus.mockResolvedValue('NOT_FOUND');

    await service.reconcileReservation('call-3');

    // Should release reservation, NOT bill usage
    expect(walletService.releaseReservation).toHaveBeenCalledWith('ws-1', 'call-3');
    expect(prisma.buyerReservation.updateMany).toHaveBeenCalledWith({
      where: { call_id: 'call-3', status: 'ACTIVE' },
      data: { status: 'RELEASED' },
    });
    expect(usageBillingService.billCallUsage).not.toHaveBeenCalled();
    expect(service.getRetryState('call-3')).toBeUndefined();
  });

  it('4. provider TERMINAL + unanswered call (answered_at == null) -> cancels call and releases reservation', async () => {
    prisma.call.findUnique.mockResolvedValue({
      id: 'call-4',
      workspace_id: 'ws-1',
      provider_call_id: 'prov-call-4',
      state: 'RINGING',
      created_at: new Date(),
      answered_at: null,
      callReservation: {
        status: 'ACTIVE',
      },
    });
    provider.getCallStatus.mockResolvedValue('TERMINAL');

    await service.reconcileReservation('call-4');

    // Call state updated to CANCELED
    expect(prisma.call.update).toHaveBeenCalledWith({
      where: { id: 'call-4' },
      data: {
        state: 'CANCELED',
        ended_at: expect.any(Date),
      },
    });
    // Reservation released
    expect(walletService.releaseReservation).toHaveBeenCalledWith('ws-1', 'call-4');
    expect(prisma.buyerReservation.updateMany).toHaveBeenCalledWith({
      where: { call_id: 'call-4', status: 'ACTIVE' },
      data: { status: 'RELEASED' },
    });
    // Never billed
    expect(usageBillingService.billCallUsage).not.toHaveBeenCalled();
    expect(service.getRetryState('call-4')).toBeUndefined();
  });

  it('5. provider TERMINAL + answered call -> marks COMPLETED and bills usage', async () => {
    const started = new Date(Date.now() - 60000);
    const answered = new Date(Date.now() - 50000);
    const ended = new Date(Date.now() - 10000);

    prisma.call.findUnique.mockResolvedValue({
      id: 'call-5',
      workspace_id: 'ws-1',
      provider_call_id: 'prov-call-5',
      to_number: '+1234567890',
      state: 'ROUTING',
      created_at: new Date(),
      started_at: started,
      answered_at: answered,
      ended_at: ended,
      callReservation: {
        status: 'ACTIVE',
      },
    });
    prisma.phoneNumber.findFirst.mockResolvedValue({ number_type: 'local' });
    provider.getCallStatus.mockResolvedValue('TERMINAL');

    await service.reconcileReservation('call-5');

    // Call updated to COMPLETED
    expect(prisma.call.update).toHaveBeenCalledWith({
      where: { id: 'call-5' },
      data: {
        state: 'COMPLETED',
        ended_at: ended,
      },
    });
    // Usage billed
    expect(usageBillingService.billCallUsage).toHaveBeenCalledWith(
      'ws-1',
      'call-5',
      'local',
      40, // 50s ago to 10s ago = 40 seconds
    );
    // Buyer reservations released
    expect(prisma.buyerReservation.updateMany).toHaveBeenCalledWith({
      where: { call_id: 'call-5', status: 'ACTIVE' },
      data: { status: 'RELEASED' },
    });
    expect(service.getRetryState('call-5')).toBeUndefined();
  });

  it('6. already SETTLED or RELEASED reservation -> safely no-ops', async () => {
    prisma.call.findUnique.mockResolvedValue({
      id: 'call-6',
      workspace_id: 'ws-1',
      provider_call_id: 'prov-call-6',
      state: 'COMPLETED',
      created_at: new Date(),
      callReservation: {
        status: 'SETTLED',
      },
    });

    await service.reconcileReservation('call-6');

    expect(provider.getCallStatus).not.toHaveBeenCalled();
    expect(walletService.releaseReservation).not.toHaveBeenCalled();
    expect(usageBillingService.billCallUsage).not.toHaveBeenCalled();
  });

  // --- NEW TESTS FOR SPECIFIC INVESTIGATION REQUIREMENTS ---

  it('7. UNKNOWN status remains financially fail-closed: no release, no billing, schedules retry', async () => {
    prisma.call.findUnique.mockResolvedValue({
      id: 'call-unknown-1',
      workspace_id: 'ws-1',
      provider_call_id: 'v3:real-telnyx-call-id',
      state: 'ROUTING',
      created_at: new Date(),
      callReservation: {
        status: 'ACTIVE',
      },
    });
    provider.getCallStatus.mockResolvedValue('UNKNOWN');

    await service.reconcileReservation('call-unknown-1');

    // Fail-closed verification
    expect(walletService.releaseReservation).not.toHaveBeenCalled();
    expect(usageBillingService.billCallUsage).not.toHaveBeenCalled();
    expect(prisma.call.update).not.toHaveBeenCalled();

    // Verification that retry was scheduled
    const retry = service.getRetryState('call-unknown-1');
    expect(retry).toBeDefined();
    expect(retry?.attemptCount).toBe(1);
    expect(retry?.lastResult).toBe('UNKNOWN');
    expect(retry?.nextRecoveryAt.getTime()).toBeGreaterThan(Date.now() + 4 * 60 * 1000);
    expect(service.isRetryPending('call-unknown-1')).toBe(true);
  });

  it('8. Exponential retry backoff is bounded at MAX_BACKOFF_MS (60 mins)', () => {
    // Attempt 1: 5 min
    const s1 = service.scheduleRetry('call-backoff', 'UNKNOWN');
    expect(s1.attemptCount).toBe(1);
    const delay1 = s1.nextRecoveryAt.getTime() - s1.lastAttemptAt.getTime();
    expect(delay1).toBe(service.BASE_BACKOFF_MS); // 5 mins

    // Attempt 2: 10 min
    const s2 = service.scheduleRetry('call-backoff', 'UNKNOWN');
    expect(s2.attemptCount).toBe(2);
    const delay2 = s2.nextRecoveryAt.getTime() - s2.lastAttemptAt.getTime();
    expect(delay2).toBe(10 * 60 * 1000); // 10 mins

    // Attempt 3: 20 min
    const s3 = service.scheduleRetry('call-backoff', 'UNKNOWN');
    expect(s3.attemptCount).toBe(3);
    const delay3 = s3.nextRecoveryAt.getTime() - s3.lastAttemptAt.getTime();
    expect(delay3).toBe(20 * 60 * 1000); // 20 mins

    // Attempt 4: 40 min
    const s4 = service.scheduleRetry('call-backoff', 'UNKNOWN');
    expect(s4.attemptCount).toBe(4);
    const delay4 = s4.nextRecoveryAt.getTime() - s4.lastAttemptAt.getTime();
    expect(delay4).toBe(40 * 60 * 1000); // 40 mins

    // Attempt 5: 60 min (capped at MAX_BACKOFF_MS)
    const s5 = service.scheduleRetry('call-backoff', 'UNKNOWN');
    expect(s5.attemptCount).toBe(5);
    const delay5 = s5.nextRecoveryAt.getTime() - s5.lastAttemptAt.getTime();
    expect(delay5).toBe(service.MAX_BACKOFF_MS); // 60 mins

    // Attempt 10: still capped at 60 min
    for (let i = 6; i <= 10; i++) {
      service.scheduleRetry('call-backoff', 'UNKNOWN');
    }
    const s10 = service.getRetryState('call-backoff');
    expect(s10?.attemptCount).toBe(10);
    const delay10 = s10!.nextRecoveryAt.getTime() - s10!.lastAttemptAt.getTime();
    expect(delay10).toBe(service.MAX_BACKOFF_MS); // strictly capped
  });

  it('9. runRecoveryBatch skips reservations with pending retry backoff', async () => {
    // Schedule a pending retry for call-pending
    service.scheduleRetry('call-pending', 'UNKNOWN');
    expect(service.isRetryPending('call-pending')).toBe(true);

    prisma.callReservation.findMany.mockResolvedValue([
      { call_id: 'call-pending', status: 'ACTIVE', updated_at: new Date(Date.now() - 30 * 60 * 1000) },
      { call_id: 'call-fresh', status: 'ACTIVE', updated_at: new Date(Date.now() - 30 * 60 * 1000) },
    ]);

    prisma.call.findUnique.mockResolvedValue({
      id: 'call-fresh',
      workspace_id: 'ws-1',
      provider_call_id: 'v3:real-telnyx-call-id',
      state: 'ROUTING',
      created_at: new Date(),
      callReservation: { status: 'ACTIVE' },
    });
    provider.getCallStatus.mockResolvedValue('ACTIVE');

    await service.runRecoveryBatch();

    // call-pending must NOT be reconciled because its retry window is pending
    expect(prisma.call.findUnique).not.toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'call-pending' } }));
    // call-fresh MUST be reconciled
    expect(prisma.call.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'call-fresh' } }));
  });

  it('10. Synthetic provider call IDs are excluded from real provider recovery batch queries', async () => {
    // Real provider with isSyntheticCallId capability
    provider.isSyntheticCallId = vi.fn().mockImplementation((id: string) => id?.startsWith('recovery-mock-'));

    prisma.callReservation.findMany.mockResolvedValue([]);

    await service.runRecoveryBatch();

    // Verify Prisma query contains NOT filter for synthetic IDs
    expect(prisma.callReservation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          NOT: expect.arrayContaining([
            { call: { provider_call_id: { startsWith: 'recovery-mock-' } } },
          ]),
        }),
      }),
    );
  });

  it('11. Direct reconciliation of synthetic ID in live provider mode fails closed without billing or release', async () => {
    provider.isSyntheticCallId = vi.fn().mockReturnValue(true);

    prisma.call.findUnique.mockResolvedValue({
      id: 'call-synthetic-1',
      workspace_id: 'ws-1',
      provider_call_id: 'recovery-mock-test-123',
      state: 'ROUTING',
      created_at: new Date(),
      callReservation: { status: 'ACTIVE' },
    });

    await service.reconcileReservation('call-synthetic-1');

    // Never queries real carrier
    expect(provider.getCallStatus).not.toHaveBeenCalled();
    // Never releases or bills
    expect(walletService.releaseReservation).not.toHaveBeenCalled();
    expect(usageBillingService.billCallUsage).not.toHaveBeenCalled();
    // Backoff scheduled
    const retry = service.getRetryState('call-synthetic-1');
    expect(retry).toBeDefined();
    expect(retry?.attemptCount).toBe(1);
    expect(retry?.lastResult).toBe('UNKNOWN');
  });

  it('12. Concurrent reconciliation calls for the same callId are protected against race conditions', async () => {
    prisma.call.findUnique.mockImplementation(async () => {
      // Simulate asynchronous DB read
      await new Promise(r => setTimeout(r, 20));
      return {
        id: 'call-race-1',
        workspace_id: 'ws-1',
        provider_call_id: 'prov-race-1',
        state: 'ROUTING',
        created_at: new Date(),
        callReservation: { status: 'ACTIVE' },
      };
    });
    provider.getCallStatus.mockResolvedValue('ACTIVE');

    // Launch two concurrent reconciliations for the exact same call
    const p1 = service.reconcileReservation('call-race-1');
    const p2 = service.reconcileReservation('call-race-1');

    await Promise.all([p1, p2]);

    // getCallStatus should only be called once because the second call was blocked by concurrency guard
    expect(provider.getCallStatus).toHaveBeenCalledTimes(1);
  });

  it('13. TelnyxProvider never dispatches synthetic IDs to real carrier API and returns UNKNOWN', async () => {
    const realTelnyxClient = {
      calls: {
        retrieveStatus: vi.fn(),
      },
    };
    const telnyxProvider = new TelnyxProvider();
    (telnyxProvider as any).telnyxClient = realTelnyxClient;

    expect(telnyxProvider.isSyntheticCallId('recovery-mock-12345')).toBe(true);
    expect(telnyxProvider.isSyntheticCallId('mock_call_leg_1')).toBe(true);
    expect(telnyxProvider.isSyntheticCallId('fake_buyer_call_1')).toBe(true);
    expect(telnyxProvider.isSyntheticCallId('test_call_1')).toBe(true);
    expect(telnyxProvider.isSyntheticCallId('v3:real-telnyx-call-control-id')).toBe(false);

    // Call getCallStatus on synthetic ID
    const status = await telnyxProvider.getCallStatus('recovery-mock-12345');
    expect(status).toBe('UNKNOWN');
    expect(realTelnyxClient.calls.retrieveStatus).not.toHaveBeenCalled();
  });
});
