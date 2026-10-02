const fs = require('fs');
let code = fs.readFileSync('apps/api/test/routing-engine.e2e-spec.ts', 'utf8');

// 1. Add Wallet Assertions to R1-05
code = code.replace(
  "expect(provider.getActions().map(a => a.action)).not.toContain('dial');\n\n    await prisma.campaign.update({ where: { id: campaignId }, data: { status: 'ACTIVE' } });",
  "expect(provider.getActions().map(a => a.action)).not.toContain('dial');\n\n    const balance = await prisma.workspaceBalance.findUnique({ where: { workspace_id: workspaceId } });\n    expect(balance?.balance_micro).toBe(50000000n);\n    expect(balance?.reserved_micro).toBe(0n);\n\n    await prisma.campaign.update({ where: { id: campaignId }, data: { status: 'ACTIVE' } });"
);

code = code.replace(
  "expect(provider.getActions().map(a => a.action)).not.toContain('dial');\r\n\r\n    await prisma.campaign.update({ where: { id: campaignId }, data: { status: 'ACTIVE' } });",
  "expect(provider.getActions().map(a => a.action)).not.toContain('dial');\r\n\r\n    const balance = await prisma.workspaceBalance.findUnique({ where: { workspace_id: workspaceId } });\r\n    expect(balance?.balance_micro).toBe(50000000n);\r\n    expect(balance?.reserved_micro).toBe(0n);\r\n\r\n    await prisma.campaign.update({ where: { id: campaignId }, data: { status: 'ACTIVE' } });"
);

// 2. Add Wallet Assertions to R1-06
code = code.replace(
  "expect(provider.getActions().map(a => a.action)).not.toContain('dial');\n\n    await prisma.phoneNumber.update({ where: { id: trackingNumberId }, data: { campaign_id: campaignId } });",
  "expect(provider.getActions().map(a => a.action)).not.toContain('dial');\n\n    const balance2 = await prisma.workspaceBalance.findUnique({ where: { workspace_id: workspaceId } });\n    expect(balance2?.balance_micro).toBe(50000000n);\n    expect(balance2?.reserved_micro).toBe(0n);\n\n    await prisma.phoneNumber.update({ where: { id: trackingNumberId }, data: { campaign_id: campaignId } });"
);

code = code.replace(
  "expect(provider.getActions().map(a => a.action)).not.toContain('dial');\r\n\r\n    await prisma.phoneNumber.update({ where: { id: trackingNumberId }, data: { campaign_id: campaignId } });",
  "expect(provider.getActions().map(a => a.action)).not.toContain('dial');\r\n\r\n    const balance2 = await prisma.workspaceBalance.findUnique({ where: { workspace_id: workspaceId } });\r\n    expect(balance2?.balance_micro).toBe(50000000n);\r\n    expect(balance2?.reserved_micro).toBe(0n);\r\n\r\n    await prisma.phoneNumber.update({ where: { id: trackingNumberId }, data: { campaign_id: campaignId } });"
);


// 3. Append R1-07 and R1-08
const newTests = `
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

  it('R1-08: Concurrent duplicate buyer hangup events -> exactly one transition, one B attempt', async () => {
    const callId = 'call_test_r1_08';
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
    const attemptAId = call!.attempts[0].provider_call_id!;
    
    // Concurrently fire TWO hangup events for attempt A
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

    call = await prisma.call.findUnique({
      where: { provider_call_id: callId },
      include: { attempts: { orderBy: { created_at: 'asc' } } },
    });

    expect(call?.attempts.length).toBe(2);
    expect(call?.attempts[0].buyer_id).toBe(buyerAId);
    expect(call?.attempts[0].state).toBe(CallAttemptState.NO_ANSWER);
    
    expect(call?.attempts[1].buyer_id).toBe(buyerBId);
    expect(call?.attempts[1].state).toBe(CallAttemptState.RINGING);

    const providerDials = provider.getActions().filter(a => a.action === 'dial');
    expect(providerDials.length).toBe(2);
    expect(providerDials[0].to).toContain('A');
    expect(providerDials[1].to).toContain('B');
  });
});
`;

code = code.replace(/}\);\s*$/, newTests);
fs.writeFileSync('apps/api/test/routing-engine.e2e-spec.ts', code);
