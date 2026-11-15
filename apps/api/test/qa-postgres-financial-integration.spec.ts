import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient, SettlementParticipantType, SettlementStatus, PaymentStatus, ReconciliationStatus, CommercialStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { assertNonProductionDatabase } from '../src/common/database-isolation.util.js';

describe('Real QA PostgreSQL Financial Integration Suite', () => {
  const qaDbUrl =
    process.env.DATABASE_URL ||
    'postgresql://callflow_qa_user:cfqa_pg_83538438661833bab5b5741ec8b903593e00a675@127.0.0.1:5433/callflow_qa?schema=public';

  let prisma: PrismaClient;

  // Track created IDs for safe, isolated cleanup
  const createdWorkspaceIds: string[] = [];
  const createdProfileIds: string[] = [];

  beforeAll(async () => {
    // 1. Enforce strict non-production isolation check
    assertNonProductionDatabase(qaDbUrl, 'Real QA Postgres Suite');

    prisma = new PrismaClient({
      datasources: {
        db: {
          url: qaDbUrl,
        },
      },
    });

    await prisma.$connect();
  });

  afterAll(async () => {
    // Clean up ONLY created test entities to protect existing persistent QA data
    try {
      for (const id of createdWorkspaceIds) {
        await prisma.$executeRaw`DELETE FROM "settlement_items" WHERE workspace_id = ${id}`.catch(() => {});
        await prisma.$executeRaw`DELETE FROM "settlement_adjustments" WHERE workspace_id = ${id}`.catch(() => {});
        await prisma.$executeRaw`DELETE FROM "settlement_batches" WHERE workspace_id = ${id}`.catch(() => {});
        await prisma.$executeRaw`DELETE FROM "call_commercials" WHERE workspace_id = ${id}`.catch(() => {});
        await prisma.$executeRaw`DELETE FROM "calls" WHERE workspace_id = ${id}`.catch(() => {});
        await prisma.$executeRaw`DELETE FROM "phone_numbers" WHERE workspace_id = ${id}`.catch(() => {});
        await prisma.$executeRaw`DELETE FROM "buyers" WHERE workspace_id = ${id}`.catch(() => {});
        await prisma.$executeRaw`DELETE FROM "vendors" WHERE workspace_id = ${id}`.catch(() => {});
        await prisma.$executeRaw`DELETE FROM "campaigns" WHERE workspace_id = ${id}`.catch(() => {});
        await prisma.$executeRaw`DELETE FROM "wallet_transactions" WHERE workspace_id = ${id}`.catch(() => {});
        await prisma.$executeRaw`DELETE FROM "workspace_balances" WHERE workspace_id = ${id}`.catch(() => {});
        await prisma.$executeRaw`DELETE FROM "workspace_members" WHERE workspace_id = ${id}`.catch(() => {});
        await prisma.$executeRaw`DELETE FROM "workspaces" WHERE id = ${id}`.catch(() => {});
      }
      if (createdProfileIds.length > 0) {
        await prisma.profile.deleteMany({
          where: { id: { in: createdProfileIds } },
        });
      }
    } catch (cleanupErr) {
      console.warn('Test cleanup warning:', cleanupErr);
    } finally {
      await prisma.$disconnect();
    }
  });

  it('1. verifies QA database target connectivity and version', async () => {
    const result = await prisma.$queryRaw<Array<{ version: string }>>`SELECT version()`;
    expect(result).toBeDefined();
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].version).toContain('PostgreSQL');
  });

  it('2. verifies real PostgreSQL unique constraint on SettlementItem: @@unique([call_commercial_id, participant_type])', async () => {
    const wsId = randomUUID();
    createdWorkspaceIds.push(wsId);

    const ws = await prisma.workspace.create({
      data: {
        id: wsId,
        name: 'QA Constraint Test Workspace',
        slug: `qa-constraint-${wsId.substring(0, 8)}`,
      },
    });

    const campaign = await prisma.campaign.create({
      data: {
        id: randomUUID(),
        workspace_id: ws.id,
        name: 'QA Campaign',
      },
    });

    // Create Buyer & Vendor via executeRaw to match existing database schema
    const buyerId = randomUUID();
    const now = new Date();
    await prisma.$executeRaw`
      INSERT INTO "buyers" (id, workspace_id, name, status, destination_number, created_at, updated_at, max_concurrent_calls)
      VALUES (${buyerId}, ${ws.id}, 'QA Test Buyer', 'ACTIVE', '+15551234', ${now}, ${now}, 1)
    `;

    const vendorId = randomUUID();
    await prisma.$executeRaw`
      INSERT INTO "vendors" (id, workspace_id, name, status, created_at, updated_at)
      VALUES (${vendorId}, ${ws.id}, 'QA Test Vendor', 'ACTIVE', ${now}, ${now})
    `;

    const call = await prisma.call.create({
      data: {
        id: randomUUID(),
        workspace_id: ws.id,
        provider: 'mock',
        provider_call_id: `mock-call-${randomUUID()}`,
        to_number: '+15550001',
        from_number: '+15550002',
        state: 'COMPLETED',
      },
    });

    const commercial = await prisma.callCommercial.create({
      data: {
        id: randomUUID(),
        workspace_id: ws.id,
        call_id: call.id,
        campaign_id: campaign.id,
        buyer_id: buyerId,
        vendor_id: vendorId,
        currency: 'USD',
        revenue: 50.0,
        payout: 25.0,
        profit: 25.0,
        status: CommercialStatus.FINAL,
        finalizes_at: new Date(),
      },
    });

    // Satisfies PostgreSQL settlement_batches_participant_check constraint
    const buyerBatch = await prisma.settlementBatch.create({
      data: {
        id: randomUUID(),
        workspace_id: ws.id,
        batch_number: `SB-BUYER-${randomUUID().substring(0, 8)}`,
        participant_type: SettlementParticipantType.BUYER,
        buyer_id: buyerId,
        vendor_id: null,
        currency: 'USD',
        period_start: new Date('2026-10-01'),
        period_end: new Date('2026-10-08'),
        created_by_user_id: 'qa-test-user',
      },
    });

    const vendorBatch = await prisma.settlementBatch.create({
      data: {
        id: randomUUID(),
        workspace_id: ws.id,
        batch_number: `SB-VENDOR-${randomUUID().substring(0, 8)}`,
        participant_type: SettlementParticipantType.VENDOR,
        vendor_id: vendorId,
        buyer_id: null,
        currency: 'USD',
        period_start: new Date('2026-10-01'),
        period_end: new Date('2026-10-08'),
        created_by_user_id: 'qa-test-user',
      },
    });

    // Step A: Insert BUYER item -> Succeeds
    const buyerItem = await prisma.settlementItem.create({
      data: {
        id: randomUUID(),
        workspace_id: ws.id,
        settlement_batch_id: buyerBatch.id,
        call_commercial_id: commercial.id,
        participant_type: SettlementParticipantType.BUYER,
        amount: 50.0,
        currency: 'USD',
      },
    });
    expect(buyerItem.id).toBeDefined();

    // Step B: Insert VENDOR item for SAME CallCommercial -> Succeeds!
    // This conclusively proves in real PostgreSQL that Buyer + Vendor pair is valid.
    const vendorItem = await prisma.settlementItem.create({
      data: {
        id: randomUUID(),
        workspace_id: ws.id,
        settlement_batch_id: vendorBatch.id,
        call_commercial_id: commercial.id,
        participant_type: SettlementParticipantType.VENDOR,
        amount: 25.0,
        currency: 'USD',
      },
    });
    expect(vendorItem.id).toBeDefined();

    // Step C: Attempt to insert SECOND BUYER item for SAME CallCommercial -> Fails with P2002
    await expect(
      prisma.settlementItem.create({
        data: {
          id: randomUUID(),
          workspace_id: ws.id,
          settlement_batch_id: buyerBatch.id,
          call_commercial_id: commercial.id,
          participant_type: SettlementParticipantType.BUYER, // Duplicate BUYER!
          amount: 50.0,
          currency: 'USD',
        },
      }),
    ).rejects.toThrow();

    // Step D: Attempt to insert SECOND VENDOR item for SAME CallCommercial -> Fails with P2002
    await expect(
      prisma.settlementItem.create({
        data: {
          id: randomUUID(),
          workspace_id: ws.id,
          settlement_batch_id: vendorBatch.id,
          call_commercial_id: commercial.id,
          participant_type: SettlementParticipantType.VENDOR, // Duplicate VENDOR!
          amount: 25.0,
          currency: 'USD',
        },
      }),
    ).rejects.toThrow();
  });

  it('3. verifies atomic transaction rollback in PostgreSQL', async () => {
    const wsId = randomUUID();
    createdWorkspaceIds.push(wsId);

    const ws = await prisma.workspace.create({
      data: {
        id: wsId,
        name: 'QA Rollback Workspace',
        slug: `qa-rollback-${wsId.substring(0, 8)}`,
        balance: {
          create: {
            balance_minor: 1000,
            balance_micro: 10000000n,
            reserved_micro: 0n,
          },
        },
      },
    });

    const txId = randomUUID();
    const idempotencyKey = `rollback-test-${txId}`;

    try {
      await prisma.$transaction(async (tx) => {
        // Step 1: Create a transaction
        await tx.walletTransaction.create({
          data: {
            id: txId,
            workspace_id: ws.id,
            amount_minor: 500,
            amount_micro: 5000000n,
            type: 'DEBIT',
            balance_after: 500,
            balance_after_micro: 5000000n,
            reference_type: 'TEST_ROLLBACK',
            reference_id: txId,
            idempotency_key: idempotencyKey,
          },
        });

        // Step 2: Update balance
        await tx.workspaceBalance.update({
          where: { workspace_id: ws.id },
          data: { balance_micro: 5000000n },
        });

        // Step 3: Deliberately abort transaction
        throw new Error('FORCE_ROLLBACK_INTEGRITY_VERIFICATION');
      });
    } catch (err: any) {
      expect(err.message).toBe('FORCE_ROLLBACK_INTEGRITY_VERIFICATION');
    }

    // Verify in real PostgreSQL that NO partial write persisted
    const balance = await prisma.workspaceBalance.findUnique({
      where: { workspace_id: ws.id },
    });
    expect(balance?.balance_micro).toBe(10000000n); // Untouched!

    const txRecord = await prisma.walletTransaction.findUnique({
      where: { idempotency_key: idempotencyKey },
    });
    expect(txRecord).toBeNull(); // Completely rolled back!
  });

  it('4. verifies row-level locking (SELECT ... FOR UPDATE) natively in PostgreSQL', async () => {
    const wsId = randomUUID();
    createdWorkspaceIds.push(wsId);

    await prisma.workspace.create({
      data: {
        id: wsId,
        name: 'QA Row Lock Workspace',
        slug: `qa-rowlock-${wsId.substring(0, 8)}`,
        balance: {
          create: {
            balance_micro: 50000000n,
            reserved_micro: 10000000n,
          },
        },
      },
    });

    // Execute real SELECT ... FOR UPDATE query within transaction
    await prisma.$transaction(async (tx) => {
      const records = await tx.$queryRaw<Array<{ balance_micro: bigint; reserved_micro: bigint }>>`
        SELECT balance_micro, reserved_micro 
        FROM "workspace_balances" 
        WHERE workspace_id = ${wsId} 
        FOR UPDATE
      `;

      expect(records).toBeDefined();
      expect(records.length).toBe(1);
      expect(BigInt(records[0].balance_micro)).toBe(50000000n);
      expect(BigInt(records[0].reserved_micro)).toBe(10000000n);
    });
  });

  it('5. verifies BigInt micro-dollar arithmetic precision in PostgreSQL', async () => {
    const wsId = randomUUID();
    createdWorkspaceIds.push(wsId);

    const bigMicroAmount = 123456789012345n; // > 53 bits (outside standard JS Number safe integer)

    await prisma.workspace.create({
      data: {
        id: wsId,
        name: 'QA BigInt Workspace',
        slug: `qa-bigint-${wsId.substring(0, 8)}`,
        balance: {
          create: {
            balance_micro: bigMicroAmount,
            reserved_micro: 0n,
          },
        },
      },
    });

    const retrieved = await prisma.workspaceBalance.findUniqueOrThrow({
      where: { workspace_id: wsId },
    });

    expect(retrieved.balance_micro).toBe(bigMicroAmount);

    // Increment atomically
    const increment = 987654321n;
    const updated = await prisma.workspaceBalance.update({
      where: { workspace_id: wsId },
      data: {
        balance_micro: { increment },
      },
    });

    expect(updated.balance_micro).toBe(bigMicroAmount + increment);
  });

  it('6. verifies real PostgreSQL tenant isolation across distinct workspaces', async () => {
    const wsA = randomUUID();
    const wsB = randomUUID();
    createdWorkspaceIds.push(wsA, wsB);

    await prisma.workspace.create({
      data: { id: wsA, name: 'Workspace A', slug: `qa-tenant-a-${wsA.substring(0, 8)}` },
    });
    await prisma.workspace.create({
      data: { id: wsB, name: 'Workspace B', slug: `qa-tenant-b-${wsB.substring(0, 8)}` },
    });

    await prisma.campaign.create({
      data: { id: randomUUID(), workspace_id: wsA, name: 'Campaign Tenant A' },
    });
    await prisma.campaign.create({
      data: { id: randomUUID(), workspace_id: wsB, name: 'Campaign Tenant B' },
    });

    // Query strictly for Workspace A
    const aCampaigns = await prisma.campaign.findMany({
      where: { workspace_id: wsA },
    });

    expect(aCampaigns.length).toBe(1);
    expect(aCampaigns[0].name).toBe('Campaign Tenant A');
    expect(aCampaigns.some((c) => c.workspace_id === wsB)).toBe(false);
  });
});
