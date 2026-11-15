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

describe('Telnyx Telephony CallFlow Integration & Regression Suite', () => {
  let controller: CallController;
  let provider: any;
  let prisma: any;
  let callsService: any;
  let usageBillingService: any;
  let walletService: any;
  let webhooksService: any;

  beforeEach(async () => {
    provider = {
      answerCall: vi.fn().mockResolvedValue(undefined),
      hangupCall: vi.fn().mockResolvedValue(undefined),
      bridgeCalls: vi.fn().mockResolvedValue(undefined),
      startRecording: vi.fn().mockResolvedValue(undefined),
      dialBuyer: vi.fn().mockResolvedValue('buyer_call_id_123'),
      getCallStatus: vi.fn().mockResolvedValue('ACTIVE'),
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
        { provide: UsageBillingService, useValue: usageBillingService },
        { provide: WalletService, useValue: walletService },
        { provide: WebhooksService, useValue: webhooksService },
        { provide: UsageService, useValue: { recordUsage: vi.fn() } },
        { provide: PermissionsService, useValue: { getPermissionsForUser: vi.fn().mockResolvedValue([]) } },
      ],
    }).compile();

    controller = module.get<CallController>(CallController);
  });

  // Scenario 1: One inbound call creates exactly one initial buyer dial attempt
  it('Scenario 1: One inbound call creates exactly one initial buyer dial attempt', async () => {
    prisma.call.findUnique.mockResolvedValueOnce(null); // No call exists initially
    callsService.createCall.mockResolvedValue({
      id: 'call_1',
      provider_call_id: 'caller_123',
      workspace_id: 'ws_1',
      to_number: '+15551112222',
      from_number: '+15559990000',
      state: CallState.INITIATED,
    });

    // 1. CALL_INITIATED arrives
    await controller.handleEvent({
      type: CallEventType.CALL_INITIATED,
      callId: 'caller_123',
      direction: 'incoming',
      to: '+15551112222',
      from: '+15559990000',
      timestamp: new Date().toISOString(),
    });

    expect(callsService.createCall).toHaveBeenCalledTimes(1);
    expect(provider.answerCall).toHaveBeenCalledWith('caller_123');

    // 2. Caller answers -> CALL_ANSWERED
    const mockCall = {
      id: 'call_1',
      provider_call_id: 'caller_123',
      state: CallState.INITIATED,
      to_number: '+15551112222',
    };
    prisma.call.findUnique.mockResolvedValue(mockCall);
    callsService.transitionCall.mockResolvedValue({ ...mockCall, state: CallState.ROUTING });
    callsService.prepareNextBuyer.mockResolvedValue({
      action: 'DIAL',
      call: { ...mockCall, state: CallState.ROUTING },
      attempt: { id: 'att_1' },
      buyer: { destination_number: '+15553334444', timeout: 30 },
    });
    callsService.commitBuyerDial.mockResolvedValue(false);

    await controller.handleEvent({
      type: CallEventType.CALL_ANSWERED,
      callId: 'caller_123',
      direction: 'incoming',
      timestamp: new Date().toISOString(),
    });

    expect(callsService.transitionCall).toHaveBeenCalledWith('call_1', CallState.ROUTING);
    expect(provider.dialBuyer).toHaveBeenCalledTimes(1);
    expect(provider.dialBuyer).toHaveBeenCalledWith(
      '+15553334444',
      '+15551112222',
      '',
      30,
      expect.any(String),
      undefined,
    );
  });

  // Scenario 2: Buyer answers and bridge succeeds
  it('Scenario 2: Buyer answers and bridge succeeds using live call-leg IDs', async () => {
    const mockCall = {
      id: 'call_1',
      provider_call_id: 'caller_123',
      to_number: '+15551112222',
      workspace_id: 'ws_1',
      state: CallState.ROUTING,
      attempts: [],
    };
    const mockAttempt = {
      id: 'att_1',
      call_id: 'call_1',
      provider_call_id: 'buyer_leg_456',
      state: CallAttemptState.RINGING,
      call: mockCall,
    };

    prisma.call.findUnique.mockResolvedValue(null);
    prisma.callAttempt.findUnique.mockResolvedValue(mockAttempt);
    callsService.markCallAnswered.mockResolvedValue(true);

    await controller.handleEvent({
      type: CallEventType.CALL_ANSWERED,
      callId: 'buyer_leg_456',
      direction: 'outgoing',
      timestamp: new Date().toISOString(),
    });

    expect(callsService.markCallAnswered).toHaveBeenCalledWith('call_1', 'att_1');
    expect(provider.bridgeCalls).toHaveBeenCalledWith('caller_123', 'buyer_leg_456');
  });

  // Scenario 3: Bridge command fails -> recovers deterministically
  it('Scenario 3: Bridge command fails -> cleans up failed leg and triggers fallback', async () => {
    const mockCall = {
      id: 'call_1',
      provider_call_id: 'caller_123',
      to_number: '+15551112222',
      workspace_id: 'ws_1',
      state: CallState.ROUTING,
      attempts: [],
    };
    const mockAttempt = {
      id: 'att_1',
      call_id: 'call_1',
      provider_call_id: 'buyer_leg_456',
      state: CallAttemptState.RINGING,
      call: mockCall,
    };

    prisma.call.findUnique.mockResolvedValue(null);
    prisma.callAttempt.findUnique.mockResolvedValue(mockAttempt);
    callsService.markCallAnswered.mockResolvedValue(true);
    provider.bridgeCalls.mockRejectedValue(new Error('Telnyx bridge rejected'));
    callsService.prepareNextBuyer.mockResolvedValue({ action: 'NONE' });

    await controller.handleEvent({
      type: CallEventType.CALL_ANSWERED,
      callId: 'buyer_leg_456',
      direction: 'outgoing',
      timestamp: new Date().toISOString(),
    });

    expect(provider.hangupCall).toHaveBeenCalledWith('buyer_leg_456');
    expect(callsService.handleBridgeFailure).toHaveBeenCalledWith('call_1', 'att_1');
    expect(callsService.prepareNextBuyer).toHaveBeenCalledWith('call_1');
  });

  // Scenario 4: Buyer answers but bridging is delayed
  it('Scenario 4: Buyer answers while caller canceled concurrently -> no bridge', async () => {
    const mockCall = {
      id: 'call_1',
      provider_call_id: 'caller_123',
      state: CallState.CANCELED,
    };
    const mockAttempt = {
      id: 'att_1',
      call_id: 'call_1',
      provider_call_id: 'buyer_leg_456',
      state: CallAttemptState.RINGING,
      call: mockCall,
    };

    prisma.call.findUnique.mockResolvedValue(null);
    prisma.callAttempt.findUnique.mockResolvedValue(mockAttempt);
    callsService.markCallAnswered.mockResolvedValue(false);

    await controller.handleEvent({
      type: CallEventType.CALL_ANSWERED,
      callId: 'buyer_leg_456',
      direction: 'outgoing',
      timestamp: new Date().toISOString(),
    });

    expect(provider.hangupCall).toHaveBeenCalledWith('buyer_leg_456');
    expect(provider.bridgeCalls).not.toHaveBeenCalled();
  });

  // Scenario 5: Buyer hangs up before bridging completes
  it('Scenario 5: Buyer hangs up before bridging completes -> triggers sequential fallback', async () => {
    const mockCall = {
      id: 'call_1',
      provider_call_id: 'caller_123',
      state: CallState.ROUTING,
      to_number: '+15551112222',
      attempts: [],
    };
    const mockAttempt = {
      id: 'att_1',
      call_id: 'call_1',
      provider_call_id: 'buyer_leg_456',
      state: CallAttemptState.RINGING,
      call: mockCall,
    };

    prisma.call.findUnique.mockResolvedValue(null);
    prisma.callAttempt.findUnique.mockResolvedValue(mockAttempt);
    callsService.handleBuyerHangup.mockResolvedValue({
      action: 'DIAL_NEXT',
      call: mockCall,
    });
    callsService.prepareNextBuyer.mockResolvedValue({
      action: 'DIAL',
      call: mockCall,
      attempt: { id: 'att_2' },
      buyer: { destination_number: '+15558889999', timeout: 25 },
    });
    callsService.commitBuyerDial.mockResolvedValue(false);

    await controller.handleEvent({
      type: CallEventType.CALL_HANGUP,
      callId: 'buyer_leg_456',
      timestamp: new Date().toISOString(),
    });

    expect(callsService.handleBuyerHangup).toHaveBeenCalledWith('call_1', 'att_1');
    expect(provider.dialBuyer).toHaveBeenCalledWith(
      '+15558889999',
      '+15551112222',
      '',
      25,
      expect.any(String),
      undefined,
    );
  });

  // Scenario 6: Caller hangs up while the buyer is ringing
  it('Scenario 6: Caller hangs up while the buyer is ringing -> terminates buyer leg and settles reservation', async () => {
    const mockCall = {
      id: 'call_1',
      provider_call_id: 'caller_123',
      to_number: '+15551112222',
      workspace_id: 'ws_1',
      state: CallState.ROUTING,
      attempts: [
        { id: 'att_1', provider_call_id: 'buyer_leg_456', state: CallAttemptState.RINGING },
      ],
    };

    prisma.call.findUnique.mockResolvedValue(mockCall);
    callsService.handleCallerHangup.mockResolvedValue({
      ...mockCall,
      state: CallState.CANCELED,
      attempts: [{ id: 'att_1', provider_call_id: 'buyer_leg_456', state: CallAttemptState.CANCELED }],
    });

    await controller.handleEvent({
      type: CallEventType.CALL_HANGUP,
      callId: 'caller_123',
      timestamp: new Date().toISOString(),
    });

    expect(callsService.handleCallerHangup).toHaveBeenCalledWith('caller_123');
    expect(provider.hangupCall).toHaveBeenCalledWith('buyer_leg_456');
    expect(usageBillingService.billCallUsage).toHaveBeenCalledWith(
      'ws_1',
      'call_1',
      'local',
      0,
    );
  });

  // Scenario 7: Caller hangs up after bridging
  it('Scenario 7: Caller hangs up after bridging -> terminates buyer and bills accurate talk duration', async () => {
    const answeredAt = new Date(Date.now() - 45000); // 45 seconds ago
    const mockCall = {
      id: 'call_1',
      provider_call_id: 'caller_123',
      to_number: '+15551112222',
      workspace_id: 'ws_1',
      state: CallState.COMPLETED,
      answered_at: answeredAt,
      ended_at: null,
      attempts: [
        { id: 'att_1', provider_call_id: 'buyer_leg_456', state: CallAttemptState.ANSWERED },
      ],
    };

    prisma.call.findUnique.mockResolvedValue(mockCall);
    callsService.handleCallerHangup.mockResolvedValue({
      ...mockCall,
      ended_at: new Date(),
    });

    await controller.handleEvent({
      type: CallEventType.CALL_HANGUP,
      callId: 'caller_123',
      timestamp: new Date().toISOString(),
    });

    expect(provider.hangupCall).toHaveBeenCalledWith('buyer_leg_456');
    expect(usageBillingService.billCallUsage).toHaveBeenCalledWith(
      'ws_1',
      'call_1',
      'local',
      expect.any(Number),
    );
  });

  // Scenario 8: Buyer hangs up after bridging -> terminates caller, no orphaned leg
  it('Scenario 8: Buyer hangs up after bridging -> terminates caller leg and settles call', async () => {
    const answeredAt = new Date(Date.now() - 30000);
    const mockCall = {
      id: 'call_1',
      provider_call_id: 'caller_123',
      to_number: '+15551112222',
      workspace_id: 'ws_1',
      state: CallState.COMPLETED,
      answered_at: answeredAt,
      attempts: [],
    };
    const mockAttempt = {
      id: 'att_1',
      call_id: 'call_1',
      provider_call_id: 'buyer_leg_456',
      state: CallAttemptState.ANSWERED,
      call: mockCall,
    };

    prisma.call.findUnique.mockResolvedValue(null);
    prisma.callAttempt.findUnique.mockResolvedValue(mockAttempt);
    callsService.handleBuyerHangup.mockResolvedValue({ action: 'HANGUP_CALLER' });
    callsService.handleCallerHangup.mockResolvedValue({
      ...mockCall,
      ended_at: new Date(),
    });

    await controller.handleEvent({
      type: CallEventType.CALL_HANGUP,
      callId: 'buyer_leg_456',
      timestamp: new Date().toISOString(),
    });

    expect(callsService.handleBuyerHangup).toHaveBeenCalledWith('call_1', 'att_1');
    expect(provider.hangupCall).toHaveBeenCalledWith('caller_123'); // Caller leg hung up!
    expect(callsService.handleCallerHangup).toHaveBeenCalledWith('caller_123'); // Local call finalized!
    expect(usageBillingService.billCallUsage).toHaveBeenCalledWith(
      'ws_1',
      'call_1',
      'local',
      expect.any(Number),
    );
  });

  // Scenario 9: Duplicate call.answered webhook
  it('Scenario 9: Duplicate call.answered webhook -> ignored idempotently without dialing or hanging up', async () => {
    const mockCall = {
      id: 'call_1',
      provider_call_id: 'caller_123',
      state: CallState.ROUTING,
      attempts: [],
    };

    prisma.call.findUnique.mockResolvedValue(mockCall);

    // Caller leg duplicate CALL_ANSWERED
    await controller.handleEvent({
      type: CallEventType.CALL_ANSWERED,
      callId: 'caller_123',
      timestamp: new Date().toISOString(),
    });

    expect(callsService.transitionCall).not.toHaveBeenCalled();
    expect(provider.dialBuyer).not.toHaveBeenCalled();

    // Buyer leg duplicate CALL_ANSWERED
    const mockAttempt = {
      id: 'att_1',
      call_id: 'call_1',
      provider_call_id: 'buyer_leg_456',
      state: CallAttemptState.ANSWERED,
      call: mockCall,
    };
    prisma.call.findUnique.mockResolvedValue(null);
    prisma.callAttempt.findUnique.mockResolvedValue(mockAttempt);

    await controller.handleEvent({
      type: CallEventType.CALL_ANSWERED,
      callId: 'buyer_leg_456',
      timestamp: new Date().toISOString(),
    });

    expect(callsService.markCallAnswered).not.toHaveBeenCalled();
    expect(provider.hangupCall).not.toHaveBeenCalled(); // DOES NOT HANG UP!
  });

  // Scenario 10: Duplicate call.hangup webhook
  it('Scenario 10: Duplicate call.hangup webhook -> safe NO-OP', async () => {
    const mockCall = {
      id: 'call_1',
      provider_call_id: 'caller_123',
      state: CallState.COMPLETED,
      ended_at: new Date(Date.now() - 10000),
      attempts: [],
    };
    prisma.call.findUnique.mockResolvedValue(mockCall);

    await controller.handleEvent({
      type: CallEventType.CALL_HANGUP,
      callId: 'caller_123',
      timestamp: new Date().toISOString(),
    });

    expect(callsService.handleCallerHangup).not.toHaveBeenCalled();
  });

  // Scenario 11: Duplicate inbound webhook (call.initiated)
  it('Scenario 11: Duplicate inbound call.initiated -> ignored', async () => {
    const existingCall = {
      id: 'call_1',
      provider_call_id: 'caller_123',
      state: CallState.INITIATED,
    };
    prisma.call.findUnique.mockResolvedValue(existingCall);

    await controller.handleEvent({
      type: CallEventType.CALL_INITIATED,
      callId: 'caller_123',
      direction: 'incoming',
      to: '+15551112222',
      from: '+15559990000',
      timestamp: new Date().toISOString(),
    });

    expect(callsService.createCall).not.toHaveBeenCalled();
    expect(provider.answerCall).not.toHaveBeenCalled();
  });

  // Scenario 12: Timeout and buyer-answer events race
  it('Scenario 12: Timeout and buyer-answer race -> caller hangup wins, buyer hung up', async () => {
    const mockCall = {
      id: 'call_1',
      provider_call_id: 'caller_123',
      state: CallState.CANCELED,
      attempts: [],
    };
    const mockAttempt = {
      id: 'att_1',
      call_id: 'call_1',
      provider_call_id: 'buyer_leg_456',
      state: CallAttemptState.RINGING,
      call: mockCall,
    };
    prisma.call.findUnique.mockResolvedValue(null);
    prisma.callAttempt.findUnique.mockResolvedValue(mockAttempt);
    callsService.markCallAnswered.mockResolvedValue(false);

    await controller.handleEvent({
      type: CallEventType.CALL_ANSWERED,
      callId: 'buyer_leg_456',
      timestamp: new Date().toISOString(),
    });

    expect(provider.hangupCall).toHaveBeenCalledWith('buyer_leg_456');
    expect(provider.bridgeCalls).not.toHaveBeenCalled();
  });

  // Scenario 13: First buyer definitively fails and sequential fallback dials next buyer
  it('Scenario 13: Sequential fallback advances to next buyer in campaign priority', async () => {
    const mockCall = {
      id: 'call_1',
      provider_call_id: 'caller_123',
      to_number: '+15551112222',
      state: CallState.ROUTING,
      attempts: [],
    };
    const mockAttempt1 = {
      id: 'att_1',
      call_id: 'call_1',
      provider_call_id: 'buyer_leg_1',
      state: CallAttemptState.RINGING,
      call: mockCall,
    };

    prisma.call.findUnique.mockResolvedValue(null);
    prisma.callAttempt.findUnique.mockResolvedValue(mockAttempt1);
    callsService.handleBuyerHangup.mockResolvedValue({
      action: 'DIAL_NEXT',
      call: mockCall,
    });
    callsService.prepareNextBuyer.mockResolvedValue({
      action: 'DIAL',
      call: mockCall,
      attempt: { id: 'att_2' },
      buyer: { destination_number: '+15552223333', timeout: 30 },
    });
    callsService.commitBuyerDial.mockResolvedValue(false);

    await controller.handleEvent({
      type: CallEventType.CALL_HANGUP,
      callId: 'buyer_leg_1',
      timestamp: new Date().toISOString(),
    });

    expect(callsService.handleBuyerHangup).toHaveBeenCalledWith('call_1', 'att_1');
    expect(callsService.prepareNextBuyer).toHaveBeenCalledWith('call_1');
    expect(provider.dialBuyer).toHaveBeenCalledWith(
      '+15552223333',
      '+15551112222',
      '',
      30,
      expect.any(String),
      undefined,
    );
  });

  // Scenario 14: First buyer's status is ambiguous and fallback does not create duplicate active leg
  it('Scenario 14: Ambiguous attempt status prevents duplicate active buyer dialing', async () => {
    const mockCall = {
      id: 'call_1',
      provider_call_id: 'caller_123',
      state: CallState.ROUTING,
      attempts: [
        { id: 'att_1', state: CallAttemptState.RINGING },
      ],
    };

    callsService.prepareNextBuyer.mockResolvedValue({ action: 'NONE' });

    await (controller as any).dialNextBuyer(mockCall);

    expect(provider.dialBuyer).not.toHaveBeenCalled();
  });

  // Scenario 15: TelnyxProvider getCallStatus maps states accurately
  it('Scenario 15: TelnyxProvider maps active, terminal, NOT_FOUND, and UNKNOWN', async () => {
    process.env.TELNYX_API_KEY = 'test_key';
    const telnyx = new TelnyxProvider();
    const mockRetrieveStatus = vi.fn();
    (telnyx as any).telnyxClient = {
      calls: { retrieveStatus: mockRetrieveStatus },
    };

    // ACTIVE
    mockRetrieveStatus.mockResolvedValueOnce({ data: { call_state: 'bridged' } });
    expect(await telnyx.getCallStatus('v3:call-active')).toBe('ACTIVE');

    // TERMINAL
    mockRetrieveStatus.mockResolvedValueOnce({ data: { call_state: 'completed' } });
    expect(await telnyx.getCallStatus('v3:call-term')).toBe('TERMINAL');

    // NOT_FOUND
    mockRetrieveStatus.mockRejectedValueOnce({ raw: { status: 404 } });
    expect(await telnyx.getCallStatus('v3:call-notfound')).toBe('NOT_FOUND');

    // UNKNOWN
    mockRetrieveStatus.mockRejectedValueOnce(new Error('Connection error'));
    expect(await telnyx.getCallStatus('v3:call-unknown')).toBe('UNKNOWN');
  });

  // Scenario 16: Recovery worker encounters a mock/test provider call ID
  it('Scenario 16: TelnyxProvider ignores mock/test provider call IDs without API requests', async () => {
    process.env.TELNYX_API_KEY = 'test_key';
    const telnyx = new TelnyxProvider();
    const mockRetrieveStatus = vi.fn();
    (telnyx as any).telnyxClient = {
      calls: { retrieveStatus: mockRetrieveStatus },
    };

    const status1 = await telnyx.getCallStatus('mock_buyer_123');
    expect(status1).toBe('UNKNOWN');
    expect(mockRetrieveStatus).not.toHaveBeenCalled();

    const status2 = await telnyx.getCallStatus('recovery-mock-456');
    expect(status2).toBe('UNKNOWN');
    expect(mockRetrieveStatus).not.toHaveBeenCalled();
  });

  // Scenario 17: Settlement and wallet reservation cleanup occur at most once
  it('Scenario 17: Settlement occurs at most once on multiple cleanup triggers', async () => {
    const mockCall = {
      id: 'call_1',
      provider_call_id: 'caller_123',
      to_number: '+15551112222',
      workspace_id: 'ws_1',
      state: CallState.COMPLETED,
      answered_at: new Date(Date.now() - 20000),
      ended_at: null,
      attempts: [],
    };
    prisma.call.findUnique
      .mockResolvedValueOnce(mockCall)
      .mockResolvedValueOnce({ ...mockCall, ended_at: new Date() });
    callsService.handleCallerHangup.mockResolvedValue({
      ...mockCall,
      ended_at: new Date(),
    });

    // 1st hangup
    await controller.handleEvent({
      type: CallEventType.CALL_HANGUP,
      callId: 'caller_123',
      timestamp: new Date().toISOString(),
    });
    expect(usageBillingService.billCallUsage).toHaveBeenCalledTimes(1);

    // 2nd duplicate hangup
    await controller.handleEvent({
      type: CallEventType.CALL_HANGUP,
      callId: 'caller_123',
      timestamp: new Date().toISOString(),
    });
    // Remains exactly 1
    expect(usageBillingService.billCallUsage).toHaveBeenCalledTimes(1);
  });

  // Scenario 18: Existing multi-tenant boundaries remain enforced
  it('Scenario 18: Multi-tenant isolation is enforced for unknown/inactive workspaces', async () => {
    prisma.phoneNumber.findFirst.mockResolvedValueOnce({
      phone_number: '+15551112222',
      workspace_id: 'ws_suspended',
      status: 'ACTIVE',
      workspace: { status: 'SUSPENDED' },
      campaign: { id: 'camp_1', status: 'ACTIVE' },
    });

    await controller.handleEvent({
      type: CallEventType.CALL_INITIATED,
      callId: 'caller_123',
      direction: 'incoming',
      to: '+15551112222',
      from: '+15559990000',
      timestamp: new Date().toISOString(),
    });

    expect(prisma.call.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workspace_id: 'ws_suspended',
        state: CallState.FAILED,
      }),
    });
    expect(provider.hangupCall).toHaveBeenCalledWith('caller_123');
    expect(provider.answerCall).not.toHaveBeenCalled();
  });
});
