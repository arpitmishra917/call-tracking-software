import { Test, TestingModule } from '@nestjs/testing';
import { WalletService } from '../src/billing/wallet.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { ReservationStatus, CallState } from '@prisma/client';
import { BadRequestException, ConflictException } from '@nestjs/common';

describe('Phase 3C: Wallet Reservation Engine (Real DB)', () => {
  let walletService: WalletService;
  let prisma: PrismaService;

  beforeAll(async () => {
    // Failsafe: ENSURE we are hitting the test database
    if (!process.env.DATABASE_URL?.includes('calltracking_mvp_test')) {
      throw new Error('FAIL CLOSED: DATABASE_URL must point to calltracking_mvp_test to prevent destruction of dev data.');
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [WalletService, PrismaService],
    }).compile();

    walletService = module.get<WalletService>(WalletService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.$disconnect();
    }
  });

  const wsId = 'ws-test-phase3c';
  const callId = 'call-test-phase3c';

  beforeEach(async () => {
    // Clean up
    await prisma.workspace.deleteMany({ where: { id: { in: [wsId, 'ws-brand-new', 'ws-a', 'ws-b'] } } });

    // Seed Workspace
    await prisma.workspace.create({
      data: {
        id: wsId,
        name: 'Phase 3C Test WS',
        slug: 'phase-3c-test-ws',
      },
    });

    // Seed Call
    await prisma.call.create({
      data: {
        id: callId,
        workspace_id: wsId,
        from_number: '+1000',
        to_number: '+2000',
        state: CallState.INITIATED,
        provider: 'telnyx',
        provider_call_id: 'prov-test-' + Math.random(),
      },
    });

    // Seed initial balance: $10 (10,000,000 micro)
    await prisma.workspaceBalance.create({
      data: {
        workspace_id: wsId,
        balance_micro: 10000000n,
        reserved_micro: 0n,
      },
    });
  });

  it('TEST 1: Reserve with sufficient funds', async () => {
    const res = await walletService.reserveForCall(wsId, callId, 2000000n);
    expect(res.status).toBe(ReservationStatus.ACTIVE);

    const bal = await prisma.workspaceBalance.findUnique({ where: { workspace_id: wsId } });
    expect(bal?.balance_micro).toBe(10000000n);
    expect(bal?.reserved_micro).toBe(2000000n);
  });

  it('TEST 2: Reserve with zero balance', async () => {
    await prisma.workspaceBalance.update({
      where: { workspace_id: wsId },
      data: { balance_micro: 0n }
    });

    await expect(walletService.reserveForCall(wsId, callId, 10000n)).rejects.toThrow(BadRequestException);
    
    const bal = await prisma.workspaceBalance.findUnique({ where: { workspace_id: wsId } });
    expect(bal?.reserved_micro).toBe(0n); // No hold placed
  });

  it('TEST 3: Reserve exactly available balance', async () => {
    const res = await walletService.reserveForCall(wsId, callId, 10000000n);
    expect(res.status).toBe(ReservationStatus.ACTIVE);

    const bal = await prisma.workspaceBalance.findUnique({ where: { workspace_id: wsId } });
    expect(bal?.balance_micro).toBe(10000000n);
    expect(bal?.reserved_micro).toBe(10000000n);
  });

  it('TEST 4: Reserve greater than available', async () => {
    await expect(walletService.reserveForCall(wsId, callId, 20000000n)).rejects.toThrow(BadRequestException);
  });

  it('TEST 5: Release ACTIVE reservation', async () => {
    await walletService.reserveForCall(wsId, callId, 2000000n);
    await walletService.releaseReservation(wsId, callId);

    const bal = await prisma.workspaceBalance.findUnique({ where: { workspace_id: wsId } });
    expect(bal?.balance_micro).toBe(10000000n);
    expect(bal?.reserved_micro).toBe(0n); // Hold released

    const res = await prisma.callReservation.findUnique({ where: { call_id: callId } });
    expect(res?.status).toBe(ReservationStatus.RELEASED);
  });

  it('TEST 6: Release same reservation twice', async () => {
    await walletService.reserveForCall(wsId, callId, 2000000n);
    await walletService.releaseReservation(wsId, callId);
    
    // Idempotent release
    const result = await walletService.releaseReservation(wsId, callId);
    expect(result.status).toBe(ReservationStatus.RELEASED);

    const bal = await prisma.workspaceBalance.findUnique({ where: { workspace_id: wsId } });
    expect(bal?.reserved_micro).toBe(0n); // No double release!
  });

  it('TEST 7: Settle reservation with actual cost lower than hold', async () => {
    await walletService.reserveForCall(wsId, callId, 2000000n); // Hold $2
    await walletService.settleReservation(wsId, callId, 500000n); // Cost $0.50

    const bal = await prisma.workspaceBalance.findUnique({ where: { workspace_id: wsId } });
    expect(bal?.balance_micro).toBe(9500000n); // Deducted 0.50
    expect(bal?.reserved_micro).toBe(0n); // Hold fully released

    const res = await prisma.callReservation.findUnique({ where: { call_id: callId } });
    expect(res?.status).toBe(ReservationStatus.SETTLED);
  });

  it('TEST 8: Settle same reservation twice', async () => {
    await walletService.reserveForCall(wsId, callId, 2000000n);
    await walletService.settleReservation(wsId, callId, 500000n);
    
    const result = await walletService.settleReservation(wsId, callId, 500000n);
    expect(result.status).toBe(ReservationStatus.SETTLED);

    const bal = await prisma.workspaceBalance.findUnique({ where: { workspace_id: wsId } });
    expect(bal?.balance_micro).toBe(9500000n); // NOT deducted twice!
  });

  it('TEST 9: Settlement cost greater than reservation', async () => {
    await walletService.reserveForCall(wsId, callId, 2000000n);
    
    await expect(walletService.settleReservation(wsId, callId, 5000000n)).rejects.toThrow(BadRequestException);

    const bal = await prisma.workspaceBalance.findUnique({ where: { workspace_id: wsId } });
    expect(bal?.balance_micro).toBe(10000000n);
    expect(bal?.reserved_micro).toBe(2000000n); // Still held

    const res = await prisma.callReservation.findUnique({ where: { call_id: callId } });
    expect(res?.status).toBe(ReservationStatus.ACTIVE);
  });

  it('TEST 10: Two concurrent reservations competing for the same balance', async () => {
    await prisma.workspaceBalance.update({
      where: { workspace_id: wsId },
      data: { balance_micro: 1000000n } // $1
    });

    const callA = 'callA';
    const callB = 'callB';

    await prisma.call.createMany({
      data: [
        { id: callA, workspace_id: wsId, from_number: '+1', to_number: '+2', state: CallState.INITIATED, provider: 'telnyx', provider_call_id: 'provA' },
        { id: callB, workspace_id: wsId, from_number: '+1', to_number: '+3', state: CallState.INITIATED, provider: 'telnyx', provider_call_id: 'provB' },
      ]
    });

    const p1 = walletService.reserveForCall(wsId, callA, 600000n);
    const p2 = walletService.reserveForCall(wsId, callB, 600000n);

    const results = await Promise.allSettled([p1, p2]);

    const successes = results.filter(r => r.status === 'fulfilled');
    const rejections = results.filter(r => r.status === 'rejected');

    expect(successes.length).toBe(1); // Exactly one succeeds
    expect(rejections.length).toBe(1);

    const bal = await prisma.workspaceBalance.findUnique({ where: { workspace_id: wsId } });
    expect(bal?.reserved_micro).toBe(600000n);
  });

  it('TEST 11: Three concurrent reservations', async () => {
    await prisma.workspaceBalance.update({
      where: { workspace_id: wsId },
      data: { balance_micro: 1000000n } // $1
    });

    const callA = 'callA2';
    const callB = 'callB2';
    const callC = 'callC2';

    await prisma.call.createMany({
      data: [
        { id: callA, workspace_id: wsId, from_number: '+1', to_number: '+2', state: CallState.INITIATED, provider: 'telnyx', provider_call_id: 'provA2' },
        { id: callB, workspace_id: wsId, from_number: '+1', to_number: '+3', state: CallState.INITIATED, provider: 'telnyx', provider_call_id: 'provB2' },
        { id: callC, workspace_id: wsId, from_number: '+1', to_number: '+4', state: CallState.INITIATED, provider: 'telnyx', provider_call_id: 'provC2' },
      ]
    });

    const p1 = walletService.reserveForCall(wsId, callA, 600000n);
    const p2 = walletService.reserveForCall(wsId, callB, 600000n);
    const p3 = walletService.reserveForCall(wsId, callC, 600000n);

    const results = await Promise.allSettled([p1, p2, p3]);

    const successes = results.filter(r => r.status === 'fulfilled');
    const rejections = results.filter(r => r.status === 'rejected');

    expect(successes.length).toBe(1); // Exactly one succeeds
    expect(rejections.length).toBe(2);

    const bal = await prisma.workspaceBalance.findUnique({ where: { workspace_id: wsId } });
    expect(bal?.reserved_micro).toBe(600000n);
  });
  
  it('TEST 14: Same call repeated reservation with same amount', async () => {
    await walletService.reserveForCall(wsId, callId, 1000n);
    const res = await walletService.reserveForCall(wsId, callId, 1000n);
    
    expect(res.status).toBe(ReservationStatus.ACTIVE);
    const count = await prisma.callReservation.count({ where: { call_id: callId } });
    expect(count).toBe(1);
    
    const bal = await prisma.workspaceBalance.findUnique({ where: { workspace_id: wsId } });
    expect(bal?.reserved_micro).toBe(1000n); // Did not double!
  });

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
    
    let ledger = await prisma.walletTransaction.findMany({ where: { reference_id: callId } });
    expect(ledger.length).toBe(1);
    expect(ledger[0].amount_micro).toBe(500000n);

    // Repeat settlement
    const result = await walletService.settleReservation(wsId, callId, 500000n);
    expect(result.status).toBe(ReservationStatus.SETTLED);

    const bal = await prisma.workspaceBalance.findUnique({ where: { workspace_id: wsId } });
    expect(bal?.balance_micro).toBe(9500000n); // Deducted exactly once!

    ledger = await prisma.walletTransaction.findMany({ where: { reference_id: callId } });
    expect(ledger.length).toBe(1);
  });

  it('VERIFY RELEASE SEMANTICS', async () => {
    await walletService.reserveForCall(wsId, callId, 2000000n); // Hold 2,000,000
    
    let bal = await prisma.workspaceBalance.findUnique({ where: { workspace_id: wsId } });
    expect(bal?.balance_micro).toBe(10000000n);
    expect(bal?.reserved_micro).toBe(2000000n);

    await walletService.releaseReservation(wsId, callId);

    bal = await prisma.workspaceBalance.findUnique({ where: { workspace_id: wsId } });
    expect(bal?.balance_micro).toBe(10000000n); // MUST NOT INCREASE
    expect(bal?.reserved_micro).toBe(0n);

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
    
    await expect(walletService.settleReservation(wsId, call2, 700000n)).rejects.toThrow(BadRequestException);

    bal = await prisma.workspaceBalance.findUnique({ where: { workspace_id: wsId } });
    expect(bal?.balance_micro).toBe(1000000n);
    expect(bal?.reserved_micro).toBe(600000n);
  });

  it('FINANCIAL INVARIANT AUDIT', async () => {
    const bal = await prisma.workspaceBalance.findUnique({ where: { workspace_id: wsId } });
    expect(bal?.balance_micro).toBeGreaterThanOrEqual(0n);
    expect(bal?.reserved_micro).toBeGreaterThanOrEqual(0n);
    expect(bal?.reserved_micro).toBeLessThanOrEqual(bal?.balance_micro || 0n);
    
    const activeRes = await prisma.callReservation.findMany({ where: { workspace_id: wsId, status: 'ACTIVE' } });
    const sum = activeRes.reduce((acc: bigint, r: any) => acc + r.total_reserved_micro, 0n);
    expect(bal?.reserved_micro).toBe(sum);
  });
});
