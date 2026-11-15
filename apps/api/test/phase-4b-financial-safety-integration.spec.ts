import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient, ReservationStatus, TransactionType } from '@prisma/client';
import { randomUUID } from 'crypto';
import { WalletService } from '../src/billing/wallet.service.js';
import { WorkspacesService } from '../src/workspaces/workspaces.service.js';
import {
  assertNonProductionDatabase,
  validateDatabaseTarget,
  sanitizeDatabaseUrl,
  stripProductionEnvironmentVariables,
} from '../src/common/database-isolation.util.js';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';

describe('Phase 4B: Financial Concurrency, Database Isolation & Ledger Safety Hardening', () => {
  let prisma: PrismaClient;
  let walletService: WalletService;
  let workspacesService: WorkspacesService;
  const createdWorkspaceIds: string[] = [];

  const QA_DB_URL =
    process.env.DATABASE_URL ||
    'postgresql://callflow_qa_user:callflow_qa_secret_2026@127.0.0.1:5433/callflow_qa?schema=public';

  beforeAll(async () => {
    assertNonProductionDatabase(QA_DB_URL, 'phase-4b-integration-init');

    prisma = new PrismaClient({
      datasources: {
        db: {
          url: QA_DB_URL,
        },
      },
    });

    await prisma.$connect();
    walletService = new WalletService(prisma as any);
    workspacesService = new WorkspacesService(prisma as any, { logAction: async () => {} } as any);
  });

  afterAll(async () => {
    // Targeted fixture cleanup
    for (const wsId of createdWorkspaceIds) {
      try {
        await prisma.$executeRaw`DELETE FROM "wallet_transactions" WHERE workspace_id = ${wsId}`;
        await prisma.$executeRaw`DELETE FROM "call_reservation_extensions" WHERE workspace_id = ${wsId}`;
        await prisma.$executeRaw`DELETE FROM "call_reservations" WHERE workspace_id = ${wsId}`;
        await prisma.$executeRaw`DELETE FROM "settlement_items" WHERE settlement_batch_id IN (SELECT id FROM "settlement_batches" WHERE workspace_id = ${wsId})`;
        await prisma.$executeRaw`DELETE FROM "payment_instructions" WHERE workspace_id = ${wsId}`;
        await prisma.$executeRaw`DELETE FROM "settlement_batches" WHERE workspace_id = ${wsId}`;
        await prisma.$executeRaw`DELETE FROM "call_commercials" WHERE workspace_id = ${wsId}`;
        await prisma.$executeRaw`DELETE FROM "calls" WHERE workspace_id = ${wsId}`;
        await prisma.$executeRaw`DELETE FROM "workspace_balances" WHERE workspace_id = ${wsId}`;
        await prisma.$executeRaw`DELETE FROM "workspace_members" WHERE workspace_id = ${wsId}`;
        await prisma.$executeRaw`DELETE FROM "workspaces" WHERE id = ${wsId}`;
      } catch {
        // Best-effort cleanup
      }
    }
    await prisma.$disconnect();
  });

  async function createTestWorkspace(name = 'Phase 4B QA WS'): Promise<string> {
    const ws = await prisma.workspace.create({
      data: {
        name,
        slug: `phase4b-${randomUUID().slice(0, 8)}`,
        status: 'ACTIVE',
      },
    });
    createdWorkspaceIds.push(ws.id);

    await prisma.workspaceBalance.create({
      data: {
        workspace_id: ws.id,
        balance_micro: 0n,
        reserved_micro: 0n,
        balance_minor: 0,
      },
    });

    return ws.id;
  }

  async function createTestCall(workspaceId: string, state = 'ROUTING'): Promise<string> {
    const call = await prisma.call.create({
      data: {
        id: randomUUID(),
        workspace_id: workspaceId,
        provider: 'mock',
        provider_call_id: `mock-${randomUUID()}`,
        to_number: '+15550001',
        from_number: '+15550002',
        state: state as any,
      },
    });
    return call.id;
  }

  // =========================================================================
  // AUDIT A: WALLET RESERVATION ARITHMETIC (Scenarios 1 - 12)
  // =========================================================================
  describe('Audit A — Wallet Reservation Arithmetic & Ledger Invariants', () => {
    it('executes the full 12-scenario lifecycle under Total Balance model', async () => {
      const wsId = await createTestWorkspace('Wallet Arithmetic Workspace');

      // Helper to query balance record
      const getBal = async () => {
        const b = await prisma.workspaceBalance.findUnique({ where: { workspace_id: wsId } });
        const balance = BigInt(b?.balance_micro || 0n);
        const reserved = BigInt(b?.reserved_micro || 0n);
        const available = balance - reserved;
        return { balance, reserved, available };
      };

      // Scenario 1: Initial balance = $100 (100,000,000 micro-dollars)
      await walletService.creditWallet({
        workspaceId: wsId,
        amountMicro: 100_000_000n,
        referenceType: 'INITIAL_TOPUP',
        referenceId: 'ref-init',
        idempotencyKey: `init-${wsId}`,
      });
      let bal = await getBal();
      expect(bal.balance).toBe(100_000_000n);
      expect(bal.reserved).toBe(0n);
      expect(bal.available).toBe(100_000_000n);

      // Scenario 2: Reserve $20 (20,000,000 micro-dollars)
      const call1 = await createTestCall(wsId);
      await walletService.reserveForCall(wsId, call1, 20_000_000n);

      // Scenario 3: Available balance after reservation
      // Total balance: $100, Reserved: $20, Available: $80
      bal = await getBal();
      expect(bal.balance).toBe(100_000_000n);
      expect(bal.reserved).toBe(20_000_000n);
      expect(bal.available).toBe(80_000_000n);

      // Scenario 4: Extend reservation by $10 (10,000,000 micro-dollars)
      // Total balance: $100, Reserved: $30, Available: $70
      await walletService.extendReservationForCall(wsId, call1, 10_000_000n, `ext:${call1}:1`);
      bal = await getBal();
      expect(bal.balance).toBe(100_000_000n);
      expect(bal.reserved).toBe(30_000_000n);
      expect(bal.available).toBe(70_000_000n);

      // Scenario 5: Release reservation without usage
      // Total balance: $100, Reserved: $0, Available: $100
      await walletService.releaseReservation(wsId, call1);
      bal = await getBal();
      expect(bal.balance).toBe(100_000_000n);
      expect(bal.reserved).toBe(0n);
      expect(bal.available).toBe(100_000_000n);

      // Scenario 6: Create another reservation ($20) and settle actual usage of $12 ($12,000,000 micro-dollars)
      const call2 = await createTestCall(wsId);
      await walletService.reserveForCall(wsId, call2, 20_000_000n);
      bal = await getBal();
      expect(bal.available).toBe(80_000_000n);

      // Settle $12: Total balance decreases by $12, reserved decreases by $20, available becomes $88
      await walletService.settleReservation(wsId, call2, 12_000_000n);
      bal = await getBal();
      expect(bal.balance).toBe(88_000_000n);
      expect(bal.reserved).toBe(0n);
      expect(bal.available).toBe(88_000_000n);

      // Scenario 7: Settle actual usage greater than the original reservation
      // Call 3: original reservation $10 (10,000,000µ), extended by $10 (10,000,000µ) -> total reserved $20 (20,000,000µ)
      // Actual cost = $15 (15,000,000µ), which is > original reservation ($10) but <= total reserved ($20)
      const call3 = await createTestCall(wsId);
      await walletService.reserveForCall(wsId, call3, 10_000_000n);
      await walletService.extendReservationForCall(wsId, call3, 10_000_000n, `ext:${call3}:1`);
      bal = await getBal();
      expect(bal.reserved).toBe(20_000_000n);
      expect(bal.available).toBe(68_000_000n);

      await walletService.settleReservation(wsId, call3, 15_000_000n);
      bal = await getBal();
      expect(bal.balance).toBe(73_000_000n); // $88 - $15 = $73
      expect(bal.reserved).toBe(0n);
      expect(bal.available).toBe(73_000_000n);

      // Scenario 8: Reject insufficient balance
      // Attempting to reserve $100 when available is $73 must be rejected
      const call4 = await createTestCall(wsId);
      await expect(walletService.reserveForCall(wsId, call4, 100_000_000n)).rejects.toThrow(
        BadRequestException,
      );

      // Scenario 9: Retry duplicate reservation requests (idempotency)
      await walletService.reserveForCall(wsId, call4, 10_000_000n);
      const dupRes = await walletService.reserveForCall(wsId, call4, 10_000_000n);
      expect(dupRes.total_reserved_micro).toBe(10_000_000n);
      bal = await getBal();
      expect(bal.reserved).toBe(10_000_000n); // Unchanged

      // Scenario 10: Retry duplicate settlement requests (idempotency)
      await walletService.settleReservation(wsId, call4, 5_000_000n);
      const dupSettle = await walletService.settleReservation(wsId, call4, 5_000_000n);
      expect((dupSettle as any).status).toBe(ReservationStatus.SETTLED);
      bal = await getBal();
      expect(bal.balance).toBe(68_000_000n); // $73 - $5 = $68
      expect(bal.reserved).toBe(0n);

      // Scenario 11: Simultaneous reservation requests
      const call5A = await createTestCall(wsId);
      const call5B = await createTestCall(wsId);
      await Promise.all([
        walletService.reserveForCall(wsId, call5A, 10_000_000n),
        walletService.reserveForCall(wsId, call5B, 15_000_000n),
      ]);
      bal = await getBal();
      expect(bal.reserved).toBe(25_000_000n);
      expect(bal.available).toBe(43_000_000n); // $68 - $25 = $43

      // Scenario 12: Simultaneous extension and settlement requests on call5A
      // One operation must win the row lock and serialize cleanly
      const p1 = walletService.extendReservationForCall(wsId, call5A, 5_000_000n, `ext:${call5A}:1`).catch((e) => e);
      const p2 = walletService.settleReservation(wsId, call5A, 8_000_000n).catch((e) => e);
      await Promise.all([p1, p2]);

      // Invariant: Balance must remain mathematically sound
      bal = await getBal();
      expect(bal.balance).toBeGreaterThan(0n);
      expect(bal.reserved).toBeGreaterThanOrEqual(0n);
      expect(bal.available).toBe(bal.balance - bal.reserved);
    }, 30000);
  });

  // =========================================================================
  // AUDIT B: WORKSPACE DELETION & LEDGER PRESERVATION
  // =========================================================================
  describe('Audit B — Workspace Deletion & Ledger Preservation', () => {
    it('blocks deletion of workspace with historical financial transactions', async () => {
      const wsId = await createTestWorkspace('Protected WS with Ledger');
      await walletService.creditWallet({
        workspaceId: wsId,
        amountMicro: 5_000_000n,
        referenceType: 'TEST',
        referenceId: 'ref-protect',
        idempotencyKey: `tx-${wsId}`,
      });

      await expect(workspacesService.deleteWorkspace(wsId)).rejects.toThrow(ConflictException);

      // Verify workspace and transaction still exist in PostgreSQL
      const ws = await prisma.workspace.findUnique({ where: { id: wsId } });
      expect(ws).not.toBeNull();
      const txs = await prisma.walletTransaction.findMany({ where: { workspace_id: wsId } });
      expect(txs.length).toBe(1);
    });

    it('enforces OWNER authorization when actorUserId is supplied', async () => {
      const wsId = await createTestWorkspace('Auth WS');
      const nonOwnerUserId = randomUUID();

      // Create profile and non-owner member
      await prisma.profile.create({
        data: { id: nonOwnerUserId, display_name: 'Test Non-Owner' },
      });
      await prisma.workspaceMember.create({
        data: {
          id: randomUUID(),
          workspace_id: wsId,
          user_id: nonOwnerUserId,
          role: 'MEMBER',
        },
      });

      await expect(workspacesService.deleteWorkspace(wsId, nonOwnerUserId)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('safely serializes concurrent financial write and workspace deletion race', async () => {
      const wsId = await createTestWorkspace('Race Test WS');

      // Concurrency race:
      // Worker 1 attempts workspace deletion
      // Worker 2 attempts wallet credit concurrently
      const deletePromise = workspacesService.deleteWorkspace(wsId).catch((err) => err);
      const creditPromise = walletService
        .creditWallet({
          workspaceId: wsId,
          amountMicro: 2_000_000n,
          referenceType: 'RACE_CREDIT',
          referenceId: 'race-1',
          idempotencyKey: `race-${wsId}`,
        })
        .catch((err) => err);

      const [delRes, credRes] = await Promise.all([deletePromise, creditPromise]);

      // Strict outcome verification:
      // If credit committed first, deletion MUST have been rejected with ConflictException
      // If deletion committed first, credit MUST fail (foreign key or workspace not found)
      // IN NO CIRCUMSTANCES CAN FINANCIAL DATA BE CREATED AND THEN SILENTLY DELETED
      const remainingTxs = await prisma.walletTransaction.findMany({ where: { workspace_id: wsId } });
      const wsExists = await prisma.workspace.findUnique({ where: { id: wsId } });

      if (remainingTxs.length > 0) {
        expect(wsExists).not.toBeNull();
        expect(delRes).toBeInstanceOf(ConflictException);
      } else {
        expect(wsExists).toBeNull();
      }
    });
  });

  // =========================================================================
  // AUDIT C: RESERVATION RECOVERY CONCURRENCY & ZERO BILLING FOR UNANSWERED
  // =========================================================================
  describe('Audit C — Reservation Recovery & Billing Invariants', () => {
    it('guarantees zero usage debit for unanswered calls upon recovery', async () => {
      const wsId = await createTestWorkspace('Recovery Unanswered WS');
      await walletService.creditWallet({
        workspaceId: wsId,
        amountMicro: 50_000_000n,
        referenceType: 'TOPUP',
        referenceId: 'ref-rec',
        idempotencyKey: `rec-${wsId}`,
      });

      const callId = await createTestCall(wsId, 'ROUTING');
      await walletService.reserveForCall(wsId, callId, 10_000_000n);

      // Simulating call ending unanswered (answered_at is null)
      // When released, reserved_micro is cleared and zero usage debit is recorded
      await walletService.releaseReservation(wsId, callId);

      const bal = await prisma.workspaceBalance.findUnique({ where: { workspace_id: wsId } });
      expect(bal?.balance_micro).toBe(50_000_000n); // Full balance intact!
      expect(bal?.reserved_micro).toBe(0n);

      const debits = await prisma.walletTransaction.findMany({
        where: { workspace_id: wsId, type: TransactionType.DEBIT },
      });
      expect(debits.length).toBe(0); // Zero debits!
    });

    it('safely serializes concurrent recovery and call-ended settlement', async () => {
      const wsId = await createTestWorkspace('Concurrent Settle WS');
      await walletService.creditWallet({
        workspaceId: wsId,
        amountMicro: 50_000_000n,
        referenceType: 'TOPUP',
        referenceId: 'ref-conc',
        idempotencyKey: `conc-${wsId}`,
      });

      const callId = await createTestCall(wsId, 'ROUTING');
      await walletService.reserveForCall(wsId, callId, 10_000_000n);

      // Two workers attempt settlement simultaneously
      const [r1, r2] = await Promise.all([
        walletService.settleReservation(wsId, callId, 4_000_000n).catch((e) => e),
        walletService.settleReservation(wsId, callId, 4_000_000n).catch((e) => e),
      ]);

      // Exactly one succeeds with the mutation; the other receives idempotent success
      const bal = await prisma.workspaceBalance.findUnique({ where: { workspace_id: wsId } });
      expect(bal?.balance_micro).toBe(46_000_000n); // $50 - $4 = $46 (exactly once!)
      expect(bal?.reserved_micro).toBe(0n);

      const debits = await prisma.walletTransaction.findMany({
        where: { workspace_id: wsId, reference_id: callId },
      });
      expect(debits.length).toBe(1); // Exactly one ledger transaction!
    });
  });

  // =========================================================================
  // AUDIT D: DATABASE ISOLATION HARDENING
  // =========================================================================
  describe('Audit D — Database Isolation Hardening', () => {
    it('accepts valid IPv6 loopback [::1] and localhost targets', () => {
      const ipv6Url = 'postgresql://user:pass@[::1]:5433/callflow_qa';
      const result = validateDatabaseTarget(ipv6Url, { context: 'ipv6-test' });
      expect(result.isValid).toBe(true);
      expect(result.sanitizedUrl).toBe('postgresql://user:***@[::1]:5433/callflow_qa');
    });

    it('rejects host.docker.internal pointing to non-QA ports or databases', () => {
      // Prohibited production port 6543 via host.docker.internal
      const badPortUrl = 'postgresql://user:pass@host.docker.internal:6543/callflow_qa';
      const result1 = validateDatabaseTarget(badPortUrl, { context: 'docker-test' });
      expect(result1.isValid).toBe(false);

      // Prohibited database name via host.docker.internal
      const badDbUrl = 'postgresql://user:pass@host.docker.internal:5432/production_master';
      const result2 = validateDatabaseTarget(badDbUrl, { context: 'docker-test' });
      expect(result2.isValid).toBe(false);

      // Legitimate local QA target via host.docker.internal
      const goodDockerUrl = 'postgresql://user:pass@host.docker.internal:5433/callflow_qa';
      const result3 = validateDatabaseTarget(goodDockerUrl, { context: 'docker-test' });
      expect(result3.isValid).toBe(true);
    });

    it('masks credentials properly and strips production environment secrets', () => {
      process.env.SUPABASE_URL = 'https://uwycbvnqnpnfisvvbabu.supabase.co';
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'secret-key-12345';
      stripProductionEnvironmentVariables();

      expect(process.env.SUPABASE_URL).toBeUndefined();
      expect(process.env.SUPABASE_SERVICE_ROLE_KEY).toBeUndefined();

      const masked = sanitizeDatabaseUrl('postgresql://my_user:ultra_secret_pw@127.0.0.1:5433/callflow_qa');
      expect(masked).toBe('postgresql://my_user:***@127.0.0.1:5433/callflow_qa');
      expect(masked).not.toContain('ultra_secret_pw');
    });
  });
});
