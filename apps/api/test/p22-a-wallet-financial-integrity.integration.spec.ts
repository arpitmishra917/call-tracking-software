import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient, ReservationStatus, TransactionType, CallState } from '@prisma/client';
import { randomUUID } from 'crypto';
import { WalletService } from '../src/billing/wallet.service.js';
import { assertNonProductionDatabase } from '../src/common/database-isolation.util.js';
import { BadRequestException, ConflictException } from '@nestjs/common';

describe('P2.2-A: Wallet & Financial Transaction Integrity Integration Suite (Real PostgreSQL)', () => {
  const qaDbUrl =
    process.env.DATABASE_URL ||
    'postgresql://postgres:%2A222%2A2%23Arpit@localhost:5432/calltracking_mvp_test?schema=public';

  let prisma: PrismaClient;
  let walletService: WalletService;

  const createdWorkspaceIds: string[] = [];

  beforeAll(async () => {
    assertNonProductionDatabase(qaDbUrl, 'P2.2-A Wallet Integrity Suite');
    prisma = new PrismaClient({
      datasources: {
        db: {
          url: qaDbUrl,
        },
      },
    });
    await prisma.$connect();
    walletService = new WalletService(prisma as any);
  });

  afterAll(async () => {
    try {
      for (const wsId of createdWorkspaceIds) {
        await prisma.$executeRaw`DELETE FROM "wallet_transactions" WHERE workspace_id = ${wsId}`.catch(() => {});
        await prisma.$executeRaw`DELETE FROM "call_reservation_extensions" WHERE workspace_id = ${wsId}`.catch(() => {});
        await prisma.$executeRaw`DELETE FROM "call_reservations" WHERE workspace_id = ${wsId}`.catch(() => {});
        await prisma.$executeRaw`DELETE FROM "calls" WHERE workspace_id = ${wsId}`.catch(() => {});
        await prisma.$executeRaw`DELETE FROM "workspace_balances" WHERE workspace_id = ${wsId}`.catch(() => {});
        await prisma.$executeRaw`DELETE FROM "workspaces" WHERE id = ${wsId}`.catch(() => {});
      }
    } finally {
      await prisma.$disconnect();
    }
  });

  async function createTestWorkspace(initialBalanceMicro = 100_000_000n): Promise<string> {
    const rawId = randomUUID();
    const wsId = `ws_p22a_${rawId}`;
    createdWorkspaceIds.push(wsId);

    await prisma.workspace.create({
      data: {
        id: wsId,
        name: `Wallet Integrity Test WS ${rawId.slice(0, 8)}`,
        slug: `wallet-integrity-${rawId}`,
        status: 'ACTIVE',
      },
    });

    await prisma.workspaceBalance.create({
      data: {
        workspace_id: wsId,
        balance_micro: initialBalanceMicro,
        balance_minor: Number(initialBalanceMicro / 10000n),
        reserved_micro: 0n,
      },
    });

    return wsId;
  }

  async function createTestCall(workspaceId: string): Promise<string> {
    const callId = `call_p22a_${randomUUID()}`;
    await prisma.call.create({
      data: {
        id: callId,
        workspace_id: workspaceId,
        provider: 'telnyx',
        provider_call_id: `prov_${callId}`,
        from_number: '+15551112222',
        to_number: '+15553334444',
        state: CallState.INITIATED,
      },
    });
    return callId;
  }

  // 1. Concurrent Reservations & Insufficient Balance Race
  it('1. Concurrent reservations competing for scarce funds: exactly one succeeds, balance never goes negative', async () => {
    // Initial balance: $10 (10,000,000 micro)
    const wsId = await createTestWorkspace(10_000_000n);
    const call1 = await createTestCall(wsId);
    const call2 = await createTestCall(wsId);

    // Both calls simultaneously request an $8 (8,000,000 micro) reservation.
    // Total required = $16, but only $10 is available.
    const results = await Promise.allSettled([
      walletService.reserveForCall(wsId, call1, 8_000_000n),
      walletService.reserveForCall(wsId, call2, 8_000_000n),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    // Exactly one reservation must succeed, and exactly one must fail with BadRequestException (Insufficient funds)
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    const error = (rejected[0] as PromiseRejectedResult).reason;
    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.message).toContain('Insufficient available funds');

    // Verify balance in real PostgreSQL
    const bal = await prisma.workspaceBalance.findUniqueOrThrow({
      where: { workspace_id: wsId },
    });
    expect(bal.balance_micro).toBe(10_000_000n);
    expect(bal.reserved_micro).toBe(8_000_000n);
    // Available = 10m - 8m = 2m
    expect(bal.balance_micro - bal.reserved_micro).toBe(2_000_000n);
  });

  // 2. Insufficient Balance Multi-Worker Race
  it('2. Multi-worker reservation race: 5 concurrent workers requesting $5 hold against $10 balance -> exactly 2 succeed', async () => {
    // Initial balance: $10 (10,000,000 micro)
    const wsId = await createTestWorkspace(10_000_000n);
    const calls = await Promise.all([
      createTestCall(wsId),
      createTestCall(wsId),
      createTestCall(wsId),
      createTestCall(wsId),
      createTestCall(wsId),
    ]);

    // 5 concurrent requests of 5,000,000 micro each
    const results = await Promise.allSettled(
      calls.map((callId) => walletService.reserveForCall(wsId, callId, 5_000_000n)),
    );

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled.length).toBe(2);
    expect(rejected.length).toBe(3);

    // Verify database invariants
    const bal = await prisma.workspaceBalance.findUniqueOrThrow({
      where: { workspace_id: wsId },
    });
    expect(bal.balance_micro).toBe(10_000_000n);
    expect(bal.reserved_micro).toBe(10_000_000n);
    expect(bal.balance_micro - bal.reserved_micro).toBe(0n);

    // Verify exactly 2 ACTIVE reservations created
    const activeRes = await prisma.callReservation.findMany({
      where: { workspace_id: wsId, status: ReservationStatus.ACTIVE },
    });
    expect(activeRes.length).toBe(2);
  });

  // 3. Reservation Extension Concurrency & Idempotency
  it('3. Reservation extension under concurrency: atomic updates and idempotent key deduplication', async () => {
    // Initial balance: $20 (20,000,000 micro)
    const wsId = await createTestWorkspace(20_000_000n);
    const callId = await createTestCall(wsId);

    // Initial reservation of $5
    await walletService.reserveForCall(wsId, callId, 5_000_000n);

    const extKey1 = `ext:${callId}:1`;

    // Two simultaneous workers attempt extension #1 with identical idempotency key
    const [ext1A, ext1B] = await Promise.all([
      walletService.extendReservationForCall(wsId, callId, 2_000_000n, extKey1),
      walletService.extendReservationForCall(wsId, callId, 2_000_000n, extKey1),
    ]);

    // Both workers receive successful extension response without duplicate debit
    expect(ext1A.totalReservedMicro).toBe(7_000_000n);
    expect(ext1B.totalReservedMicro).toBe(7_000_000n);

    // Exactly one CallReservationExtension record in real PostgreSQL
    const extRecords = await prisma.callReservationExtension.findMany({
      where: { call_id: callId },
    });
    expect(extRecords.length).toBe(1);
    expect(extRecords[0].amount_micro).toBe(2_000_000n);

    // Workspace reserved balance is exactly 7,000,000 micro
    const bal = await prisma.workspaceBalance.findUniqueOrThrow({
      where: { workspace_id: wsId },
    });
    expect(bal.reserved_micro).toBe(7_000_000n);
  });

  // 4. Duplicate Settlement Race
  it('4. Duplicate settlement race: concurrent settleReservation calls result in exactly one settlement and debit', async () => {
    // Initial balance: $20 (20,000,000 micro)
    const wsId = await createTestWorkspace(20_000_000n);
    const callId = await createTestCall(wsId);

    // Reserve $5
    await walletService.reserveForCall(wsId, callId, 5_000_000n);

    // Actual talk cost = $3 (3,000,000 micro)
    // 2 simultaneous workers attempt to settle the call
    const [settleA, settleB] = await Promise.all([
      walletService.settleReservation(wsId, callId, 3_000_000n),
      walletService.settleReservation(wsId, callId, 3_000_000n),
    ]);

    // One settles and the second receives idempotent 'Already settled'
    const settledCount =
      (settleA.status === ReservationStatus.SETTLED ? 1 : 0) +
      (settleB.status === ReservationStatus.SETTLED ? 1 : 0);
    expect(settledCount).toBe(2);

    // Verify exactly ONE ledger transaction was created in real PostgreSQL
    const txs = await prisma.walletTransaction.findMany({
      where: { workspace_id: wsId, type: TransactionType.DEBIT },
    });
    expect(txs.length).toBe(1);
    expect(txs[0].amount_micro).toBe(3_000_000n);

    // Balance updated: $20 - $3 = $17 (17,000,000 micro), reserved = 0
    const bal = await prisma.workspaceBalance.findUniqueOrThrow({
      where: { workspace_id: wsId },
    });
    expect(bal.balance_micro).toBe(17_000_000n);
    expect(bal.reserved_micro).toBe(0n);
  });

  // 5. Atomic Rollback Consistency
  it('5. Atomic transaction rollback: aborted multi-step operations leave zero orphan mutations', async () => {
    const wsId = await createTestWorkspace(10_000_000n);
    const initialBal = await prisma.workspaceBalance.findUniqueOrThrow({
      where: { workspace_id: wsId },
    });

    const failingTx = async () => {
      await prisma.$transaction(async (tx) => {
        // Step 1: Debit balance
        await tx.workspaceBalance.update({
          where: { workspace_id: wsId },
          data: { balance_micro: 5_000_000n },
        });

        // Step 2: Create transaction
        await tx.walletTransaction.create({
          data: {
            workspace_id: wsId,
            amount_micro: 5_000_000n,
            amount_minor: 500,
            type: TransactionType.DEBIT,
            balance_after: 500,
            balance_after_micro: 5_000_000n,
            reference_type: 'TEST_FAIL',
            reference_id: 'ref-fail',
            idempotency_key: `rollback_test_${randomUUID()}`,
          },
        });

        // Step 3: Trigger error to abort transaction
        throw new Error('SIMULATED_DATABASE_FAILURE');
      });
    };

    await expect(failingTx()).rejects.toThrow('SIMULATED_DATABASE_FAILURE');

    // Confirm database state is 100% untouched
    const afterBal = await prisma.workspaceBalance.findUniqueOrThrow({
      where: { workspace_id: wsId },
    });
    expect(afterBal.balance_micro).toBe(initialBal.balance_micro);

    const txRecords = await prisma.walletTransaction.findMany({
      where: { workspace_id: wsId, reference_type: 'TEST_FAIL' },
    });
    expect(txRecords.length).toBe(0);
  });

  // 6. Idempotency Key Guarantees
  it('6. Idempotency key deduplication: repeated and concurrent duplicate credit returns existing record without double credit', async () => {
    const wsId = await createTestWorkspace(10_000_000n);
    const idempotencyKey = `credit_${randomUUID()}`;

    // Execute first credit
    const cred1 = await walletService.creditWallet({
      workspaceId: wsId,
      amountMicro: 5_000_000n,
      referenceType: 'TOPUP',
      referenceId: 'ref_topup_1',
      idempotencyKey,
    });

    // Execute sequential duplicate credit with identical key -> returns existing record
    const cred2 = await walletService.creditWallet({
      workspaceId: wsId,
      amountMicro: 5_000_000n,
      referenceType: 'TOPUP',
      referenceId: 'ref_topup_1',
      idempotencyKey,
    });

    expect(cred1.id).toBe(cred2.id);

    // Verify concurrent race on new key: PostgreSQL unique constraint prevents double credit
    const raceKey = `credit_race_${randomUUID()}`;
    const raceResults = await Promise.allSettled([
      walletService.creditWallet({
        workspaceId: wsId,
        amountMicro: 3_000_000n,
        referenceType: 'TOPUP',
        referenceId: 'ref_topup_2',
        idempotencyKey: raceKey,
      }),
      walletService.creditWallet({
        workspaceId: wsId,
        amountMicro: 3_000_000n,
        referenceType: 'TOPUP',
        referenceId: 'ref_topup_2',
        idempotencyKey: raceKey,
      }),
    ]);

    const successfulRaceCredits = raceResults.filter((r) => r.status === 'fulfilled');
    expect(successfulRaceCredits.length).toBeGreaterThanOrEqual(1);

    // Verify balance: Initial ($10) + first credit ($5) + exactly ONE race credit ($3) = $18 (18,000,000 micro)
    const bal = await prisma.workspaceBalance.findUniqueOrThrow({
      where: { workspace_id: wsId },
    });
    expect(bal.balance_micro).toBe(18_000_000n);

    // Mismatched parameters on reuse throws ConflictException
    await expect(
      walletService.creditWallet({
        workspaceId: wsId,
        amountMicro: 9_999_999n, // Mismatched amount
        referenceType: 'TOPUP',
        referenceId: 'ref_topup_1',
        idempotencyKey,
      }),
    ).rejects.toThrow(ConflictException);
  });
});
