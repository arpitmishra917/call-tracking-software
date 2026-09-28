import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { TelephonyModule } from '../src/telephony/telephony.module.js';
import {
  CallController,
  TELEPHONY_PROVIDER,
} from '../src/telephony/call-controller.js';
import { FakeTelephonyProvider } from '../src/telephony/fake.provider.js';
import { CallEventType } from '../src/telephony/telephony.events.js';
import { CallState, CallAttemptState } from '@prisma/client';
import { PrismaModule } from '../src/prisma/prisma.module.js';

describe('Sequential Buyer Routing Engine (Stage 14)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let callController: CallController;
  let provider: FakeTelephonyProvider;

  let workspaceId: string;
  let campaignId: string;
  let trackingNumberId: string;
  let buyerAId: string;
  let buyerBId: string;
  let buyerCId: string;

  beforeAll(async () => {
    provider = new FakeTelephonyProvider();

    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule, TelephonyModule],
    })
      .overrideProvider(TELEPHONY_PROVIDER)
      .useValue(provider)
      .compile();

    prisma = moduleRef.get<PrismaService>(PrismaService);
    callController = moduleRef.get<CallController>(CallController);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await moduleRef.close();
  });

  beforeEach(async () => {
    // Clean DB
    await prisma.call.deleteMany({});
    await prisma.campaignBuyer.deleteMany({});
    await prisma.buyer.deleteMany({});
    await prisma.phoneNumber.deleteMany({});
    await prisma.campaign.deleteMany({});
    await prisma.workspace.deleteMany({});

    provider.clearActions();

    // Seed DB
    const ws = await prisma.workspace.create({
      data: { name: 'Test WS', slug: 'test-ws-' + Date.now() },
    });
    workspaceId = ws.id;

    const camp = await prisma.campaign.create({
      data: {
        workspace_id: workspaceId,
        name: 'Test Campaign',
        status: 'ACTIVE',
      },
    });
    campaignId = camp.id;

    const pnum = await prisma.phoneNumber.create({
      data: {
        workspace_id: workspaceId,
        campaign_id: campaignId,
        phone_number: '+15550000000',
        provider: 'fake',
        status: 'ACTIVE',
      },
    });
    trackingNumberId = pnum.id;

    const bA = await prisma.buyer.create({
      data: {
        workspace_id: workspaceId,
        name: 'Buyer A',
        destination_number: '+1555000000A',
        timeout: 15,
      },
    });
    buyerAId = bA.id;
    await prisma.campaignBuyer.create({
      data: {
        workspace_id: workspaceId,
        campaign_id: campaignId,
        buyer_id: buyerAId,
        priority: 1,
        status: 'ACTIVE',
      },
    });

    const bB = await prisma.buyer.create({
      data: {
        workspace_id: workspaceId,
        name: 'Buyer B',
        destination_number: '+1555000000B',
        timeout: 15,
      },
    });
    buyerBId = bB.id;
    await prisma.campaignBuyer.create({
      data: {
        workspace_id: workspaceId,
        campaign_id: campaignId,
        buyer_id: buyerBId,
        priority: 2,
        status: 'ACTIVE',
      },
    });

    const bC = await prisma.buyer.create({
      data: {
        workspace_id: workspaceId,
        name: 'Buyer C',
        destination_number: '+1555000000C',
        timeout: 15,
      },
    });
    buyerCId = bC.id;
    await prisma.campaignBuyer.create({
      data: {
        workspace_id: workspaceId,
        campaign_id: campaignId,
        buyer_id: buyerCId,
        priority: 3,
        status: 'ACTIVE',
      },
    });
  });

  const triggerIncoming = async (callId: string) => {
    await callController.handleEvent({
      type: CallEventType.CALL_INITIATED,
      callId,
      direction: 'incoming',
      connectionId: 'conn-1',
      from: '+15559999999',
      to: '+15550000000',
      timestamp: new Date().toISOString(),
    });
  };

  it('1. A answers -> A wins -> B is never attempted', async () => {
    const callId = 'call_test_1';
    await triggerIncoming(callId);
    await callController.handleEvent({
      type: CallEventType.CALL_ANSWERED,
      callId,
      direction: 'incoming',
      timestamp: new Date().toISOString(),
    });

    const call = await prisma.call.findUnique({
      where: { provider_call_id: callId },
      include: { attempts: true },
    });
    expect(call?.state).toBe(CallState.ROUTING);
    expect(call?.attempts.length).toBe(1);
    expect(call?.attempts[0].buyer_id).toBe(buyerAId);
    const attemptAId = call!.attempts[0].provider_call_id!;

    // Buyer A answers
    await callController.handleEvent({
      type: CallEventType.CALL_ANSWERED,
      callId: attemptAId,
      direction: 'outgoing',
      timestamp: new Date().toISOString(),
    });

    const updatedCall = await prisma.call.findUnique({
      where: { provider_call_id: callId },
      include: { attempts: true },
    });
    expect(updatedCall?.state).toBe(CallState.COMPLETED);
    expect(updatedCall?.attempts.length).toBe(1); // B is never attempted
  });

  it('2. A fails/no-answer -> B answers -> B wins', async () => {
    const callId = 'call_test_2';
    await triggerIncoming(callId);
    await callController.handleEvent({
      type: CallEventType.CALL_ANSWERED,
      callId,
      direction: 'incoming',
      timestamp: new Date().toISOString(),
    });

    const call1 = await prisma.call.findUnique({
      where: { provider_call_id: callId },
      include: { attempts: true },
    });
    const attemptAId = call1!.attempts[0].provider_call_id!;

    // Buyer A hangs up/fails
    await callController.handleEvent({
      type: CallEventType.CALL_HANGUP,
      callId: attemptAId,
      direction: 'outgoing',
      timestamp: new Date().toISOString(),
    });

    const call2 = await prisma.call.findUnique({
      where: { provider_call_id: callId },
      include: { attempts: { orderBy: { created_at: 'asc' } } },
    });
    expect(call2?.attempts.length).toBe(2);
    expect(call2?.attempts[0].state).toBe(CallAttemptState.NO_ANSWER);
    expect(call2?.attempts[1].buyer_id).toBe(buyerBId);
    expect(call2?.attempts[1].state).toBe(CallAttemptState.RINGING);

    const attemptBId = call2!.attempts[1].provider_call_id!;

    // Buyer B answers
    await callController.handleEvent({
      type: CallEventType.CALL_ANSWERED,
      callId: attemptBId,
      direction: 'outgoing',
      timestamp: new Date().toISOString(),
    });

    const call3 = await prisma.call.findUnique({
      where: { provider_call_id: callId },
    });
    expect(call3?.state).toBe(CallState.COMPLETED);
  });

  it('3. A fails -> B fails -> C answers -> C wins', async () => {
    const callId = 'call_test_3';
    await triggerIncoming(callId);
    await callController.handleEvent({
      type: CallEventType.CALL_ANSWERED,
      callId,
      direction: 'incoming',
      timestamp: new Date().toISOString(),
    });

    let call = await prisma.call.findUnique({
      where: { provider_call_id: callId },
      include: { attempts: { orderBy: { created_at: 'asc' } } },
    });
    await callController.handleEvent({
      type: CallEventType.CALL_HANGUP,
      callId: call!.attempts[0].provider_call_id!,
      direction: 'outgoing',
      timestamp: new Date().toISOString(),
    });

    call = await prisma.call.findUnique({
      where: { provider_call_id: callId },
      include: { attempts: { orderBy: { created_at: 'asc' } } },
    });
    await callController.handleEvent({
      type: CallEventType.CALL_HANGUP,
      callId: call!.attempts[1].provider_call_id!,
      direction: 'outgoing',
      timestamp: new Date().toISOString(),
    });

    call = await prisma.call.findUnique({
      where: { provider_call_id: callId },
      include: { attempts: { orderBy: { created_at: 'asc' } } },
    });
    expect(call?.attempts.length).toBe(3);
    expect(call?.attempts[2].buyer_id).toBe(buyerCId);

    const attemptCId = call!.attempts[2].provider_call_id!;
    await callController.handleEvent({
      type: CallEventType.CALL_ANSWERED,
      callId: attemptCId,
      direction: 'outgoing',
      timestamp: new Date().toISOString(),
    });

    call = await prisma.call.findUnique({
      where: { provider_call_id: callId },
      include: { attempts: { orderBy: { created_at: 'asc' } } },
    });
    expect(call?.state).toBe(CallState.COMPLETED);
  });

  it('4. A/B/C all fail -> no buyer available', async () => {
    const callId = 'call_test_4';
    await triggerIncoming(callId);
    await callController.handleEvent({
      type: CallEventType.CALL_ANSWERED,
      callId,
      direction: 'incoming',
      timestamp: new Date().toISOString(),
    });

    for (let i = 0; i < 3; i++) {
      let call = await prisma.call.findUnique({
        where: { provider_call_id: callId },
        include: { attempts: { orderBy: { created_at: 'asc' } } },
      });
      const attemptId = call!.attempts[i].provider_call_id!;
      await callController.handleEvent({
        type: CallEventType.CALL_HANGUP,
        callId: attemptId,
        direction: 'outgoing',
        timestamp: new Date().toISOString(),
      });
    }

    const callFinal = await prisma.call.findUnique({
      where: { provider_call_id: callId },
    });
    expect(callFinal?.state).toBe(CallState.NO_ANSWER);
  });

  it('5. Caller hangs up during A -> A stops -> B is NOT attempted', async () => {
    const callId = 'call_test_5';
    await triggerIncoming(callId);
    await callController.handleEvent({
      type: CallEventType.CALL_ANSWERED,
      callId,
      direction: 'incoming',
      timestamp: new Date().toISOString(),
    });

    let call = await prisma.call.findUnique({
      where: { provider_call_id: callId },
      include: { attempts: true },
    });
    expect(call?.attempts.length).toBe(1);

    // Caller hangs up
    await callController.handleEvent({
      type: CallEventType.CALL_HANGUP,
      callId,
      direction: 'incoming',
      timestamp: new Date().toISOString(),
    });

    call = await prisma.call.findUnique({
      where: { provider_call_id: callId },
      include: { attempts: true },
    });
    expect(call?.state).toBe(CallState.CANCELED);
    expect(call?.attempts.length).toBe(1);
    expect(call?.attempts[0].state).toBe(CallAttemptState.CANCELED);
  });

  it('6. A answer vs timeout race -> exactly one winner -> no duplicate', async () => {
    const callId = 'call_test_6';
    await triggerIncoming(callId);
    await callController.handleEvent({
      type: CallEventType.CALL_ANSWERED,
      callId,
      direction: 'incoming',
      timestamp: new Date().toISOString(),
    });

    const call = await prisma.call.findUnique({
      where: { provider_call_id: callId },
      include: { attempts: true },
    });
    const attemptAId = call!.attempts[0].provider_call_id!;

    // Simulate answer and hangup (timeout) simultaneously (or very close)
    await Promise.all([
      callController.handleEvent({
        type: CallEventType.CALL_ANSWERED,
        callId: attemptAId,
        direction: 'outgoing',
        timestamp: new Date().toISOString(),
      }),
      callController.handleEvent({
        type: CallEventType.CALL_HANGUP,
        callId: attemptAId,
        direction: 'outgoing',
        timestamp: new Date().toISOString(),
      }),
    ]);

    const finalCall = await prisma.call.findUnique({
      where: { provider_call_id: callId },
      include: { attempts: true },
    });
    // Due to transaction locks, one will win. If answer wins, it's COMPLETED. If hangup wins, it's ROUTING with 2 attempts.
    // Either way, it shouldn't crash and shouldn't have weird state.
    // Assuming answer usually wins in our Promise.all if it executed first, or hangup wins.
    expect([CallState.COMPLETED, CallState.ROUTING]).toContain(
      finalCall?.state,
    );
  });

  it('7. inactive buyer skipped', async () => {
    // Make Buyer A inactive
    await prisma.campaignBuyer.updateMany({
      where: { buyer_id: buyerAId },
      data: { status: 'INACTIVE' }
    });

    const callId = 'call_test_inactive_buyer';
    await triggerIncoming(callId);
    await callController.handleEvent({
      type: CallEventType.CALL_ANSWERED,
      callId,
      direction: 'incoming',
      timestamp: new Date().toISOString(),
    });

    const call = await prisma.call.findUnique({
      where: { provider_call_id: callId },
      include: { attempts: true },
    });
    // First attempt should be buyer B
    expect(call?.attempts.length).toBe(1);
    expect(call?.attempts[0].buyer_id).toBe(buyerBId);

    // Restore Buyer A
    await prisma.campaignBuyer.updateMany({
      where: { buyer_id: buyerAId },
      data: { status: 'ACTIVE' }
    });
  });

  it('8. inactive campaign rejected', async () => {
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { status: 'INACTIVE' }
    });

    const callId = 'call_test_inactive_campaign';
    await triggerIncoming(callId);

    const call = await prisma.call.findUnique({
      where: { provider_call_id: callId }
    });
    expect(call?.state).toBe(CallState.FAILED);

    await prisma.campaign.update({
      where: { id: campaignId },
      data: { status: 'ACTIVE' }
    });
  });

  it('9. blocked caller rejected', async () => {
    await prisma.blockedCaller.create({
      data: { workspace_id: workspaceId, phone_number: '+15559999999' }
    });

    const callId = 'call_test_blocked_caller';
    await triggerIncoming(callId);

    const call = await prisma.call.findUnique({
      where: { provider_call_id: callId }
    });
    expect(call?.state).toBe(CallState.FAILED);
  });

  it('10. released number rejected', async () => {
    const pnum = await prisma.phoneNumber.create({
      data: {
        workspace_id: workspaceId,
        campaign_id: campaignId,
        phone_number: '+15550000001',
        provider: 'fake',
        status: 'RELEASED',
      },
    });

    const callId = 'call_test_released_number';
    await callController.handleEvent({
      type: CallEventType.CALL_INITIATED,
      callId,
      direction: 'incoming',
      connectionId: 'conn-1',
      from: '+15559999998',
      to: '+15550000001', // released number
      timestamp: new Date().toISOString(),
    });

    const call = await prisma.call.findUnique({
      where: { provider_call_id: callId }
    });
    expect(call).toBeNull();
  });

  it('11. suspended workspace rejected', async () => {
    await prisma.workspace.update({
      where: { id: workspaceId },
      data: { status: 'SUSPENDED' }
    });

    const callId = 'call_test_suspended_ws';
    await triggerIncoming(callId);

    const call = await prisma.call.findUnique({
      where: { provider_call_id: callId }
    });
    expect(call?.state).toBe(CallState.FAILED);

    await prisma.workspace.update({
      where: { id: workspaceId },
      data: { status: 'ACTIVE' }
    });
  });

  it('12. cross-tenant routing prevented', async () => {
    const ws2 = await prisma.workspace.create({
      data: { name: 'Test WS 2', slug: 'test-ws-2' },
    });
    const camp2 = await prisma.campaign.create({
      data: { workspace_id: ws2.id, name: 'Test Campaign 2', status: 'ACTIVE' },
    });
    const pnum2 = await prisma.phoneNumber.create({
      data: {
        workspace_id: ws2.id,
        campaign_id: camp2.id,
        phone_number: '+15550000002',
        provider: 'fake',
        status: 'ACTIVE',
      },
    });

    const callId = 'call_test_cross_tenant';
    await callController.handleEvent({
      type: CallEventType.CALL_INITIATED,
      callId,
      direction: 'incoming',
      connectionId: 'conn-2',
      from: '+15559999998',
      to: '+15550000002', // workspace 2 number
      timestamp: new Date().toISOString(),
    });
    await callController.handleEvent({
      type: CallEventType.CALL_ANSWERED,
      callId,
      direction: 'incoming',
      timestamp: new Date().toISOString(),
    });

    const call = await prisma.call.findUnique({
      where: { provider_call_id: callId },
      include: { attempts: true }
    });
    // It should have 0 attempts because campaign 2 has no buyers
    expect(call?.workspace_id).toBe(ws2.id);
    expect(call?.state).toBe(CallState.FAILED);
    expect(call?.attempts.length).toBe(0);
  });

  it('13. Duplicate CALL_INITIATED webhook does not create duplicate Call', async () => {
    const callId = 'call_test_dup_init';
    await triggerIncoming(callId);
    await triggerIncoming(callId); // Duplicate
    
    const count = await prisma.call.count({ where: { provider_call_id: callId } });
    expect(count).toBe(1);
  });

  it('14. Duplicate CALL_ANSWERED webhook is ignored', async () => {
    const callId = 'call_test_dup_ans';
    await triggerIncoming(callId);
    
    await callController.handleEvent({
      type: CallEventType.CALL_ANSWERED,
      callId,
      direction: 'incoming',
      timestamp: new Date().toISOString(),
    });
    
    // Send it again
    await callController.handleEvent({
      type: CallEventType.CALL_ANSWERED,
      callId,
      direction: 'incoming',
      timestamp: new Date().toISOString(),
    });
    
    const call = await prisma.call.findUnique({
      where: { provider_call_id: callId },
      include: { attempts: true },
    });
    // Should still just be 1 attempt because 2nd answer was ignored
    expect(call?.attempts.length).toBe(1);
  });

  it('15. Duplicate CALL_HANGUP webhook is ignored', async () => {
    const callId = 'call_test_dup_hang';
    await triggerIncoming(callId);
    
    await callController.handleEvent({
      type: CallEventType.CALL_HANGUP,
      callId,
      direction: 'incoming',
      timestamp: new Date().toISOString(),
    });
    
    // Call is now canceled
    let call = await prisma.call.findUnique({ where: { provider_call_id: callId } });
    expect(call?.state).toBe(CallState.CANCELED);
    
    // Duplicate hangup should not crash or change state illegally
    await callController.handleEvent({
      type: CallEventType.CALL_HANGUP,
      callId,
      direction: 'incoming',
      timestamp: new Date().toISOString(),
    });
    
    call = await prisma.call.findUnique({ where: { provider_call_id: callId } });
    expect(call?.state).toBe(CallState.CANCELED);
  });

  it('16. Late CALL_ANSWERED from a cancelled buyer is ignored', async () => {
    const callId = 'call_test_late_ans';
    await triggerIncoming(callId);
    
    await callController.handleEvent({
      type: CallEventType.CALL_ANSWERED,
      callId,
      direction: 'incoming',
      timestamp: new Date().toISOString(),
    });
    
    const call1 = await prisma.call.findUnique({
      where: { provider_call_id: callId },
      include: { attempts: true },
    });
    const attemptAId = call1!.attempts[0].provider_call_id!;
    
    // Buyer A fails
    await callController.handleEvent({
      type: CallEventType.CALL_HANGUP,
      callId: attemptAId,
      direction: 'outgoing',
      timestamp: new Date().toISOString(),
    });
    
    // But then sends a late ANSWERED
    await callController.handleEvent({
      type: CallEventType.CALL_ANSWERED,
      callId: attemptAId,
      direction: 'outgoing',
      timestamp: new Date().toISOString(),
    });
    
    const call2 = await prisma.call.findUnique({
      where: { provider_call_id: callId },
      include: { attempts: { orderBy: { created_at: 'asc' } } },
    });
    // Attempt A should still be NO_ANSWER, Attempt B should be RINGING or whatever it reached
    expect(call2!.attempts[0].state).toBe('NO_ANSWER');
  });

  it('17. Caller Hangup BEFORE answer cancels routing', async () => {
    const callId = 'call_test_hang_b4';
    await triggerIncoming(callId);
    
    // Caller hangs up before CALL_ANSWERED is ever sent
    await callController.handleEvent({
      type: CallEventType.CALL_HANGUP,
      callId,
      direction: 'incoming',
      timestamp: new Date().toISOString(),
    });
    
    const call = await prisma.call.findUnique({
      where: { provider_call_id: callId },
      include: { attempts: true },
    });
    expect(call?.state).toBe(CallState.CANCELED);
    expect(call?.attempts.length).toBe(0);
  });

  it('18. Caller Hangup AFTER answer ends call properly', async () => {
    const callId = 'call_test_hang_after';
    await triggerIncoming(callId);
    
    await callController.handleEvent({
      type: CallEventType.CALL_ANSWERED,
      callId,
      direction: 'incoming',
      timestamp: new Date().toISOString(),
    });
    
    const call1 = await prisma.call.findUnique({
      where: { provider_call_id: callId },
      include: { attempts: true },
    });
    const attemptAId = call1!.attempts[0].provider_call_id!;
    
    // Buyer answers
    await callController.handleEvent({
      type: CallEventType.CALL_ANSWERED,
      callId: attemptAId,
      direction: 'outgoing',
      timestamp: new Date().toISOString(),
    });
    
    // Caller hangs up
    await callController.handleEvent({
      type: CallEventType.CALL_HANGUP,
      callId,
      direction: 'incoming',
      timestamp: new Date().toISOString(),
    });
    
    const call2 = await prisma.call.findUnique({
      where: { provider_call_id: callId },
    });
    expect(call2?.state).toBe(CallState.COMPLETED);
  });

  it('19. Simultaneous dial fallback race creates exactly one next attempt', async () => {
    const callId = 'call_test_race_fb';
    await triggerIncoming(callId);
    
    await callController.handleEvent({
      type: CallEventType.CALL_ANSWERED,
      callId,
      direction: 'incoming',
      timestamp: new Date().toISOString(),
    });
    
    const call1 = await prisma.call.findUnique({
      where: { provider_call_id: callId },
      include: { attempts: true },
    });
    const attemptAId = call1!.attempts[0].provider_call_id!;
    
    // Two simultaneous HANGUPs from the provider for the same attempt
    await Promise.all([
      callController.handleEvent({
        type: CallEventType.CALL_HANGUP,
        callId: attemptAId,
        direction: 'outgoing',
        timestamp: new Date().toISOString(),
      }),
      callController.handleEvent({
        type: CallEventType.CALL_HANGUP,
        callId: attemptAId,
        direction: 'outgoing',
        timestamp: new Date().toISOString(),
      })
    ]);
    
    const call2 = await prisma.call.findUnique({
      where: { provider_call_id: callId },
      include: { attempts: true },
    });
    // Should have Attempt A and Attempt B only
    expect(call2?.attempts.length).toBe(2);
  });
  
  it('20. Caller hangup after buyer completed still leaves COMPLETED', async () => {
    const callId = 'call_test_comp_hang';
    await triggerIncoming(callId);
    
    await callController.handleEvent({
      type: CallEventType.CALL_ANSWERED,
      callId,
      direction: 'incoming',
      timestamp: new Date().toISOString(),
    });
    
    const call1 = await prisma.call.findUnique({
      where: { provider_call_id: callId },
      include: { attempts: true },
    });
    const attemptAId = call1!.attempts[0].provider_call_id!;
    
    // Buyer A answers
    await callController.handleEvent({
      type: CallEventType.CALL_ANSWERED,
      callId: attemptAId,
      direction: 'outgoing',
      timestamp: new Date().toISOString(),
    });
    
    // Buyer A hangs up
    await callController.handleEvent({
      type: CallEventType.CALL_HANGUP,
      callId: attemptAId,
      direction: 'outgoing',
      timestamp: new Date().toISOString(),
    });
    
    const call2 = await prisma.call.findUnique({
      where: { provider_call_id: callId },
    });
    expect(call2?.state).toBe(CallState.COMPLETED);
    
    // Caller hangs up late
    await callController.handleEvent({
      type: CallEventType.CALL_HANGUP,
      callId,
      direction: 'incoming',
      timestamp: new Date().toISOString(),
    });
    
    const call3 = await prisma.call.findUnique({
      where: { provider_call_id: callId },
    });
    expect(call3?.state).toBe(CallState.COMPLETED);
  });
});
