const fs = require('fs');
let code = fs.readFileSync('apps/api/test/routing-engine.e2e-spec.ts', 'utf8');

const test = `
  it('R1-07: Campaign becomes INACTIVE mid-flight -> routing stops but call remains NO_ANSWER', async () => {
    const callId = 'call_test_r1_07';
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
    
    // Deactivate campaign
    await prisma.campaign.update({ where: { id: campaignId }, data: { status: 'INACTIVE' } });

    // Buyer A fails
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
    
    // Routing should stop, no new attempts
    expect(call?.attempts.length).toBe(1);
    
    // The state should be NO_ANSWER (since we attempted a buyer and they failed), not FAILED
    expect(call?.state).toBe(CallState.NO_ANSWER);

    // Restore
    await prisma.campaign.update({ where: { id: campaignId }, data: { status: 'ACTIVE' } });
  });
});
`;

code = code.replace("});\r\n", test);
code = code.replace("});\n", test);
fs.writeFileSync('apps/api/test/routing-engine.e2e-spec.ts', code);
