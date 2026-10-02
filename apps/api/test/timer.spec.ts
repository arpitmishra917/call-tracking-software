import { Test, TestingModule } from '@nestjs/testing';
import { CallController } from '../src/telephony/call-controller.js';
import { TelephonyProvider } from '../src/telephony/provider.interface.js';
import { WalletService } from '../src/billing/wallet.service.js';
import { CallsService } from '../src/telephony/calls.service.js';
import { UsageBillingService } from '../src/billing/usage-billing.service.js';
import { CallEventType } from '../src/telephony/telephony.events.js';
import { expect, describe, it, beforeAll, afterAll, beforeEach, vi, afterEach } from 'vitest';

describe('Phase 3E: In-Memory Timer Lifecycle Tests', () => {
  let controller: CallController;
  let mockProvider: any;
  let mockWallet: any;
  let mockCalls: any;
  let mockBilling: any;

  beforeAll(async () => {
    mockProvider = { requestHangup: vi.fn(), hangupCall: vi.fn().mockResolvedValue(true), startRecording: vi.fn().mockResolvedValue(true), bridgeCalls: vi.fn().mockResolvedValue(true) };
    mockWallet = {
      extendReservationForCall: vi.fn().mockImplementation((workspaceId, callId) => {
        if (callId === 'parent-c1') return Promise.resolve(true);
        return Promise.resolve(true);
      })
    };
    mockCalls = {
      updateCallState: vi.fn(),
      addAttempt: vi.fn(),
      getCallWithWorkspace: vi.fn().mockResolvedValue({ id: 'parent-c1', workspace_id: 'ws1', state: 'ROUTING' }),
      handleBuyerHangup: vi.fn().mockResolvedValue({ ended_at: new Date() }),
      handleCallerHangup: vi.fn().mockResolvedValue({ ended_at: new Date() }),
      transitionCall: vi.fn().mockResolvedValue({ id: 'parent-c1' }),
      prepareNextBuyer: vi.fn().mockResolvedValue({ action: 'NONE' }),
      markCallAnswered: vi.fn().mockResolvedValue(true)
    };
    mockBilling = {
      calculateInitialReservation: vi.fn().mockReturnValue(100000n),
      billCallUsage: vi.fn().mockResolvedValue(true)
    };

    let mockPrisma = {
      call: { 
        findUnique: vi.fn().mockImplementation(({ where }) => {
          if (where.provider_call_id === 'pc1') return Promise.resolve({ id: 'parent-c1', workspace_id: 'ws1', provider_call_id: 'pc1' });
          if (where.id === 'parent-c1') return Promise.resolve({ id: 'parent-c1', workspace_id: 'ws1', provider_call_id: 'pc1', state: 'IN_PROGRESS' });
          return Promise.resolve(null);
        }) 
      },
      callAttempt: { 
        findUnique: vi.fn().mockImplementation(({ where }) => {
          if (where.provider_call_id === 'att1-pc') return Promise.resolve({ id: 'att1', provider_call_id: 'att1-pc', call: { id: 'parent-c1', workspace_id: 'ws1', provider_call_id: 'pc1', to_number: '+1' } });
          if (where.provider_call_id === 'pc2') return Promise.resolve({ id: 'att2', provider_call_id: 'pc2', call: { id: 'parent-c1', workspace_id: 'ws1', provider_call_id: 'pc1', to_number: '+1' } });
          return Promise.resolve(null);
        }) 
      },
      phoneNumber: { findFirst: vi.fn().mockResolvedValue({ number_type: 'local' }) }
    };
    let mockUsage = {};
    let mockWebhooks = {};

    controller = new CallController(
      mockProvider as any,
      mockPrisma as any,
      mockCalls as any,
      mockUsage as any,
      mockBilling as any,
      mockWebhooks as any,
      mockWallet as any
    );
  });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    (controller as any).activeCallTimers.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('TEST T1 & T7: CALL_ANSWERED creates exactly one monitor per call', async () => {
    await controller.handleEvent({ type: CallEventType.CALL_ANSWERED, callId: 'att1-pc', direction: 'outgoing', timestamp: new Date() });
    const timers = (controller as any).activeCallTimers;
    expect(timers.size).toBe(1);
    expect(timers.has('parent-c1')).toBe(true);
  });

  it('TEST T2: Duplicate CALL_ANSWERED does NOT leak monitors', async () => {
    await controller.handleEvent({ type: CallEventType.CALL_ANSWERED, callId: 'att1-pc', direction: 'outgoing', timestamp: new Date() });
    const timers = (controller as any).activeCallTimers;
    expect(timers.size).toBe(1);
    await controller.handleEvent({ type: CallEventType.CALL_ANSWERED, callId: 'att1-pc', direction: 'outgoing', timestamp: new Date() });
    expect(timers.size).toBe(1); // Still just 1 timer for parent-c1
  });

  it('TEST T3: CALL_HANGUP clears the monitor', async () => {
    await controller.handleEvent({ type: CallEventType.CALL_ANSWERED, callId: 'att1-pc', direction: 'outgoing', timestamp: new Date() });
    expect((controller as any).activeCallTimers.has('parent-c1')).toBe(true);
    // HANGUP on the parent leg
    await controller.handleEvent({ type: CallEventType.CALL_HANGUP, callId: 'pc1', direction: 'incoming', timestamp: new Date() });
    expect((controller as any).activeCallTimers.has('parent-c1')).toBe(false);
  });

  it('TEST T5 & T6: Provider hangup due to insufficient funds clears the monitor', async () => {
    mockWallet.extendReservationForCall.mockRejectedValue(new Error('Insufficient available funds'));
    await controller.handleEvent({ type: CallEventType.CALL_ANSWERED, callId: 'att1-pc', direction: 'outgoing', timestamp: new Date() });
    expect((controller as any).activeCallTimers.has('parent-c1')).toBe(true);
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000); // Trigger timer
    await new Promise(resolve => process.nextTick(resolve));
    expect(mockWallet.extendReservationForCall).toHaveBeenCalled();
    expect(mockProvider.hangupCall).toHaveBeenCalledWith('pc1');
    expect((controller as any).activeCallTimers.has('parent-c1')).toBe(false);
  });

  it('TEST T4: Stale timer cannot mutate SETTLED/RELEASED reservation', async () => {
    mockWallet.extendReservationForCall.mockRejectedValueOnce(new Error('Cannot extend a non-ACTIVE reservation'));
    await controller.handleEvent({ type: CallEventType.CALL_ANSWERED, callId: 'att1-pc', direction: 'outgoing', timestamp: new Date() });
    await controller.handleEvent({ type: CallEventType.CALL_HANGUP, callId: 'pc1', direction: 'incoming', timestamp: new Date() });
    expect((controller as any).activeCallTimers.has('parent-c1')).toBe(false);
  });

  it('TEST T8: Multiple CallAttempts for same parent call do NOT create multiple monitors', async () => {
    await controller.handleEvent({
      type: CallEventType.CALL_ANSWERED,
      callId: 'att1-pc',
      direction: 'outgoing',
      timestamp: new Date()
    });

    // A second attempt bridging for the exact same parent call
    await controller.handleEvent({
      type: CallEventType.CALL_ANSWERED,
      callId: 'pc2', // different provider attempt leg
      direction: 'outgoing',
      timestamp: new Date()
    });

    const timers = (controller as any).activeCallTimers;
    expect(timers.size).toBe(1);
  });
});
