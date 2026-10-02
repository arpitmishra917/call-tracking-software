const fs = require('fs');

let s = fs.readFileSync('apps/api/test/reservation.spec.ts', 'utf8');

const newTests = \`
  it('TEST 12: BRAND-NEW WALLET CONCURRENCY', async () => {
    const brandNewWs = 'ws-brand-new';
    await prisma.workspace.create({
      data: { id: brandNewWs, name: 'Brand New WS', slug: 'brand-new-ws' }
    });
    // NO workspace_balance row seeded!

    const callA = 'callA-new';
    const callB = 'callB-new';
    await prisma.call.createMany({
      data: [
        { id: callA, workspace_id: brandNewWs, from_number: '+1', to_number: '+2', state: CallState.INITIATED, provider: 'telnyx', provider_call_id: 'provA-new' },
        { id: callB, workspace_id: brandNewWs, from_number: '+1', to_number: '+3', state: CallState.INITIATED, provider: 'telnyx', provider_call_id: 'provB-new' },
      ]
    });

    // Both fail because balance is 0, but the UPSERT must not throw a duplicate key error!
    const p1 = walletService.reserveForCall(brandNewWs, callA, 500n);
    const p2 = walletService.reserveForCall(brandNewWs, callB, 500n);

    const results = await Promise.allSettled([p1, p2]);
    
    // They should BOTH reject because balance is 0, but specifically they must not crash the DB with race conditions on upsert
    expect(results[0].status).toBe('rejected');
    expect(results[1].status).toBe('rejected');

    // Due to transaction rollback, the upsert should ALSO roll back!
    const bal = await prisma.workspaceBalance.findUnique({ where: { workspace_id: brandNewWs } });
    expect(bal).toBeNull(); // Transaction rollback ensures no partial state
  });

  it('TEST 13: CROSS-WORKSPACE ISOLATION', async () => {
    const wsA = 'ws-a';
    const wsB = 'ws-b';
    await prisma.workspace.createMany({
      data: [
        { id: wsA, name: 'WS A', slug: 'ws-a' },
        { id: wsB, name: 'WS B', slug: 'ws-b' }
      ]
    });

    await prisma.workspaceBalance.create({ data: { workspace_id: wsA, balance_micro: 1000n, reserved_micro: 0n } });
    await prisma.workspaceBalance.create({ data: { workspace_id: wsB, balance_micro: 1000n, reserved_micro: 0n } });

    const callA = 'call-a';
    await prisma.call.create({
      data: { id: callA, workspace_id: wsA, from_number: '+1', to_number: '+2', state: CallState.INITIATED, provider: 'telnyx', provider_call_id: 'provA-cross' }
    });

    // Try to reserve using Workspace B for Workspace A's call
    await expect(walletService.reserveForCall(wsB, callA, 100n)).rejects.toThrow(BadRequestException);

    // Give it a reservation in A
    await walletService.reserveForCall(wsA, callA, 100n);

    // Try to release using B
    await expect(walletService.releaseReservation(wsB, callA)).rejects.toThrow(BadRequestException);

    // Try to settle using B
    await expect(walletService.settleReservation(wsB, callA, 50n)).rejects.toThrow(BadRequestException);

    // Verify invariants
    const balA = await prisma.workspaceBalance.findUnique({ where: { workspace_id: wsA } });
    const balB = await prisma.workspaceBalance.findUnique({ where: { workspace_id: wsB } });

    expect(balA?.balance_micro).toBe(1000n);
    expect(balA?.reserved_micro).toBe(100n);
    expect(balB?.balance_micro).toBe(1000n);
    expect(balB?.reserved_micro).toBe(0n);
  });

  it('TEST 16: TRANSACTION ROLLBACK', async () => {
    const callRollback = 'call-rollback';
    await prisma.call.create({
      data: { id: callRollback, workspace_id: wsId, from_number: '+1', to_number: '+2', state: CallState.INITIATED, provider: 'telnyx', provider_call_id: 'prov-rollback' }
    });

    // We have 10,000,000 micro in balance. We will ask for 20,000,000.
    // The service upserts (step 3), locks (step 4), then verifies (step 5) and throws.
    // Because it throws, step 3 (upsert) should roll back if we were modifying state.
    // Let's modify the balance first manually to test rollback:
    await prisma.workspaceBalance.update({ where: { workspace_id: wsId }, data: { reserved_micro: 100n } });

    await expect(walletService.reserveForCall(wsId, callRollback, 20000000n)).rejects.toThrow(BadRequestException);

    // No reservation should be created
    const res = await prisma.callReservation.findUnique({ where: { call_id: callRollback } });
    expect(res).toBeNull();

    // Reserved micro should remain 100n, not modified by any partial state
    const bal = await prisma.workspaceBalance.findUnique({ where: { workspace_id: wsId } });
    expect(bal?.reserved_micro).toBe(100n);
  });

  it('TEST 17: LEDGER IDEMPOTENCY', async () => {
    await walletService.reserveForCall(wsId, callId, 2000000n);
    await walletService.settleReservation(wsId, callId, 500000n);
    
    // First settlement creates 1 ledger entry
    let ledger = await prisma.walletTransaction.findMany({ where: { reference_id: callId } });
    expect(ledger.length).toBe(1);
    expect(ledger[0].amount_micro).toBe(500000n);

    // Repeat settlement
    const result = await walletService.settleReservation(wsId, callId, 500000n);
    expect(result.status).toBe(ReservationStatus.SETTLED);

    const bal = await prisma.workspaceBalance.findUnique({ where: { workspace_id: wsId } });
    expect(bal?.balance_micro).toBe(9500000n); // Deducted exactly once!

    // Verify exactly ONE ledger transaction exists
    ledger = await prisma.walletTransaction.findMany({ where: { reference_id: callId } });
    expect(ledger.length).toBe(1);
  });

  it('VERIFY RELEASE SEMANTICS', async () => {
    await walletService.reserveForCall(wsId, callId, 2000000n); // Hold 2,000,000
    
    // Current available = 8,000,000
    let bal = await prisma.workspaceBalance.findUnique({ where: { workspace_id: wsId } });
    expect(bal?.balance_micro).toBe(10000000n);
    expect(bal?.reserved_micro).toBe(2000000n);

    await walletService.releaseReservation(wsId, callId);

    // Post-release check:
    bal = await prisma.workspaceBalance.findUnique({ where: { workspace_id: wsId } });
    expect(bal?.balance_micro).toBe(10000000n); // MUST NOT INCREASE
    expect(bal?.reserved_micro).toBe(0n);

    // Verify NO CREDIT transaction created
    const ledger = await prisma.walletTransaction.findMany({ where: { reference_id: callId } });
    expect(ledger.length).toBe(0); // A hold release is just clearing reserved_micro
  });

  it('VERIFY SETTLEMENT SEMANTICS', async () => {
    // For: balance = 1,000,000, reservation = 600,000, actual cost = 400,000
    await prisma.workspaceBalance.update({
      where: { workspace_id: wsId },
      data: { balance_micro: 1000000n, reserved_micro: 0n }
    });

    await walletService.reserveForCall(wsId, callId, 600000n);
    await walletService.settleReservation(wsId, callId, 400000n);

    let bal = await prisma.workspaceBalance.findUnique({ where: { workspace_id: wsId } });
    expect(bal?.balance_micro).toBe(600000n);
    expect(bal?.reserved_micro).toBe(0n);

    let ledger = await prisma.walletTransaction.findMany({ where: { reference_id: callId } });
    expect(ledger.length).toBe(1);
    expect(ledger[0].amount_micro).toBe(400000n);

    // Second test: cost = 700,000 on a 600,000 reservation -> should reject!
    await prisma.workspaceBalance.update({
      where: { workspace_id: wsId },
      data: { balance_micro: 1000000n, reserved_micro: 0n }
    });
    
    const call2 = 'call-2';
    await prisma.call.create({
      data: { id: call2, workspace_id: wsId, from_number: '+1', to_number: '+2', state: CallState.INITIATED, provider: 'telnyx', provider_call_id: 'prov-2' }
    });

    await walletService.reserveForCall(wsId, call2, 600000n);
    
    // Settlement rejected because 700k > 600k reservation limit!
    await expect(walletService.settleReservation(wsId, call2, 700000n)).rejects.toThrow(BadRequestException);

    bal = await prisma.workspaceBalance.findUnique({ where: { workspace_id: wsId } });
    expect(bal?.balance_micro).toBe(1000000n);
    expect(bal?.reserved_micro).toBe(600000n);
  });
\`;

s = s.replace(/}\\);\\s*$/g, newTests + '\\n});\\n');
fs.writeFileSync('apps/api/test/reservation.spec.ts', s);
