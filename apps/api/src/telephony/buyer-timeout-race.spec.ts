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
import { CallEventType } from './telephony.events.js';
import { CallState, CallAttemptState } from '@prisma/client';

describe('Buyer Timeout & Webhook Race Condition Forensic Suite', () => {
  let controller: CallController;
  let provider: any;
  let prisma: any;
  let callsService: any;
  let usageBillingService: any;
  let walletService: any;
  let webhooksService: any;
  let usageService: any;
  let commercialEvaluatorService: any;

  const CALLER_LEG = 'v3:caller_leg_trace_1';
  const BUYER_A_LEG = 'v3:buyer_a_leg_trace_1';
  const BUYER_B_LEG = 'v3:buyer_b_leg_trace_1';

  beforeEach(async () => {
    provider = {
      answerCall: vi.fn().mockResolvedValue(undefined),
      hangupCall: vi.fn().mockResolvedValue(undefined),
      bridgeCalls: vi.fn().mockResolvedValue(undefined),
      startRecording: vi.fn().mockResolvedValue(undefined),
      dialBuyer: vi.fn().mockResolvedValue(BUYER_B_LEG),
      getCallStatus: vi.fn().mockResolvedValue('ACTIVE'),
      startRingback: vi.fn().mockResolvedValue(undefined),
      stopRingback: vi.fn().mockResolvedValue(undefined),
    };

    prisma = {
      $transaction: vi.fn((cb) => cb(prisma)),
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'call_race_1' }]),
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
          phone_number: '+14845560110',
          workspace_id: 'ws_prod_1',
          number_type: 'local',
          status: 'ACTIVE',
          workspace: { status: 'ACTIVE' },
          campaign: { id: 'camp_prod_1', status: 'ACTIVE' },
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
  // Scenario 1: Answer arrives near timeout boundary (before hangup webhook) -> Bridge succeeds
  // ---------------------------------------------------------------------------
  it('Scenario 1: Buyer B answers at 19.5s (before timeout) -> bridge succeeds and subsequent timeout is ignored', async () => {
    const call = {
      id: 'call_race_1',
      workspace_id: 'ws_prod_1',
      provider_call_id: CALLER_LEG,
      to_number: '+14845560110',
      state: CallState.ROUTING,
      attempts: [],
    };

    const attemptB = {
      id: 'att_b_1',
      call_id: 'call_race_1',
      provider_call_id: BUYER_B_LEG,
      state: CallAttemptState.RINGING,
      call,
    };

    prisma.call.findUnique.mockResolvedValue(null);
    prisma.callAttempt.findUnique.mockResolvedValue(attemptB);
    callsService.markCallAnswered.mockResolvedValue(true);

    // Simulate ringback active on caller leg while waiting for buyer
    await (controller as any).startRingbackIfInactive('call_race_1', CALLER_LEG);

    // 1. CALL_ANSWERED arrives at 19.5s
    await controller.handleEvent({
      type: CallEventType.CALL_ANSWERED,
      callId: BUYER_B_LEG,
      direction: 'outbound',
      timestamp: new Date().toISOString(),
    });

    expect(callsService.markCallAnswered).toHaveBeenCalledWith('call_race_1', 'att_b_1');
    expect(provider.stopRingback).toHaveBeenCalledWith(CALLER_LEG);
    expect(provider.bridgeCalls).toHaveBeenCalledWith(CALLER_LEG, BUYER_B_LEG);
    expect(provider.hangupCall).not.toHaveBeenCalledWith(CALLER_LEG);

    // 2. A late/spurious CALL_HANGUP (timeout) arrives from provider afterwards
    attemptB.state = CallAttemptState.COMPLETED;
    await controller.handleEvent({
      type: CallEventType.CALL_HANGUP,
      callId: BUYER_B_LEG,
      hangupCause: 'TIMEOUT',
      timestamp: new Date().toISOString(),
    });

    // Since attempt is already terminal (COMPLETED), handleBuyerHangup is ignored (idempotent)
    expect(callsService.handleBuyerHangup).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Scenario 2: Out-of-order delivery: Provider sends CALL_HANGUP before CALL_ANSWERED
  // ---------------------------------------------------------------------------
  it('Scenario 2: Out-of-order webhooks (CALL_HANGUP arrives milliseconds before delayed CALL_ANSWERED)', async () => {
    const call = {
      id: 'call_race_2',
      workspace_id: 'ws_prod_1',
      provider_call_id: CALLER_LEG,
      to_number: '+14845560110',
      state: CallState.ROUTING,
      attempts: [],
    };

    const attemptB = {
      id: 'att_b_2',
      call_id: 'call_race_2',
      provider_call_id: BUYER_B_LEG,
      state: CallAttemptState.RINGING,
      call,
    };

    prisma.call.findUnique.mockResolvedValue(null);
    prisma.callAttempt.findUnique.mockResolvedValue(attemptB);

    // 1. Timeout hangup arrives first
    callsService.handleBuyerHangup.mockResolvedValueOnce({
      action: 'DIAL_NEXT',
      call: { ...call, state: CallState.NO_ANSWER },
    });
    callsService.prepareNextBuyer.mockResolvedValueOnce({
      action: 'HANGUP',
      call: { ...call, state: CallState.NO_ANSWER },
    });

    await controller.handleEvent({
      type: CallEventType.CALL_HANGUP,
      callId: BUYER_B_LEG,
      hangupCause: 'TIMEOUT',
      timestamp: new Date().toISOString(),
    });

    expect(callsService.handleBuyerHangup).toHaveBeenCalledWith('call_race_2', 'att_b_2', 'TIMEOUT');
    expect(provider.hangupCall).toHaveBeenCalledWith(CALLER_LEG);

    // 2. Delayed CALL_ANSWERED arrives after call is already exhausted & terminated
    attemptB.state = CallAttemptState.NO_ANSWER; // Now terminal in DB
    callsService.markCallAnswered.mockResolvedValueOnce(false); // Call is no longer ROUTING

    await controller.handleEvent({
      type: CallEventType.CALL_ANSWERED,
      callId: BUYER_B_LEG,
      direction: 'outbound',
      timestamp: new Date().toISOString(),
    });

    // markCallAnswered was checked, rejected (false), and buyer leg was hung up to prevent orphan
    expect(callsService.markCallAnswered).toHaveBeenCalledWith('call_race_2', 'att_b_2');
    expect(provider.bridgeCalls).not.toHaveBeenCalled();
    expect(provider.hangupCall).toHaveBeenCalledWith(BUYER_B_LEG);
  });

  // ---------------------------------------------------------------------------
  // Scenario 3: Early answer arrives via client_state correlation before commitBuyerDial
  // ---------------------------------------------------------------------------
  it('Scenario 3: Fast answer arrives before commitBuyerDial persists provider_call_id -> correlated via client_state', async () => {
    const call = {
      id: 'call_race_3',
      workspace_id: 'ws_prod_1',
      provider_call_id: CALLER_LEG,
      to_number: '+14845560110',
      state: CallState.ROUTING,
      attempts: [],
    };

    const attemptBWithoutCcid = {
      id: 'att_b_3',
      call_id: 'call_race_3',
      provider_call_id: null, // not yet committed!
      state: CallAttemptState.INITIATED,
      call,
    };

    // provider_call_id query returns null
    prisma.call.findUnique.mockResolvedValue(null);
    prisma.callAttempt.findUnique
      .mockResolvedValueOnce(null) // first query by provider_call_id fails
      .mockResolvedValueOnce(attemptBWithoutCcid); // second query by decoded clientState.attemptId succeeds

    callsService.markCallAnswered.mockResolvedValue(true);

    const clientStatePayload = {
      callId: 'call_race_3',
      attemptId: 'att_b_3',
      workspaceId: 'ws_prod_1',
    };
    const clientState = Buffer.from(JSON.stringify(clientStatePayload)).toString('base64');

    await controller.handleEvent({
      type: CallEventType.CALL_ANSWERED,
      callId: BUYER_B_LEG,
      direction: 'outbound',
      clientState,
      timestamp: new Date().toISOString(),
    });

    // Provider call id was backfilled
    expect(prisma.callAttempt.update).toHaveBeenCalledWith({
      where: { id: 'att_b_3' },
      data: { provider_call_id: BUYER_B_LEG },
    });
    // MarkCallAnswered was called and bridge succeeded
    expect(callsService.markCallAnswered).toHaveBeenCalledWith('call_race_3', 'att_b_3');
    expect(provider.bridgeCalls).toHaveBeenCalledWith(CALLER_LEG, BUYER_B_LEG);
  });
});
