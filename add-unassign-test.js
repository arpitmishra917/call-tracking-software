const fs = require('fs');
let code = fs.readFileSync('apps/api/test/routing-engine.e2e-spec.ts', 'utf8');

const newTest = `
  it('R2: Unassign phone number regression test', async () => {
    // 1. Assign number to campaign
    await prisma.phoneNumber.update({
      where: { id: trackingNumberId },
      data: { campaign_id: campaignId }
    });

    // 2. Unassign the number via the API/service logic (simulated or direct)
    // Actually we can just update it using Prisma as the backend service does
    await prisma.phoneNumber.update({
      where: { id: trackingNumberId },
      data: { campaign_id: null }
    });

    // 3. Incoming call occurs
    const callId = 'call_test_r2_unassign';
    await triggerIncoming(callId);

    const call = await prisma.call.findUnique({
      where: { provider_call_id: callId },
      include: { attempts: true },
    });

    // 4. No buyer is dialed
    expect(call?.state).toBe(CallState.FAILED);
    expect(call?.attempts.length).toBe(0);
    expect(provider.getActions().map(a => a.action)).not.toContain('dial');

    // 5. Number remains provisioned
    const numberCheck = await prisma.phoneNumber.findUnique({
      where: { id: trackingNumberId }
    });
    expect(numberCheck).toBeDefined();
    expect(numberCheck?.status).toBe('ACTIVE');
    
    // 6. Restore assignment
    await prisma.phoneNumber.update({
      where: { id: trackingNumberId },
      data: { campaign_id: campaignId }
    });
  });
});`;

code = code.replace(/}\);\s*$/, newTest);
fs.writeFileSync('apps/api/test/routing-engine.e2e-spec.ts', code);
