import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { CallController, TELEPHONY_PROVIDER } from './call-controller.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CallsService } from '../calls/calls.service.js';
import { UsageService } from '../usage/usage.service.js';
import { WalletService } from '../billing/wallet.service.js';
import { UsageBillingService } from '../billing/usage-billing.service.js';
import { WebhooksService } from '../webhooks/webhooks.service.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { TelnyxProvider } from './telnyx/telnyx.provider.js';
import { CallEventType } from './telephony.events.js';
import { CallState, CallAttemptState } from '@prisma/client';
import { TelephonyProviderError, TelephonyErrorType } from './telephony.errors.js';

describe('Telnyx Critical Bridge Failure & Lifecycle Remediation Suite', () => {
  let controller: CallController;
  let provider: any;
  let prisma: any;
  let callsService: any;
  let usageService: any;
  let usageBillingService: any;
  let walletService: any;
  let webhooksService: any;

  beforeEach(async () => {
    provider = {
      answerCall: vi.fn().mockResolvedValue(undefined),
      hangupCall: vi.fn().mockResolvedValue(undefined),
      bridgeCalls: vi.fn().mockResolvedValue(undefined),
      startRecording: vi.fn().mockResolvedValue(undefined),
      dialBuyer: vi.fn().mockResolvedValue('v3:buyer_dial_leg_123'),
      getCallStatus: vi.fn().mockResolvedValue('ACTIVE'),
      startRingback: vi.fn().mockResolvedValue(undefined),
      stopRingback: vi.fn().mockResolvedValue(undefined),
    };

    prisma = {
      $transaction: vi.fn((cb) => cb(prisma)),
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'call_1', state: CallState.ROUTING }]),
      call: {
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      callAttempt: {
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      phoneNumber: {
        findFirst: vi.fn().mockResolvedValue({
          phone_number: '+15551112222',
          workspace_id: 'ws_1',
          number_type: 'local',
          status: 'ACTIVE',
          workspace: { status: 'ACTIVE' },
          campaign: { id: 'camp_1', status: 'ACTIVE' },
        }),
      },
      blockedCaller: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
      campaign: {
        findUnique: vi.fn(),
      },
    };

    callsService = {
      createCall: vi.fn(),
      transitionCall: vi.fn(),
      handleCallerHangup: vi.fn(),
      handleBuyerHangup: vi.fn(),
      markCallAnswered: vi.fn(),
      handleBridgeFailure: vi.fn(),
      prepareNextBuyer: vi.fn(),
      commitBuyerDial: vi.fn(),
      transitionAttempt: vi.fn(),
    };

    usageService = {
      recordUsage: vi.fn().mockResolvedValue({ id: 'rec_1' }),
    };

    usageBillingService = {
      calculateInitialReservation: vi.fn().mockReturnValue(100),
      billCallUsage: vi.fn().mockResolvedValue(undefined),
      billRecordingUsage: vi.fn().mockResolvedValue(undefined),
    };

    walletService = {
      reserveForCall: vi.fn().mockResolvedValue(undefined),
      extendReservationForCall: vi.fn().mockResolvedValue({ totalReservedMicro: 200n, availableMicro: 800n }),
    };

    webhooksService = {
      queueEvent: vi.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CallController,
        { provide: TELEPHONY_PROVIDER, useValue: provider },
        { provide: PrismaService, useValue: prisma },
        { provide: CallsService, useValue: callsService },
        { provide: UsageService, useValue: usageService },
        { provide: UsageBillingService, useValue: usageBillingService },
        { provide: WalletService, useValue: walletService },
        { provide: WebhooksService, useValue: webhooksService },
        { provide: PermissionsService, useValue: {} },
      ],
    }).compile();

    controller = module.get<CallController>(CallController);
  });

  it('1. Correct buyer ID extracted from Telnyx dial response and persisted', async () => {
    // Test provider extracts call_control_id from response
    const mockClient = {
      calls: {
        dial: vi.fn().mockResolvedValue({
          data: {
            call_control_id: 'v3:3NB4OKpz0eBHVp6XgndQuXSCcw8ab_j1IMpGMkhIXnGkp74LooJDSQ',
            call_leg_id: '2dc6fc34-f9e0-11ea-b68e-02420a0f7768',
            is_alive: true,
          },
        }),
      },
    };

    const liveTelnyxProvider = new TelnyxProvider();
    (liveTelnyxProvider as any).telnyxClient = mockClient;

    const buyerLegId = await liveTelnyxProvider.dialBuyer(
      '+15559990000',
      '+15551112222',
      'conn_123',
      30,
      'test_client_state',
    );

    expect(buyerLegId).toBe('v3:3NB4OKpz0eBHVp6XgndQuXSCcw8ab_j1IMpGMkhIXnGkp74LooJDSQ');
    expect(mockClient.calls.dial).toHaveBeenCalledWith({
      to: '+15559990000',
      from: '+15551112222',
      connection_id: 'conn_123',
      timeout_secs: 30,
      client_state: 'test_client_state',
    });
  });

  it('2. Webhook whose Call Control ID differs from database ID correlates and updates provider_call_id', async () => {
    const callerCallId = 'v3:fuUFbiINfT5pAhJMrz0fBqKEIdimLLAVa2cMz3J3iY_z1NVt5NPwQQ';
    const liveWebhookCallControlId = 'v3:live_buyer_leg_new_999';
    const oldDialCallControlId = 'v3:old_buyer_dial_id_111';

    const mockCall = {
      id: 'call_123',
      workspace_id: 'ws_1',
      provider_call_id: callerCallId,
      state: CallState.ROUTING,
      attempts: [],
    };

    const mockAttempt = {
      id: 'attempt_abc',
      call_id: 'call_123',
      provider_call_id: oldDialCallControlId,
      state: CallAttemptState.RINGING,
      call: mockCall,
    };

    const clientState = Buffer.from(
      JSON.stringify({
        callId: 'call_123',
        attemptId: 'attempt_abc',
        workspaceId: 'ws_1',
      }),
    ).toString('base64');

    // First lookup by liveWebhookCallControlId fails initially
    prisma.call.findUnique.mockResolvedValue(null);
    prisma.callAttempt.findUnique
      .mockResolvedValueOnce(null) // by provider_call_id
      .mockResolvedValueOnce(mockAttempt); // by decoded.attemptId in clientState

    prisma.callAttempt.update.mockResolvedValue({
      ...mockAttempt,
      provider_call_id: liveWebhookCallControlId,
    });

    callsService.markCallAnswered.mockResolvedValue(true);

    await controller.handleEvent({
      type: CallEventType.CALL_ANSWERED,
      callId: liveWebhookCallControlId,
      clientState,
      direction: 'outbound',
      timestamp: new Date().toISOString(),
    });

    // Verified: provider_call_id was updated to the live callId
    expect(prisma.callAttempt.update).toHaveBeenCalledWith({
      where: { id: 'attempt_abc' },
      data: { provider_call_id: liveWebhookCallControlId },
    });

    // Verified: markCallAnswered and bridgeCalls called with the live Call Control ID
    expect(callsService.markCallAnswered).toHaveBeenCalledWith('call_123', 'attempt_abc');
    expect(provider.bridgeCalls).toHaveBeenCalledWith(callerCallId, liveWebhookCallControlId);
  });

  it('3. Early call.answered arriving before dial persistence completes', async () => {
    const callerCallId = 'v3:caller_leg_123';
    const earlyBuyerCallId = 'v3:early_buyer_leg_456';

    const mockCall = {
      id: 'call_early',
      workspace_id: 'ws_1',
      provider_call_id: callerCallId,
      state: CallState.ROUTING,
      attempts: [],
    };

    // provider_call_id is still null because commitBuyerDial has not run yet
    const mockAttempt = {
      id: 'attempt_early',
      call_id: 'call_early',
      provider_call_id: null,
      state: CallAttemptState.INITIATED,
      call: mockCall,
    };

    const clientState = Buffer.from(
      JSON.stringify({
        callId: 'call_early',
        attemptId: 'attempt_early',
        workspaceId: 'ws_1',
      }),
    ).toString('base64');

    prisma.call.findUnique.mockResolvedValue(null);
    prisma.callAttempt.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(mockAttempt);

    prisma.callAttempt.update.mockResolvedValue({
      ...mockAttempt,
      provider_call_id: earlyBuyerCallId,
    });

    callsService.markCallAnswered.mockResolvedValue(true);

    await controller.handleEvent({
      type: CallEventType.CALL_ANSWERED,
      callId: earlyBuyerCallId,
      clientState,
      direction: 'outbound',
      timestamp: new Date().toISOString(),
    });

    expect(prisma.callAttempt.update).toHaveBeenCalledWith({
      where: { id: 'attempt_early' },
      data: { provider_call_id: earlyBuyerCallId },
    });
    expect(callsService.markCallAnswered).toHaveBeenCalledWith('call_early', 'attempt_early');
    expect(provider.bridgeCalls).toHaveBeenCalledWith(callerCallId, earlyBuyerCallId);
  });

  it('4. Duplicate and out-of-order answered/hangup webhooks', async () => {
    const callerCallId = 'v3:caller_leg_dup';
    const buyerCallId = 'v3:buyer_leg_dup';

    const mockCall = {
      id: 'call_dup',
      workspace_id: 'ws_1',
      provider_call_id: callerCallId,
      state: CallState.ROUTING,
      attempts: [],
    };

    const alreadyAnsweredAttempt = {
      id: 'att_dup',
      call_id: 'call_dup',
      provider_call_id: buyerCallId,
      state: CallAttemptState.ANSWERED,
      call: mockCall,
    };

    prisma.call.findUnique.mockResolvedValue(null);
    prisma.callAttempt.findUnique.mockResolvedValue(alreadyAnsweredAttempt);

    // Duplicate CALL_ANSWERED
    await controller.handleEvent({
      type: CallEventType.CALL_ANSWERED,
      callId: buyerCallId,
      direction: 'outbound',
      timestamp: new Date().toISOString(),
    });

    // Does not attempt duplicate markCallAnswered or bridge
    expect(callsService.markCallAnswered).not.toHaveBeenCalled();
    expect(provider.bridgeCalls).not.toHaveBeenCalled();

    // Out-of-order: CALL_ANSWERED arriving after attempt is already NO_ANSWER / FAILED
    const terminalAttempt = {
      ...alreadyAnsweredAttempt,
      state: CallAttemptState.NO_ANSWER,
    };
    prisma.callAttempt.findUnique.mockResolvedValue(terminalAttempt);
    callsService.markCallAnswered.mockResolvedValue(false); // DB check rejects transition

    await controller.handleEvent({
      type: CallEventType.CALL_ANSWERED,
      callId: buyerCallId,
      direction: 'outbound',
      timestamp: new Date().toISOString(),
    });

    expect(callsService.markCallAnswered).toHaveBeenCalledWith('call_dup', 'att_dup');
    // Because markCallAnswered returned false, late answer hangs up the orphaned leg
    expect(provider.hangupCall).toHaveBeenCalledWith(buyerCallId);
    expect(provider.bridgeCalls).not.toHaveBeenCalled();
  });

  it('5. Buyer leg ending before bridge triggers safe cleanup', async () => {
    const callerCallId = 'v3:caller_111';
    const buyerCallId = 'v3:buyer_222';

    const mockCall = {
      id: 'call_race',
      workspace_id: 'ws_1',
      provider_call_id: callerCallId,
      state: CallState.ROUTING,
      attempts: [],
    };

    const mockAttempt = {
      id: 'att_race',
      call_id: 'call_race',
      provider_call_id: buyerCallId,
      state: CallAttemptState.RINGING,
      call: mockCall,
    };

    prisma.call.findUnique.mockResolvedValue(null);
    prisma.callAttempt.findUnique.mockResolvedValue(mockAttempt);

    // Caller hangs up before buyer answer completes -> markCallAnswered returns false
    callsService.markCallAnswered.mockResolvedValue(false);

    await controller.handleEvent({
      type: CallEventType.CALL_ANSWERED,
      callId: buyerCallId,
      direction: 'outbound',
      timestamp: new Date().toISOString(),
    });

    expect(provider.hangupCall).toHaveBeenCalledWith(buyerCallId);
    expect(provider.bridgeCalls).not.toHaveBeenCalled();
  });

  it('6. Bridge returning 422 triggers safe cleanup and exactly one fallback decision', async () => {
    const callerCallId = 'v3:fuUFbiINfT5pAhJMrz0fBqKEIdimLLAVa2cMz3J3iY_z1NVt5NPwQQ';
    const buyerCallId = 'v3:3NB4OKpz0eBHVp6XgndQuXSCcw8ab_j1IMpGMkhIXnGkp74LooJDSQ';

    const mockCall = {
      id: 'call_422',
      workspace_id: 'ws_1',
      provider_call_id: callerCallId,
      to_number: '+15551112222',
      state: CallState.ROUTING,
      attempts: [],
    };

    const mockAttempt = {
      id: 'att_422',
      call_id: 'call_422',
      provider_call_id: buyerCallId,
      state: CallAttemptState.RINGING,
      call: mockCall,
    };

    prisma.call.findUnique.mockResolvedValue(null);
    prisma.callAttempt.findUnique.mockResolvedValue(mockAttempt);

    callsService.markCallAnswered.mockResolvedValue(true);

    // Simulate Telnyx 422 error 90015 Invalid Call Control ID
    provider.bridgeCalls.mockRejectedValue(
      new TelephonyProviderError(
        TelephonyErrorType.ROUTING_FAILED,
        'Failed to bridge calls: HTTP 422, error 90015 Invalid Call Control ID',
      ),
    );

    const revertedCall = {
      ...mockCall,
      state: CallState.ROUTING,
      answered_at: null,
    };
    callsService.handleBridgeFailure.mockResolvedValue(revertedCall);
    callsService.prepareNextBuyer.mockResolvedValue({
      action: 'HANGUP',
      call: revertedCall,
    });

    await controller.handleEvent({
      type: CallEventType.CALL_ANSWERED,
      callId: buyerCallId,
      direction: 'outbound',
      timestamp: new Date().toISOString(),
    });

    // 1. Hangup issued for the failed buyer leg
    expect(provider.hangupCall).toHaveBeenCalledWith(buyerCallId);

    // 2. State reverted to ROUTING via handleBridgeFailure
    expect(callsService.handleBridgeFailure).toHaveBeenCalledWith('call_422', 'att_422');

    // 3. Exactly one fallback decision: dialNextBuyer was called once with revertedCall
    expect(callsService.prepareNextBuyer).toHaveBeenCalledTimes(1);
    expect(callsService.prepareNextBuyer).toHaveBeenCalledWith('call_422');
  });

  it('7. Successful bridge path with the exact expected SDK arguments', async () => {
    const callerCallId = 'v3:caller_leg_live';
    const buyerCallId = 'v3:buyer_leg_live';

    const mockClient = {
      calls: {
        actions: {
          bridge: vi.fn().mockResolvedValue({ data: { result: 'ok' } }),
        },
      },
    };

    const liveTelnyxProvider = new TelnyxProvider();
    (liveTelnyxProvider as any).telnyxClient = mockClient;

    await liveTelnyxProvider.bridgeCalls(callerCallId, buyerCallId);

    // Verified: calls.actions.bridge called with callerCallId as path and call_control_id_to_bridge_with in params
    expect(mockClient.calls.actions.bridge).toHaveBeenCalledWith(
      callerCallId,
      { call_control_id_to_bridge_with: buyerCallId },
    );
  });

  it('8. No false success state, usage charge, or connected-talk duration when bridging fails', async () => {
    const callerCallId = 'v3:caller_fail';
    const buyerCallId = 'v3:buyer_fail';

    const mockCall = {
      id: 'call_billing_test',
      workspace_id: 'ws_1',
      provider_call_id: callerCallId,
      to_number: '+15551112222',
      state: CallState.ROUTING,
      attempts: [],
    };

    const mockAttempt = {
      id: 'att_billing_test',
      call_id: 'call_billing_test',
      provider_call_id: buyerCallId,
      state: CallAttemptState.RINGING,
      call: mockCall,
    };

    prisma.call.findUnique.mockResolvedValue(null);
    prisma.callAttempt.findUnique.mockResolvedValue(mockAttempt);

    callsService.markCallAnswered.mockResolvedValue(true);
    provider.bridgeCalls.mockRejectedValue(new Error('Bridge 422 rejected'));

    const revertedCall = {
      ...mockCall,
      state: CallState.ROUTING,
      answered_at: null,
    };
    callsService.handleBridgeFailure.mockResolvedValue(revertedCall);

    // routing exhausted after bridge failure
    callsService.prepareNextBuyer.mockResolvedValue({
      action: 'HANGUP',
      call: revertedCall,
    });

    await controller.handleEvent({
      type: CallEventType.CALL_ANSWERED,
      callId: buyerCallId,
      direction: 'outbound',
      timestamp: new Date().toISOString(),
    });

    // HandleBridgeFailure was executed to wipe answered_at and revert COMPLETED -> ROUTING
    expect(callsService.handleBridgeFailure).toHaveBeenCalledWith(
      'call_billing_test',
      'att_billing_test',
    );

    // Exhausted routing hung up caller and released reservation with 0 talk duration
    expect(usageBillingService.billCallUsage).toHaveBeenCalledWith(
      'ws_1',
      'call_billing_test',
      'local',
      0, // ZERO seconds talk duration charged
    );
  });

  it('9. Buyer A times out -> Buyer B dialed -> Buyer B answers -> bridge succeeds, ringback stops, and caller audio connects', async () => {
    const callerCallId = 'v3:caller_leg_seq';
    const buyerALeg = 'v3:buyer_a_leg';
    const buyerBLeg = 'v3:buyer_b_leg';

    const call = {
      id: 'call_fallback_bridge',
      workspace_id: 'ws_1',
      provider_call_id: callerCallId,
      to_number: '+15551112222',
      from_number: '+15550001111',
      state: CallState.ROUTING,
      attempts: [],
    };

    const attemptA = {
      id: 'att_a',
      call_id: 'call_fallback_bridge',
      provider_call_id: buyerALeg,
      state: CallAttemptState.RINGING,
      call,
    };

    const attemptB = {
      id: 'att_b',
      call_id: 'call_fallback_bridge',
      provider_call_id: buyerBLeg,
      state: CallAttemptState.RINGING,
      call,
    };

    // Step 1: Buyer A times out
    prisma.call.findUnique.mockResolvedValue(null);
    prisma.callAttempt.findUnique.mockResolvedValueOnce(attemptA);

    callsService.handleBuyerHangup.mockResolvedValueOnce({
      action: 'DIAL_NEXT',
      call,
    });

    callsService.prepareNextBuyer.mockResolvedValueOnce({
      action: 'DIAL',
      call,
      attempt: attemptB,
      buyer: { id: 'buyer_b', destination_number: '+15559998888', timeout: 30 },
    });
    provider.dialBuyer.mockResolvedValueOnce(buyerBLeg);
    callsService.commitBuyerDial.mockResolvedValueOnce(false);

    await controller.handleEvent({
      type: CallEventType.CALL_HANGUP,
      callId: buyerALeg,
      hangupCause: 'TIMEOUT',
      timestamp: new Date().toISOString(),
    });

    // Verify Buyer A hangup was handled and Buyer B was dialed
    expect(callsService.handleBuyerHangup).toHaveBeenCalledWith('call_fallback_bridge', 'att_a', 'TIMEOUT');
    expect(provider.dialBuyer).toHaveBeenCalledWith(
      '+15559998888',
      '+15551112222',
      expect.any(String),
      30,
      expect.any(String),
      undefined,
    );
    // Verify caller was NOT terminated
    expect(provider.hangupCall).not.toHaveBeenCalledWith(callerCallId);
    // Verify ringback continues on caller leg
    expect(provider.startRingback).toHaveBeenCalledWith(callerCallId);

    // Step 2: Buyer B answers
    prisma.callAttempt.findUnique.mockResolvedValueOnce(attemptB);
    callsService.markCallAnswered.mockResolvedValueOnce(true);

    await controller.handleEvent({
      type: CallEventType.CALL_ANSWERED,
      callId: buyerBLeg,
      direction: 'outbound',
      timestamp: new Date().toISOString(),
    });

    // Verify markCallAnswered was called for attempt B
    expect(callsService.markCallAnswered).toHaveBeenCalledWith('call_fallback_bridge', 'att_b');
    // Verify ringback was stopped on caller leg
    expect(provider.stopRingback).toHaveBeenCalledWith(callerCallId);
    // Verify bridge was executed between caller leg and Buyer B leg
    expect(provider.bridgeCalls).toHaveBeenCalledWith(callerCallId, buyerBLeg);
    // Caller is still not hung up
    expect(provider.hangupCall).not.toHaveBeenCalledWith(callerCallId);
  });
});
