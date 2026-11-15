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
import { CommercialEvaluatorService } from '../commercial/commercial-evaluator.service.js';
import { TelnyxProvider } from './telnyx/telnyx.provider.js';
import { CallEventType } from './telephony.events.js';
import { CallState, CallAttemptState, UsageType } from '@prisma/client';
import { TelephonyProviderError } from './telephony.errors.js';

describe('Priority 4: Caller Hangup, Buyer Rejection, No-Answer & Ringback Regression Suite', () => {
  let controller: CallController;
  let provider: any;
  let prisma: any;
  let callsService: any;
  let usageBillingService: any;
  let walletService: any;
  let webhooksService: any;
  let usageService: any;
  let commercialEvaluatorService: any;

  const CALLER_LEG = 'v3:caller_leg_123';
  const BUYER_1_LEG = 'v3:buyer_leg_1';
  const BUYER_2_LEG = 'v3:buyer_leg_2';

  beforeEach(async () => {
    provider = {
      answerCall: vi.fn().mockResolvedValue(undefined),
      hangupCall: vi.fn().mockResolvedValue(undefined),
      bridgeCalls: vi.fn().mockResolvedValue(undefined),
      startRecording: vi.fn().mockResolvedValue(undefined),
      dialBuyer: vi.fn(),
      getCallStatus: vi.fn().mockResolvedValue('ACTIVE'),
      startRingback: vi.fn().mockResolvedValue(undefined),
      stopRingback: vi.fn().mockResolvedValue(undefined),
    };

    prisma = {
      $transaction: vi.fn((cb) => cb(prisma)),
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'call_1' }]),
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

    usageBillingService = {
      calculateInitialReservation: vi.fn().mockReturnValue(100),
      billCallUsage: vi.fn().mockResolvedValue({ billed: false }),
      billRecordingUsage: vi.fn().mockResolvedValue(undefined),
    };

    walletService = {
      reserveForCall: vi.fn().mockResolvedValue(undefined),
      releaseReservation: vi.fn().mockResolvedValue(undefined),
      extendReservationForCall: vi.fn().mockResolvedValue({ totalReservedMicro: 200n, availableMicro: 800n }),
    };

    webhooksService = {
      queueEvent: vi.fn().mockResolvedValue(undefined),
    };

    usageService = {
      recordUsage: vi.fn().mockResolvedValue({ id: 'rec_1' }),
    };
    commercialEvaluatorService = {
      evaluateCall: vi.fn().mockResolvedValue({ id: 'comm_1' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CallController,
        { provide: TELEPHONY_PROVIDER, useValue: provider },
        { provide: PrismaService, useValue: prisma },
        { provide: CallsService, useValue: callsService },
        { provide: UsageBillingService, useValue: usageBillingService },
        { provide: WalletService, useValue: walletService },
        { provide: WebhooksService, useValue: webhooksService },
        { provide: UsageService, useValue: usageService },
        { provide: CommercialEvaluatorService, useValue: commercialEvaluatorService },
        { provide: PermissionsService, useValue: { getPermissionsForUser: vi.fn().mockResolvedValue([]) } },
      ],
    }).compile();

    controller = module.get<CallController>(CallController);
  });

  // ---------------------------------------------------------------------------
  // Test 1: Buyer 1 rejects; buyer 2 rejects; caller termination requested exactly once
  // ---------------------------------------------------------------------------
  it('1. Buyer 1 rejects, Buyer 2 rejects -> caller termination is requested exactly once', async () => {
    const call = {
      id: 'call_1',
      workspace_id: 'ws_1',
      provider_call_id: CALLER_LEG,
      to_number: '+15551112222',
      from_number: '+15550001111',
      state: CallState.ROUTING,
      attempts: [],
    };

    const attempt1 = {
      id: 'att_1',
      call_id: 'call_1',
      provider_call_id: BUYER_1_LEG,
      state: CallAttemptState.RINGING,
      call,
    };

    const attempt2 = {
      id: 'att_2',
      call_id: 'call_1',
      provider_call_id: BUYER_2_LEG,
      state: CallAttemptState.RINGING,
      call,
    };

    // Buyer 1 rejects
    prisma.call.findUnique.mockResolvedValue(null);
    prisma.callAttempt.findUnique.mockResolvedValue(attempt1);

    // handleBuyerHangup returns DIAL_NEXT with updated call
    callsService.handleBuyerHangup.mockResolvedValueOnce({
      action: 'DIAL_NEXT',
      call,
    });

    // prepareNextBuyer returns buyer 2
    callsService.prepareNextBuyer.mockResolvedValueOnce({
      action: 'DIAL',
      call,
      attempt: attempt2,
      buyer: { id: 'buyer_2', destination_number: '+15552223333', timeout: 30 },
    });
    provider.dialBuyer.mockResolvedValueOnce(BUYER_2_LEG);
    callsService.commitBuyerDial.mockResolvedValueOnce(false);

    await controller.handleEvent({
      type: CallEventType.CALL_HANGUP,
      callId: BUYER_1_LEG,
      hangupCause: 'CALL_REJECTED',
      timestamp: new Date().toISOString(),
    });

    expect(callsService.handleBuyerHangup).toHaveBeenCalledWith('call_1', 'att_1', 'CALL_REJECTED');
    expect(provider.dialBuyer).toHaveBeenCalledTimes(1);
    expect(provider.hangupCall).not.toHaveBeenCalledWith(CALLER_LEG); // Caller still alive

    // Buyer 2 rejects
    prisma.callAttempt.findUnique.mockResolvedValue(attempt2);
    callsService.handleBuyerHangup.mockResolvedValueOnce({
      action: 'DIAL_NEXT',
      call,
    });

    // prepareNextBuyer: No further buyers, exhausted! Returns HANGUP with call in NO_ANSWER
    callsService.prepareNextBuyer.mockResolvedValueOnce({
      action: 'HANGUP',
      call: { ...call, state: CallState.NO_ANSWER },
    });

    await controller.handleEvent({
      type: CallEventType.CALL_HANGUP,
      callId: BUYER_2_LEG,
      hangupCause: 'USER_BUSY',
      timestamp: new Date().toISOString(),
    });

    // Caller termination must be requested exactly once
    expect(provider.hangupCall).toHaveBeenCalledTimes(1);
    expect(provider.hangupCall).toHaveBeenCalledWith(CALLER_LEG);
    expect(provider.stopRingback).toHaveBeenCalledWith(CALLER_LEG);
    expect(usageBillingService.billCallUsage).toHaveBeenCalledWith('ws_1', 'call_1', 'local', 0);
  });

  // ---------------------------------------------------------------------------
  // Test 2: Buyer 1 times out; buyer 2 times out; caller termination requested exactly once
  // ---------------------------------------------------------------------------
  it('2. Buyer 1 times out, Buyer 2 times out -> caller termination requested exactly once', async () => {
    const call = {
      id: 'call_2',
      workspace_id: 'ws_1',
      provider_call_id: CALLER_LEG,
      to_number: '+15551112222',
      state: CallState.ROUTING,
      attempts: [],
    };

    const attempt1 = { id: 'att_1', call_id: 'call_2', provider_call_id: BUYER_1_LEG, state: CallAttemptState.RINGING, call };
    const attempt2 = { id: 'att_2', call_id: 'call_2', provider_call_id: BUYER_2_LEG, state: CallAttemptState.RINGING, call };

    prisma.call.findUnique.mockResolvedValue(null);
    prisma.callAttempt.findUnique.mockResolvedValue(attempt1);
    callsService.handleBuyerHangup.mockResolvedValueOnce({ action: 'DIAL_NEXT', call });
    callsService.prepareNextBuyer.mockResolvedValueOnce({
      action: 'DIAL',
      call,
      attempt: attempt2,
      buyer: { id: 'buyer_2', destination_number: '+15552223333', timeout: 30 },
    });
    provider.dialBuyer.mockResolvedValueOnce(BUYER_2_LEG);
    callsService.commitBuyerDial.mockResolvedValueOnce(false);

    // Buyer 1 timeout
    await controller.handleEvent({
      type: CallEventType.CALL_HANGUP,
      callId: BUYER_1_LEG,
      hangupCause: 'TIMEOUT',
      timestamp: new Date().toISOString(),
    });

    expect(callsService.handleBuyerHangup).toHaveBeenCalledWith('call_2', 'att_1', 'TIMEOUT');
    expect(provider.hangupCall).not.toHaveBeenCalledWith(CALLER_LEG);

    // Buyer 2 timeout -> exhausted
    prisma.callAttempt.findUnique.mockResolvedValue(attempt2);
    callsService.handleBuyerHangup.mockResolvedValueOnce({ action: 'DIAL_NEXT', call });
    callsService.prepareNextBuyer.mockResolvedValueOnce({
      action: 'HANGUP',
      call: { ...call, state: CallState.NO_ANSWER },
    });

    await controller.handleEvent({
      type: CallEventType.CALL_HANGUP,
      callId: BUYER_2_LEG,
      hangupCause: 'NO_ANSWER',
      timestamp: new Date().toISOString(),
    });

    expect(provider.hangupCall).toHaveBeenCalledTimes(1);
    expect(provider.hangupCall).toHaveBeenCalledWith(CALLER_LEG);
    expect(provider.stopRingback).toHaveBeenCalledWith(CALLER_LEG);
  });

  // ---------------------------------------------------------------------------
  // Test 3: A buyer rejects but another eligible buyer remains; fallback continues
  // ---------------------------------------------------------------------------
  it('3. Buyer rejects but another eligible buyer remains -> fallback continues, ringback maintained', async () => {
    const call = {
      id: 'call_3',
      workspace_id: 'ws_1',
      provider_call_id: CALLER_LEG,
      to_number: '+15551112222',
      state: CallState.ROUTING,
      attempts: [],
    };

    const attempt1 = { id: 'att_1', call_id: 'call_3', provider_call_id: BUYER_1_LEG, state: CallAttemptState.RINGING, call };
    const attempt2 = { id: 'att_2', call_id: 'call_3', provider_call_id: BUYER_2_LEG, state: CallAttemptState.RINGING, call };

    prisma.callAttempt.findUnique.mockResolvedValue(attempt1);
    callsService.handleBuyerHangup.mockResolvedValueOnce({ action: 'DIAL_NEXT', call });
    callsService.prepareNextBuyer.mockResolvedValueOnce({
      action: 'DIAL',
      call,
      attempt: attempt2,
      buyer: { id: 'buyer_2', destination_number: '+15552223333', timeout: 30 },
    });
    provider.dialBuyer.mockResolvedValueOnce(BUYER_2_LEG);
    callsService.commitBuyerDial.mockResolvedValueOnce(false);

    await controller.handleEvent({
      type: CallEventType.CALL_HANGUP,
      callId: BUYER_1_LEG,
      hangupCause: 'CALL_REJECTED',
      timestamp: new Date().toISOString(),
    });

    // Fallback dialed buyer 2
    expect(provider.dialBuyer).toHaveBeenCalledWith(
      '+15552223333',
      '+15551112222',
      expect.any(String),
      30,
      expect.any(String),
      undefined,
    );
    // Caller not terminated
    expect(provider.hangupCall).not.toHaveBeenCalledWith(CALLER_LEG);
    // Ringback is ensured for caller
    expect(provider.startRingback).toHaveBeenCalledWith(CALLER_LEG);
  });

  // ---------------------------------------------------------------------------
  // Test 4: All buyers exhausted and caller hangup command fails -> recovery executes
  // ---------------------------------------------------------------------------
  it('4. All buyers exhausted and caller hangup fails -> recovery executes without getting stuck', async () => {
    const call = {
      id: 'call_4',
      workspace_id: 'ws_1',
      provider_call_id: CALLER_LEG,
      to_number: '+15551112222',
      state: CallState.ROUTING,
      attempts: [],
    };

    const attempt = { id: 'att_1', call_id: 'call_4', provider_call_id: BUYER_1_LEG, state: CallAttemptState.RINGING, call };

    prisma.callAttempt.findUnique.mockResolvedValue(attempt);
    callsService.handleBuyerHangup.mockResolvedValueOnce({ action: 'DIAL_NEXT', call });
    callsService.prepareNextBuyer.mockResolvedValueOnce({
      action: 'HANGUP',
      call: { ...call, state: CallState.NO_ANSWER },
    });

    // Simulate provider.hangupCall failing on routing exhaustion
    provider.hangupCall.mockRejectedValueOnce(new Error('Telnyx 500 Internal Server Error'));
    provider.getCallStatus.mockResolvedValueOnce('ACTIVE');
    provider.hangupCall.mockResolvedValueOnce(undefined); // retry hangup succeeds

    const finalizedCall = { ...call, state: CallState.NO_ANSWER, ended_at: new Date() };
    callsService.handleCallerHangup.mockResolvedValueOnce(finalizedCall);

    await controller.handleEvent({
      type: CallEventType.CALL_HANGUP,
      callId: BUYER_1_LEG,
      hangupCause: 'CALL_REJECTED',
      timestamp: new Date().toISOString(),
    });

    // Checked status and invoked recovery
    expect(provider.getCallStatus).toHaveBeenCalledWith(CALLER_LEG);
    expect(callsService.handleCallerHangup).toHaveBeenCalledWith(CALLER_LEG);
    expect(usageBillingService.billCallUsage).toHaveBeenCalledWith('ws_1', 'call_4', 'local', 0);
  });

  // ---------------------------------------------------------------------------
  // Test 5: Duplicate buyer-hangup events do not initiate duplicate fallback
  // ---------------------------------------------------------------------------
  it('5. Duplicate buyer-hangup events do not initiate duplicate fallback', async () => {
    const attempt = {
      id: 'att_terminal',
      call_id: 'call_5',
      provider_call_id: BUYER_1_LEG,
      state: CallAttemptState.NO_ANSWER, // already terminal!
      call: { id: 'call_5', state: CallState.ROUTING, provider_call_id: CALLER_LEG },
    };

    prisma.call.findUnique.mockResolvedValue(null);
    prisma.callAttempt.findUnique.mockResolvedValue(attempt);
    callsService.markCallAnswered.mockResolvedValue(true);

    await controller.handleEvent({
      type: CallEventType.CALL_HANGUP,
      callId: BUYER_1_LEG,
      hangupCause: 'USER_BUSY',
      timestamp: new Date().toISOString(),
    });

    expect(callsService.handleBuyerHangup).not.toHaveBeenCalled();
    expect(callsService.prepareNextBuyer).not.toHaveBeenCalled();
    expect(provider.dialBuyer).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Test 6: Caller hangup and buyer hangup arrive out of order
  // ---------------------------------------------------------------------------
  it('6. Caller hangup arrives before buyer hangup -> buyer attempt canceled and late buyer hangup ignored', async () => {
    const callerCall = {
      id: 'call_6',
      workspace_id: 'ws_1',
      provider_call_id: CALLER_LEG,
      state: CallState.ROUTING,
      ended_at: null,
      attempts: [
        { id: 'att_active', provider_call_id: BUYER_1_LEG, state: CallAttemptState.RINGING },
      ],
    };

    // 1. Caller hangs up first
    prisma.call.findUnique.mockResolvedValue(callerCall);
    const updatedCall = {
      ...callerCall,
      state: CallState.NO_ANSWER,
      ended_at: new Date(),
      attempts: [
        { id: 'att_active', provider_call_id: BUYER_1_LEG, state: CallAttemptState.CANCELED },
      ],
    };
    callsService.handleCallerHangup.mockResolvedValue(updatedCall);

    await controller.handleEvent({
      type: CallEventType.CALL_HANGUP,
      callId: CALLER_LEG,
      timestamp: new Date().toISOString(),
    });

    // Caller hangup canceled active buyer leg
    expect(provider.hangupCall).toHaveBeenCalledWith(BUYER_1_LEG);
    expect(provider.stopRingback).toHaveBeenCalledWith(CALLER_LEG);

    // 2. Late buyer hangup arrives
    prisma.call.findUnique.mockResolvedValue(null);
    prisma.callAttempt.findUnique.mockResolvedValue({
      id: 'att_active',
      call_id: 'call_6',
      provider_call_id: BUYER_1_LEG,
      state: CallAttemptState.CANCELED, // already canceled!
      call: updatedCall,
    });

    await controller.handleEvent({
      type: CallEventType.CALL_HANGUP,
      callId: BUYER_1_LEG,
      timestamp: new Date().toISOString(),
    });

    // Ignored idempotently without advancing routing
    expect(callsService.handleBuyerHangup).not.toHaveBeenCalled();
    expect(provider.dialBuyer).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Test 7: Ringback begins during buyer ringing, stops after successful bridge, and stops on terminal failure
  // ---------------------------------------------------------------------------
  it('7. Ringback starts on caller answer, stops before bridge, and stops on hangup', async () => {
    const call = {
      id: 'call_7',
      workspace_id: 'ws_1',
      provider_call_id: CALLER_LEG,
      state: CallState.INITIATED,
      attempts: [],
    };

    // Caller answered
    prisma.call.findUnique.mockResolvedValue(call);
    callsService.transitionCall.mockResolvedValue({ ...call, state: CallState.ROUTING });
    callsService.prepareNextBuyer.mockResolvedValue({ action: 'NONE' });
    await controller.handleEvent({
      type: CallEventType.CALL_ANSWERED,
      callId: CALLER_LEG,
      timestamp: new Date().toISOString(),
    });

    expect(provider.startRingback).toHaveBeenCalledWith(CALLER_LEG);

    // Buyer answered -> stops ringback BEFORE bridge
    const attempt = {
      id: 'att_7',
      call_id: 'call_7',
      provider_call_id: BUYER_1_LEG,
      state: CallAttemptState.RINGING,
      call: { ...call, state: CallState.ROUTING },
    };
    prisma.call.findUnique.mockResolvedValue(null);
    prisma.callAttempt.findUnique.mockResolvedValue(attempt);
    callsService.markCallAnswered.mockResolvedValue(true);

    await controller.handleEvent({
      type: CallEventType.CALL_ANSWERED,
      callId: BUYER_1_LEG,
      timestamp: new Date().toISOString(),
    });

    expect(provider.stopRingback).toHaveBeenCalledWith(CALLER_LEG);
    expect(provider.bridgeCalls).toHaveBeenCalledWith(CALLER_LEG, BUYER_1_LEG);
  });

  // ---------------------------------------------------------------------------
  // Test 8: No talk duration or usage charge is recorded for unsuccessful, unbridged attempts
  // ---------------------------------------------------------------------------
  it('8. Unbridged calls record 0 talk duration and no CALL_MINUTE charges in CallsService', async () => {
    const unbridgedCall = {
      id: 'call_8',
      workspace_id: 'ws_1',
      provider_call_id: CALLER_LEG,
      state: CallState.NO_ANSWER,
      created_at: new Date(Date.now() - 45000), // 45 seconds ago
      answered_at: null, // Never bridged/answered commercially!
      duration_secs: null,
      ended_at: null,
      attempts: [
        { id: 'att_1', state: CallAttemptState.NO_ANSWER, ended_at: new Date() },
        { id: 'att_2', state: CallAttemptState.NO_ANSWER, ended_at: new Date() },
      ],
    };

    prisma.call.findUnique.mockResolvedValue(unbridgedCall);
    prisma.call.update.mockImplementation(({ data }: any) => ({ ...unbridgedCall, ...data }));

    const callsServiceModule = await Test.createTestingModule({
      providers: [
        CallsService,
        { provide: PrismaService, useValue: prisma },
        { provide: UsageService, useValue: usageService },
        { provide: WebhooksService, useValue: webhooksService },
        { provide: PermissionsService, useValue: {} },
      ],
    }).compile();

    const realCallsService = callsServiceModule.get<CallsService>(CallsService);

    const result = await realCallsService.handleCallerHangup(CALLER_LEG);

    expect(result.state).toBe(CallState.NO_ANSWER);
    expect(result.duration_secs).toBe(0);
    // Must NOT bill any call minutes for unbridged call
    expect(usageService.recordUsage).not.toHaveBeenCalledWith(
      expect.anything(),
      UsageType.CALL_MINUTE,
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });

  // ---------------------------------------------------------------------------
  // Test 9: A successful bridged conversation is not terminated by a late routing-exhausted event
  // ---------------------------------------------------------------------------
  it('9. A successful bridged conversation is not terminated by late routing-exhausted event', async () => {
    const call = {
      id: 'call_9',
      workspace_id: 'ws_1',
      provider_call_id: CALLER_LEG,
      state: CallState.COMPLETED, // Already bridged & active/completed
      attempts: [],
    };

    callsService.prepareNextBuyer.mockResolvedValueOnce({
      action: 'HANGUP',
      call,
    });

    // In dialNextBuyer: should check call.state === COMPLETED and ignore HANGUP
    await (controller as any).dialNextBuyer(call);

    expect(provider.hangupCall).not.toHaveBeenCalledWith(CALLER_LEG);
  });

  // ---------------------------------------------------------------------------
  // Test 10: TelnyxProvider startRingback, stopRingback, and hangupCall error handling
  // ---------------------------------------------------------------------------
  it('10. TelnyxProvider startRingback, stopRingback and hangupCall adhere to Call Control contracts', async () => {
    process.env.TELNYX_API_KEY = 'test_key_ringback';
    const telnyx = new TelnyxProvider();

    const mockStartPlayback = vi.fn().mockResolvedValue({});
    const mockStopPlayback = vi.fn().mockResolvedValue({});
    const mockHangup = vi.fn().mockResolvedValue({});

    (telnyx as any).telnyxClient = {
      calls: {
        actions: {
          startPlayback: mockStartPlayback,
          stopPlayback: mockStopPlayback,
          hangup: mockHangup,
        },
      },
    };

    // Test startRingback
    await telnyx.startRingback('v3:test_leg_123', 'http://custom/ringback.mp3');
    expect(mockStartPlayback).toHaveBeenCalledWith('v3:test_leg_123', {
      audio_url: 'http://custom/ringback.mp3',
      loop: 'infinity',
      overlay: false,
      target_legs: 'self',
    });

    // Test stopRingback
    await telnyx.stopRingback('v3:test_leg_123');
    expect(mockStopPlayback).toHaveBeenCalledWith('v3:test_leg_123', {
      stop: 'all',
    });

    // Test hangupCall idempotent 404
    mockHangup.mockRejectedValueOnce({
      raw: {
        statusCode: 404,
        message: 'Call not found or already ended',
      },
    });
    // Should NOT throw for 404
    await expect(telnyx.hangupCall('v3:test_leg_123')).resolves.toBeUndefined();

    // Test hangupCall non-404 error throws TelephonyProviderError
    mockHangup.mockRejectedValueOnce({
      raw: {
        statusCode: 500,
        message: 'Internal Gateway Error',
      },
    });
    await expect(telnyx.hangupCall('v3:test_leg_123')).rejects.toThrow(TelephonyProviderError);
  });

  // ---------------------------------------------------------------------------
  // Test 11: Confirmed bridge with persisted positive talk duration
  // ---------------------------------------------------------------------------
  it('11. Confirmed bridge with persisted positive talk duration: markCallAnswered sets answered_at on call and attempt', async () => {
    const answeredTime = new Date(Date.now() - 25000); // 25 seconds ago
    let updatedAttemptData: any = null;
    let updatedCallData: any = null;

    const callRecord = {
      id: 'call_11',
      workspace_id: 'ws_1',
      provider_call_id: CALLER_LEG,
      state: CallState.ROUTING,
      created_at: new Date(Date.now() - 30000),
      answered_at: null,
      ended_at: null,
      duration_secs: null,
      attempts: [],
    };

    const attemptRecord = {
      id: 'att_11',
      call_id: 'call_11',
      provider_call_id: BUYER_1_LEG,
      state: CallAttemptState.RINGING,
    };

    prisma.call.findUnique.mockResolvedValue(callRecord);
    prisma.callAttempt.findUnique.mockResolvedValue(attemptRecord);
    prisma.callAttempt.update.mockImplementation(({ data }: any) => {
      updatedAttemptData = data;
      return { ...attemptRecord, ...data };
    });
    prisma.call.update.mockImplementation(({ data }: any) => {
      updatedCallData = data;
      return { ...callRecord, ...data };
    });

    const callsServiceModule = await Test.createTestingModule({
      providers: [
        CallsService,
        { provide: PrismaService, useValue: prisma },
        { provide: UsageService, useValue: usageService },
        { provide: WebhooksService, useValue: webhooksService },
        { provide: PermissionsService, useValue: {} },
      ],
    }).compile();

    const realCallsService = callsServiceModule.get<CallsService>(CallsService);

    // 1. Mark call answered
    const success = await realCallsService.markCallAnswered('call_11', 'att_11');
    expect(success).toBe(true);
    expect(updatedAttemptData.state).toBe(CallAttemptState.ANSWERED);
    expect(updatedAttemptData.answered_at).toBeInstanceOf(Date);
    expect(updatedCallData.state).toBe(CallState.COMPLETED);
    expect(updatedCallData.answered_at).toBeInstanceOf(Date);

    // 2. 25 seconds later, caller hangs up
    const answeredCall = {
      ...callRecord,
      state: CallState.COMPLETED,
      answered_at: answeredTime,
      attempts: [
        {
          ...attemptRecord,
          state: CallAttemptState.ANSWERED,
          answered_at: answeredTime,
        },
      ],
    };
    prisma.call.findUnique.mockResolvedValue(answeredCall);
    const hangupResult = await realCallsService.handleCallerHangup(CALLER_LEG);

    expect(hangupResult.state).toBe(CallState.COMPLETED);
    expect(hangupResult.duration_secs).toBeGreaterThanOrEqual(25);
    expect(usageService.recordUsage).toHaveBeenCalledWith(
      'ws_1',
      UsageType.CALL_MINUTE,
      1, // 25s rounded up to 1 min
      'call_11',
      'CALL_MINUTE_call_11',
    );
  });

  // ---------------------------------------------------------------------------
  // Test 12: Bridged call ending normally settles reservation and triggers commercial evaluation
  // ---------------------------------------------------------------------------
  it('12. Bridged call ending normally bills positive talk duration and triggers commercial evaluation', async () => {
    const answeredTime = new Date(Date.now() - 25000);
    const activeBridgedCall = {
      id: 'call_12',
      workspace_id: 'ws_1',
      provider_call_id: CALLER_LEG,
      to_number: '+15551112222',
      state: CallState.COMPLETED,
      answered_at: answeredTime,
      ended_at: null,
      duration_secs: null,
      attempts: [
        {
          id: 'att_12',
          provider_call_id: BUYER_1_LEG,
          state: CallAttemptState.ANSWERED,
          answered_at: answeredTime,
        },
      ],
    };

    const completedCall = {
      ...activeBridgedCall,
      ended_at: new Date(),
      duration_secs: 25,
      attempts: [
        {
          ...activeBridgedCall.attempts[0],
          state: CallAttemptState.COMPLETED,
          duration_secs: 25,
        },
      ],
    };

    prisma.call.findUnique.mockResolvedValue(activeBridgedCall);
    callsService.handleCallerHangup.mockResolvedValue(completedCall);
    usageBillingService.billCallUsage.mockResolvedValue({ billed: true, minutes: 1 });

    await controller.handleEvent({
      type: CallEventType.CALL_HANGUP,
      callId: CALLER_LEG,
      timestamp: new Date().toISOString(),
    });

    // Talk duration billed as 25s
    expect(usageBillingService.billCallUsage).toHaveBeenCalledWith(
      'ws_1',
      'call_12',
      'local',
      25,
    );
    // Commercial evaluation triggered
    expect(commercialEvaluatorService.evaluateCall).toHaveBeenCalledWith('call_12');
  });

  // ---------------------------------------------------------------------------
  // Test 13: Genuinely unbridged call maintains zero duration, releases reservation, defers commercial eval
  // ---------------------------------------------------------------------------
  it('13. Genuinely unbridged call maintains zero duration, releases reservation, and defers commercial eval', async () => {
    const activeRoutingCall = {
      id: 'call_13',
      workspace_id: 'ws_1',
      provider_call_id: CALLER_LEG,
      to_number: '+15551112222',
      state: CallState.ROUTING,
      answered_at: null,
      ended_at: null,
      duration_secs: null,
      attempts: [
        { id: 'att_1', state: CallAttemptState.NO_ANSWER },
        { id: 'att_2', state: CallAttemptState.NO_ANSWER },
      ],
    };

    const finalizedUnbridgedCall = {
      ...activeRoutingCall,
      state: CallState.NO_ANSWER,
      ended_at: new Date(),
      duration_secs: 0,
    };

    prisma.call.findUnique.mockResolvedValue(activeRoutingCall);
    callsService.handleCallerHangup.mockResolvedValue(finalizedUnbridgedCall);
    usageBillingService.billCallUsage.mockResolvedValue({
      billed: false,
      reason: 'Zero talk duration, reservation released',
    });

    await controller.handleEvent({
      type: CallEventType.CALL_HANGUP,
      callId: CALLER_LEG,
      timestamp: new Date().toISOString(),
    });

    expect(usageBillingService.billCallUsage).toHaveBeenCalledWith(
      'ws_1',
      'call_13',
      'local',
      0,
    );
    // State is NO_ANSWER, so commercialEvaluatorService is NOT evaluated
    expect(commercialEvaluatorService.evaluateCall).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Test 14: Late and duplicate hangup events handled idempotently after bridge
  // ---------------------------------------------------------------------------
  it('14. Late and duplicate hangup events are handled idempotently after bridge', async () => {
    const finalizedCall = {
      id: 'call_14',
      workspace_id: 'ws_1',
      provider_call_id: CALLER_LEG,
      state: CallState.COMPLETED,
      answered_at: new Date(Date.now() - 30000),
      ended_at: new Date(),
      duration_secs: 25,
      attempts: [],
    };

    // Duplicate caller hangup
    prisma.call.findUnique.mockResolvedValue(finalizedCall);
    await controller.handleEvent({
      type: CallEventType.CALL_HANGUP,
      callId: CALLER_LEG,
      timestamp: new Date().toISOString(),
    });

    // Should return early and not re-process
    expect(callsService.handleCallerHangup).not.toHaveBeenCalled();

    // Late buyer hangup for already terminal attempt
    prisma.call.findUnique.mockResolvedValue(null);
    prisma.callAttempt.findUnique.mockResolvedValue({
      id: 'att_14',
      provider_call_id: BUYER_1_LEG,
      state: CallAttemptState.COMPLETED,
      call: finalizedCall,
    });

    await controller.handleEvent({
      type: CallEventType.CALL_HANGUP,
      callId: BUYER_1_LEG,
      timestamp: new Date().toISOString(),
    });

    expect(callsService.handleBuyerHangup).not.toHaveBeenCalled();
    expect(provider.hangupCall).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Test 15: Repeated ringback start/stop idempotency
  // ---------------------------------------------------------------------------
  it('15. Repeated ringback start/stop idempotency: single startPlayback, Telnyx 90018 suppressed', async () => {
    const call = {
      id: 'call_15',
      workspace_id: 'ws_1',
      provider_call_id: CALLER_LEG,
      state: CallState.INITIATED,
      attempts: [],
    };

    prisma.call.findUnique.mockResolvedValue(call);
    callsService.transitionCall.mockResolvedValue({ ...call, state: CallState.ROUTING });
    callsService.prepareNextBuyer.mockResolvedValue({
      action: 'DIAL',
      call: { ...call, state: CallState.ROUTING },
      attempt: { id: 'att_15', buyer_id: 'b1' },
      buyer: { destination_number: '+15559998888', timeout: 30 },
    });
    provider.dialBuyer.mockResolvedValue(BUYER_1_LEG);

    // Inbound answer starts ringback
    await controller.handleEvent({
      type: CallEventType.CALL_ANSWERED,
      callId: CALLER_LEG,
      timestamp: new Date().toISOString(),
    });

    // Ringback started exactly once
    expect(provider.startRingback).toHaveBeenCalledTimes(1);
    expect(provider.startRingback).toHaveBeenCalledWith(CALLER_LEG);

    // Verify TelnyxProvider suppresses 90018 on stopRingback
    process.env.TELNYX_API_KEY = 'test_key';
    const telnyx = new TelnyxProvider();
    const mockStop = vi.fn().mockRejectedValue({
      raw: { errors: [{ code: '90018', title: 'Call has already ended' }] },
      message: 'Call has already ended',
    });
    (telnyx as any).telnyxClient = { calls: { actions: { stopPlayback: mockStop } } };

    await expect(telnyx.stopRingback('v3:ended_leg')).resolves.toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // Test 16: Buyer-hangup on bridged call triggers clean caller hangup with positive talk duration
  // ---------------------------------------------------------------------------
  it('16. Buyer-hangup on bridged call triggers clean caller hangup with positive talk duration', async () => {
    const answeredTime = new Date(Date.now() - 25000);
    const bridgedCall = {
      id: 'call_16',
      workspace_id: 'ws_1',
      provider_call_id: CALLER_LEG,
      to_number: '+15551112222',
      state: CallState.COMPLETED,
      answered_at: answeredTime,
      ended_at: null,
      attempts: [
        {
          id: 'att_16',
          provider_call_id: BUYER_1_LEG,
          state: CallAttemptState.ANSWERED,
          answered_at: answeredTime,
        },
      ],
    };

    const finalizedCall = {
      ...bridgedCall,
      ended_at: new Date(),
      duration_secs: 25,
    };

    prisma.call.findUnique.mockResolvedValue(null);
    prisma.callAttempt.findUnique.mockResolvedValue({
      id: 'att_16',
      call_id: 'call_16',
      provider_call_id: BUYER_1_LEG,
      state: CallAttemptState.ANSWERED,
      call: bridgedCall,
    });

    callsService.handleBuyerHangup.mockResolvedValue({
      action: 'HANGUP_CALLER',
      call: bridgedCall,
    });
    callsService.handleCallerHangup.mockResolvedValue(finalizedCall);

    await controller.handleEvent({
      type: CallEventType.CALL_HANGUP,
      callId: BUYER_1_LEG,
      hangupCause: 'NORMAL_CLEARING',
      timestamp: new Date().toISOString(),
    });

    expect(provider.hangupCall).toHaveBeenCalledWith(CALLER_LEG);
    expect(callsService.handleCallerHangup).toHaveBeenCalledWith(CALLER_LEG);
    expect(usageBillingService.billCallUsage).toHaveBeenCalledWith(
      'ws_1',
      'call_16',
      'local',
      25,
    );
    expect(commercialEvaluatorService.evaluateCall).toHaveBeenCalledWith('call_16');
  });
});
