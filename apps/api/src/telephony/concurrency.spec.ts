import { Test, TestingModule } from '@nestjs/testing';
import { CallController, TELEPHONY_PROVIDER } from './call-controller.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CallsService } from '../calls/calls.service.js';
import { UsageService } from '../usage/usage.service.js';
import { WebhooksService } from '../webhooks/webhooks.service.js';
import { CallEventType } from './telephony.events.js';
import { CallState, CallAttemptState } from '@prisma/client';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('Routing Concurrency Tests', () => {
  let controller: CallController;
  let provider: any;
  let prisma: any;
  let callsService: any;
  let usageService: any;
  let webhooksService: any;

  beforeEach(async () => {
    provider = {
      answerCall: vi.fn(),
      hangupCall: vi.fn(),
      bridgeCalls: vi.fn(),
      startRecording: vi.fn(),
      dialBuyer: vi.fn().mockResolvedValue('buyer_call_id_123'),
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
      campaign: {
        findUnique: vi.fn(),
      },
      phoneNumber: {
        findFirst: vi.fn(),
      },
      blockedCaller: {
        findUnique: vi.fn(),
      },
    };

    callsService = {
      createCall: vi.fn(),
      transitionCall: vi.fn(),
      handleCallerHangup: vi.fn(),
      createCallAttempt: vi.fn(),
      transitionAttempt: vi.fn(),
      markCallAnswered: vi.fn(),
      handleBuyerHangup: vi.fn(),
      prepareNextBuyer: vi.fn(),
      commitBuyerDial: vi.fn(),
    };

    usageService = {
      recordUsage: vi.fn(),
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
        { provide: WebhooksService, useValue: webhooksService },
      ],
    }).compile();

    controller = module.get<CallController>(CallController);
  });

  it('TEST 1: CALL_ANSWERED + CALL_HANGUP concurrently (hangup wins)', async () => {
    const mockCall = {
      id: 'call_1',
      provider_call_id: 'caller_123',
      state: CallState.ROUTING,
      attempts: [
        {
          id: 'attempt_1',
          provider_call_id: 'buyer_123',
          state: CallAttemptState.RINGING,
        }
      ]
    };
    const mockAttempt = { ...mockCall.attempts[0], call: mockCall };

    prisma.call.findUnique.mockImplementation(({ where }: any) => {
      if (where.provider_call_id === mockCall.provider_call_id || where.id === mockCall.id) {
        return Promise.resolve(mockCall);
      }
      return Promise.resolve(null);
    });
    prisma.callAttempt.findUnique.mockResolvedValue(mockAttempt);

    callsService.handleCallerHangup.mockResolvedValue({
       ...mockCall,
       state: CallState.CANCELED,
       attempts: [
         { ...mockAttempt, state: CallAttemptState.CANCELED }
       ]
    });

    // Simulate DB lock rejecting the attempt transition because Call is no longer ROUTING
    callsService.markCallAnswered = vi.fn().mockResolvedValue(false);

    const eventAnswer = { type: CallEventType.CALL_ANSWERED, callId: 'buyer_123', direction: 'outgoing' };
    const eventHangup = { type: CallEventType.CALL_HANGUP, callId: 'caller_123', direction: 'incoming' };

    await Promise.all([
      controller.handleEvent(eventAnswer as any),
      controller.handleEvent(eventHangup as any)
    ]);

    expect(callsService.handleCallerHangup).toHaveBeenCalledWith('caller_123');
    expect(callsService.markCallAnswered).toHaveBeenCalledWith('call_1', 'attempt_1');
    expect(provider.hangupCall).toHaveBeenCalledWith('buyer_123');
    expect(provider.bridgeCalls).not.toHaveBeenCalled(); // Verified side-effect: we do not bridge!
  });

  it('TEST 2: Buyer answer concurrent with caller hangup while dialNextBuyer is persisting', async () => {
    const mockCall = {
      id: 'call_1',
      provider_call_id: 'caller_123',
      state: CallState.ROUTING,
      campaign_id: 'camp_1',
      to_number: '+15550001111',
    };

    callsService.prepareNextBuyer.mockResolvedValue({
      action: 'DIAL',
      call: mockCall,
      attempt: { id: 'attempt_new' },
      buyer: { destination_number: '+15551234567', timeout: 30 }
    });

    // Simulate commitBuyerDial determining that the call was canceled (returns true for shouldHangup)
    callsService.commitBuyerDial.mockResolvedValue(true);

    await (controller as any).dialNextBuyer(mockCall, 'conn_1');

    // Verification: We MUST hang up the buyer if the caller canceled during dial!
    expect(provider.hangupCall).toHaveBeenCalledWith('buyer_call_id_123');
  });

  it('TEST 3: Two concurrent routing events for the same Call', async () => {
    const event1 = { type: CallEventType.CALL_HANGUP, callId: 'caller_123', direction: 'incoming' };
    const event2 = { type: CallEventType.CALL_HANGUP, callId: 'caller_123', direction: 'incoming' };

    prisma.call.findUnique.mockResolvedValue({
      id: 'call_1',
      provider_call_id: 'caller_123',
      state: CallState.ROUTING,
      attempts: []
    });
    callsService.handleCallerHangup.mockResolvedValue({ id: 'call_1', state: CallState.CANCELED, attempts: [] });

    await Promise.all([
      controller.handleEvent(event1 as any),
      controller.handleEvent(event2 as any)
    ]);

    expect(callsService.handleCallerHangup).toHaveBeenCalledTimes(2);
  });

  it('TEST 6: Normal sequential routing regression', async () => {
    const mockCall = {
      id: 'call_1',
      provider_call_id: 'caller_123',
      state: CallState.ROUTING,
      campaign_id: 'camp_1',
      to_number: '+15550001111',
      attempts: [{ id: 'att_1', buyer_id: 'b1', state: CallAttemptState.FAILED }]
    };
    prisma.call.findUnique.mockImplementation(({ where }: any) => {
      if (where.provider_call_id === mockCall.provider_call_id || where.id === mockCall.id) {
        return Promise.resolve(mockCall);
      }
      return Promise.resolve(null);
    });

    prisma.callAttempt.findUnique.mockResolvedValue({
       id: 'att_1',
       call_id: 'call_1',
       provider_call_id: 'buyer_123',
       state: CallAttemptState.RINGING,
       call: mockCall
    });

    callsService.handleBuyerHangup = vi.fn().mockResolvedValue({
       action: 'DIAL_NEXT',
       call: { ...mockCall, state: CallState.ROUTING }
    });

    callsService.prepareNextBuyer = vi.fn().mockResolvedValue({
       action: 'DIAL',
       call: mockCall,
       attempt: { id: 'att_2' },
       buyer: { destination_number: '+222' }
    });
    callsService.commitBuyerDial.mockResolvedValue(false);

    const event = { type: CallEventType.CALL_HANGUP, callId: 'buyer_123' };
    await controller.handleEvent(event as any);

    expect(callsService.handleBuyerHangup).toHaveBeenCalledWith('call_1', 'att_1');
    expect(callsService.prepareNextBuyer).toHaveBeenCalledWith('call_1');
    expect(provider.dialBuyer).toHaveBeenCalledWith('+222', '+15550001111', '', undefined);
  });

  it('TEST 7: Successful higher-priority buyer -> does NOT dial next', async () => {
    const mockCall = { id: 'call_1', provider_call_id: 'caller_123', state: CallState.ROUTING };
    const mockAttempt = { id: 'att_1', call_id: 'call_1', provider_call_id: 'buyer_123', state: CallAttemptState.RINGING, call: mockCall };

    prisma.call.findUnique.mockImplementation(({ where }: any) => {
      if (where.provider_call_id === mockCall.provider_call_id || where.id === mockCall.id) {
        return Promise.resolve(mockCall);
      }
      return Promise.resolve(null);
    });
    prisma.callAttempt.findUnique.mockResolvedValue(mockAttempt);
    callsService.markCallAnswered = vi.fn().mockResolvedValue(true);

    const event = { type: CallEventType.CALL_ANSWERED, callId: 'buyer_123' };
    await controller.handleEvent(event as any);

    expect(callsService.markCallAnswered).toHaveBeenCalledWith('call_1', 'att_1');
    expect(provider.bridgeCalls).toHaveBeenCalledWith('caller_123', 'buyer_123');
    expect(callsService.createCallAttempt).not.toHaveBeenCalled();
  });
});
