import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReservationRecoveryService } from './reservation-recovery.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { WalletService } from '../billing/wallet.service.js';
import { UsageBillingService } from '../billing/usage-billing.service.js';
import type { TelephonyProvider } from './telephony.provider.js';

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
  });

  it('2. provider NOT_FOUND + non-terminal local state -> defers without release or completion', async () => {
    prisma.call.findUnique.mockResolvedValue({
      id: 'call-2',
      workspace_id: 'ws-1',
      provider_call_id: 'prov-call-2',
      state: 'ROUTING',
      callReservation: {
        status: 'ACTIVE',
      },
    });
    provider.getCallStatus.mockResolvedValue('NOT_FOUND');

    await service.reconcileReservation('call-2');

    expect(prisma.call.update).not.toHaveBeenCalled();
    expect(walletService.releaseReservation).not.toHaveBeenCalled();
    expect(usageBillingService.billCallUsage).not.toHaveBeenCalled();
  });

  it('3. provider NOT_FOUND + local NO_ANSWER -> recognizes terminal state, releases reservation without debit', async () => {
    prisma.call.findUnique.mockResolvedValue({
      id: 'call-3',
      workspace_id: 'ws-1',
      provider_call_id: 'prov-call-3',
      state: 'NO_ANSWER',
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
  });

  it('4. provider TERMINAL + unanswered call (answered_at == null) -> cancels call and releases reservation', async () => {
    prisma.call.findUnique.mockResolvedValue({
      id: 'call-4',
      workspace_id: 'ws-1',
      provider_call_id: 'prov-call-4',
      state: 'RINGING',
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
  });

  it('6. already SETTLED or RELEASED reservation -> safely no-ops', async () => {
    prisma.call.findUnique.mockResolvedValue({
      id: 'call-6',
      workspace_id: 'ws-1',
      provider_call_id: 'prov-call-6',
      state: 'COMPLETED',
      callReservation: {
        status: 'SETTLED',
      },
    });

    await service.reconcileReservation('call-6');

    expect(provider.getCallStatus).not.toHaveBeenCalled();
    expect(walletService.releaseReservation).not.toHaveBeenCalled();
    expect(usageBillingService.billCallUsage).not.toHaveBeenCalled();
  });
});
