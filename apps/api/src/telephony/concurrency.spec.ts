import { Test, TestingModule } from '@nestjs/testing';
import { CallController, TELEPHONY_PROVIDER } from './call-controller.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CallsService } from '../calls/calls.service.js';
import { UsageService } from '../usage/usage.service.js';
import { WebhooksService } from '../webhooks/webhooks.service.js';
import { CallEventType } from './telephony.events.js';
import { CallState, CallAttemptState } from '@prisma/client';
import { vi } from 'vitest';

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

  it('TEST 1: CALL_ANSWERED + CALL_HANGUP concurrently', async () => {
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
    const mockAttempt = mockCall.attempts[0];

    prisma.call.findUnique.mockResolvedValue(mockCall);
    prisma.callAttempt.findUnique.mockResolvedValue(mockAttempt);

    callsService.handleCallerHangup.mockResolvedValue({
       ...mockCall,
       state: CallState.CANCELED,
       attempts: [
         { ...mockAttempt, state: CallAttemptState.CANCELED }
       ]
    });

    const eventAnswer = { type: CallEventType.CALL_ANSWERED, callId: 'buyer_123', direction: 'outgoing' };
    const eventHangup = { type: CallEventType.CALL_HANGUP, callId: 'caller_123', direction: 'incoming' };

    await Promise.all([
      controller.handleEvent(eventAnswer as any),
      controller.handleEvent(eventHangup as any)
    ]);

    expect(callsService.handleCallerHangup).toHaveBeenCalledWith('caller_123');
    expect(callsService.transitionAttempt).toHaveBeenCalledWith('attempt_1', CallAttemptState.ANSWERED);
    expect(provider.hangupCall).toHaveBeenCalledWith('buyer_123');
  });

  it('TEST 2: Buyer answer concurrent with caller hangup while dialNextBuyer is persisting', async () => {
    const mockCall = {
      id: 'call_1',
      provider_call_id: 'caller_123',
      state: CallState.ROUTING,
      campaign_id: 'camp_1',
      to_number: '+15550001111',
    };
    prisma.campaign.findUnique.mockResolvedValue({
      id: 'camp_1',
      status: 'ACTIVE',
      buyers: [
        { buyer_id: 'b1', priority: 1, buyer: { status: 'ACTIVE', destination_number: '+15551234567', timeout: 30 } }
      ]
    });
    callsService.createCallAttempt.mockResolvedValue({ id: 'attempt_new', call_id: 'call_1' });
    prisma.$queryRaw.mockResolvedValue([{ id: 'call_1', state: CallState.CANCELED }]);

    await (controller as any).dialNextBuyer(mockCall, 'conn_1');

    expect(provider.hangupCall).toHaveBeenCalledWith('buyer_call_id_123');
    expect(prisma.callAttempt.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ state: CallAttemptState.CANCELED }) })
    );
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
    prisma.call.findUnique.mockResolvedValue(mockCall);
    prisma.campaign.findUnique.mockResolvedValue({
      id: 'camp_1',
      status: 'ACTIVE',
      buyers: [
        { buyer_id: 'b1', priority: 1, buyer: { status: 'ACTIVE', destination_number: '+111' } },
        { buyer_id: 'b2', priority: 2, buyer: { status: 'ACTIVE', destination_number: '+222' } }
      ]
    });
    prisma.$queryRaw.mockResolvedValue([{ id: 'call_1', state: CallState.ROUTING }]);
    callsService.createCallAttempt.mockResolvedValue({ id: 'att_2', call_id: 'call_1' });
    
    prisma.callAttempt.findUnique.mockResolvedValue({
       id: 'att_1',
       call_id: 'call_1',
       provider_call_id: 'buyer_123',
       state: CallAttemptState.RINGING,
       call: mockCall
    });

    const event = { type: CallEventType.CALL_HANGUP, callId: 'buyer_123' };
    await controller.handleEvent(event as any);

    expect(callsService.transitionAttempt).toHaveBeenCalledWith('att_1', CallAttemptState.NO_ANSWER);
    expect(callsService.createCallAttempt).toHaveBeenCalledWith(expect.objectContaining({ buyer_id: 'b2' }));
  });

  it('TEST 7: Successful higher-priority buyer -> does NOT dial next', async () => {
    const mockCall = { id: 'call_1', provider_call_id: 'caller_123', state: CallState.ROUTING };
    const mockAttempt = { id: 'att_1', call_id: 'call_1', provider_call_id: 'buyer_123', state: CallAttemptState.RINGING, call: mockCall };
    
    prisma.call.findUnique.mockResolvedValue(mockCall);
    prisma.callAttempt.findUnique.mockResolvedValue(mockAttempt);

    const event = { type: CallEventType.CALL_ANSWERED, callId: 'buyer_123' };
    await controller.handleEvent(event as any);

    expect(callsService.transitionAttempt).toHaveBeenCalledWith('att_1', CallAttemptState.ANSWERED);
    expect(provider.bridgeCalls).toHaveBeenCalledWith('caller_123', 'buyer_123');
    expect(callsService.transitionCall).toHaveBeenCalledWith('call_1', CallState.COMPLETED);
    expect(callsService.createCallAttempt).not.toHaveBeenCalled();
  });
});
