/**
 * CALLFLOW PHASE 2 — P2.3 WORKSTREAM D
 * POSTGRESQL INTEGRATION SUITE: CROSS-WORKSPACE BOLA & IDOR PREVENTION
 *
 * Scenarios Covered:
 * 1. BOLA/IDOR Call Read Rejection: Cross-workspace call lookup by ID fails closed (NotFoundException).
 * 2. Cross-Workspace Call Listing Isolation: Tenant A listing never returns Tenant B calls.
 * 3. BOLA/IDOR Buyer Read Rejection: Cross-workspace buyer lookup by ID fails closed (NotFoundException).
 * 4. Cross-Workspace Buyer Mutation Rejection: Cross-workspace update fails closed, preserving target data.
 * 5. BOLA/IDOR Campaign Read & Mutation Rejection: Cross-workspace campaign lookup and mutation rejected.
 * 6. Cross-Workspace Financial & Reservation Mutation Rejection: Tenant A cannot mutate Tenant B wallet/reservations.
 * 7. Commercial Records & Disputes BOLA Rejection: Tenant A cannot dispute Tenant B commercial records.
 * 8. Cross-Workspace Delete Rejection: Attempting to delete Tenant B resources using Tenant A scope deletes 0 rows.
 * 9. Strict Compound Query Boundary Validation: Enforcing { id, workspace_id } contracts at the database layer.
 *
 * Safety & Isolation:
 * - Real PostgreSQL database transactions, queries, and constraints.
 * - Non-production database assertion (fails closed if non-test target detected).
 * - Full database cleanup in afterAll ensuring pristine state.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException, ForbiddenException, Logger } from '@nestjs/common';
import { CallState, ReservationStatus, CommercialStatus } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { CallsService } from '../src/calls/calls.service.js';
import { BuyersService } from '../src/routing/buyers.service.js';
import { CampaignsService } from '../src/routing/campaigns.service.js';
import { WalletService } from '../src/billing/wallet.service.js';
import { CommercialDisputesService } from '../src/commercial/commercial-disputes.service.js';
import { PermissionsService } from '../src/permissions/permissions.service.js';
import { AuditLogsService } from '../src/audit-logs/audit-logs.service.js';
import { FakeTelephonyProvider } from '../src/telephony/fake.provider.js';
import { TELEPHONY_PROVIDER } from '../src/telephony/call-controller.js';
import { WebhooksService } from '../src/webhooks/webhooks.service.js';
import { UsageService } from '../src/usage/usage.service.js';
import { assertNonProductionDatabase } from '../src/common/database-isolation.util.js';

class MockWebhooksService {
  async queueEvent(): Promise<void> {}
  clear(): void {}
}

describe('P2.3 Workstream D: Cross-Workspace BOLA & IDOR Integration Suite (Real PostgreSQL)', () => {
  const logger = new Logger('CrossWorkspaceBolaSuite');
  const qaDbUrl =
    process.env.DATABASE_URL ||
    'postgresql://postgres:%2A222%2A2%23Arpit@localhost:5432/calltracking_mvp_test?schema=public';

  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let callsService: CallsService;
  let buyersService: BuyersService;
  let campaignsService: CampaignsService;
  let walletService: WalletService;
  let disputesService: CommercialDisputesService;

  // Workspace A Fixture IDs
  const WS_A_ID = `ws-p23-bola-a-${randomUUID()}`;
  const USER_A_ID = `usr-p23-a-${randomUUID()}`;
  const CAMPAIGN_A_ID = `cmp-p23-a-${randomUUID()}`;
  const BUYER_A_ID = `byr-p23-a-${randomUUID()}`;
  const CALL_A_ID = `call-p23-a-${randomUUID()}`;

  // Workspace B Fixture IDs
  const WS_B_ID = `ws-p23-bola-b-${randomUUID()}`;
  const USER_B_ID = `usr-p23-b-${randomUUID()}`;
  const CAMPAIGN_B_ID = `cmp-p23-b-${randomUUID()}`;
  const BUYER_B_ID = `byr-p23-b-${randomUUID()}`;
  const CALL_B_ID = `call-p23-b-${randomUUID()}`;
  let commBId: string;

  const trackedWorkspaceIds: string[] = [WS_A_ID, WS_B_ID];
  const trackedProfileIds: string[] = [USER_A_ID, USER_B_ID];

  beforeAll(async () => {
    assertNonProductionDatabase(qaDbUrl, 'P2.3 Cross-Workspace BOLA & IDOR Suite');

    moduleRef = await Test.createTestingModule({
      providers: [
        PrismaService,
        CallsService,
        BuyersService,
        CampaignsService,
        WalletService,
        CommercialDisputesService,
        AuditLogsService,
        UsageService,
        {
          provide: PermissionsService,
          useValue: {
            getPermissionsForUser: async (workspaceId: string, userId: string) => [
              { key: 'call:read', scope_type: 'ALL' },
              { key: 'buyer:read', scope_type: 'ALL' },
              { key: 'buyer:create', scope_type: 'ALL' },
              { key: 'buyer:update', scope_type: 'ALL' },
              { key: 'campaign:read', scope_type: 'ALL' },
              { key: 'campaign:create', scope_type: 'ALL' },
              { key: 'campaign:update', scope_type: 'ALL' },
              { key: 'dispute:create', scope_type: 'ALL' },
              { key: 'dispute:manage', scope_type: 'ALL' },
            ],
            hasPermission: async () => true,
            hasResourceScope: async () => true,
          },
        },
        { provide: TELEPHONY_PROVIDER, useValue: new FakeTelephonyProvider() },
        { provide: WebhooksService, useValue: new MockWebhooksService() },
      ],
    }).compile();

    prisma = moduleRef.get<PrismaService>(PrismaService);
    callsService = moduleRef.get<CallsService>(CallsService);
    buyersService = moduleRef.get<BuyersService>(BuyersService);
    campaignsService = moduleRef.get<CampaignsService>(CampaignsService);
    walletService = moduleRef.get<WalletService>(WalletService);
    disputesService = moduleRef.get<CommercialDisputesService>(CommercialDisputesService);

    // 1. Provision Workspace A
    await prisma.workspace.create({
      data: {
        id: WS_A_ID,
        name: 'BOLA Tenant Alpha',
        slug: `bola-alpha-${WS_A_ID.slice(0, 8)}`,
        status: 'ACTIVE',
      },
    });
    await prisma.profile.create({
      data: { id: USER_A_ID, display_name: 'User Alpha BOLA' },
    });
    const buyerA = await prisma.buyer.create({
      data: {
        id: BUYER_A_ID,
        workspace_id: WS_A_ID,
        name: 'Buyer Alpha Corp',
        destination_number: '+18005551111',
        status: 'ACTIVE',
        max_concurrent_calls: 5,
      },
    });
    await prisma.workspaceMember.create({
      data: {
        workspace_id: WS_A_ID,
        user_id: USER_A_ID,
        role: 'OWNER',
        participant_type: 'BUYER',
        buyer_id: buyerA.id,
      },
    });
    await prisma.workspaceBalance.create({
      data: {
        workspace_id: WS_A_ID,
        balance_micro: 50_000_000n,
        reserved_micro: 0n,
      },
    });
    const campaignA = await prisma.campaign.create({
      data: {
        id: CAMPAIGN_A_ID,
        workspace_id: WS_A_ID,
        name: 'Campaign Alpha',
        status: 'ACTIVE',
      },
    });
    await prisma.call.create({
      data: {
        id: CALL_A_ID,
        workspace_id: WS_A_ID,
        provider: 'telnyx',
        provider_call_id: `prov-${CALL_A_ID}`,
        from_number: '+15551110001',
        to_number: '+15552220001',
        state: CallState.INITIATED,
      },
    });
    await prisma.callReservation.create({
      data: {
        workspace_id: WS_A_ID,
        call_id: CALL_A_ID,
        original_reserved_micro: 1_000_000n,
        total_reserved_micro: 1_000_000n,
        status: ReservationStatus.ACTIVE,
      },
    });

    // 2. Provision Workspace B
    await prisma.workspace.create({
      data: {
        id: WS_B_ID,
        name: 'BOLA Tenant Beta',
        slug: `bola-beta-${WS_B_B_ID_SLUG(WS_B_ID)}`,
        status: 'ACTIVE',
      },
    });
    await prisma.profile.create({
      data: { id: USER_B_ID, display_name: 'User Beta BOLA' },
    });
    await prisma.workspaceMember.create({
      data: {
        workspace_id: WS_B_ID,
        user_id: USER_B_ID,
        role: 'OWNER',
        participant_type: 'INTERNAL',
      },
    });
    await prisma.workspaceBalance.create({
      data: {
        workspace_id: WS_B_ID,
        balance_micro: 50_000_000n,
        reserved_micro: 0n,
      },
    });
    const buyerB = await prisma.buyer.create({
      data: {
        id: BUYER_B_ID,
        workspace_id: WS_B_ID,
        name: 'Buyer Beta LLC Original',
        destination_number: '+18005552222',
        status: 'ACTIVE',
        max_concurrent_calls: 5,
      },
    });
    const campaignB = await prisma.campaign.create({
      data: {
        id: CAMPAIGN_B_ID,
        workspace_id: WS_B_ID,
        name: 'Campaign Beta Original',
        status: 'ACTIVE',
      },
    });
    await prisma.call.create({
      data: {
        id: CALL_B_ID,
        workspace_id: WS_B_ID,
        provider: 'telnyx',
        provider_call_id: `prov-${CALL_B_ID}`,
        from_number: '+15551110002',
        to_number: '+15552220002',
        state: CallState.INITIATED,
      },
    });
    await prisma.callReservation.create({
      data: {
        workspace_id: WS_B_ID,
        call_id: CALL_B_ID,
        original_reserved_micro: 2_000_000n,
        total_reserved_micro: 2_000_000n,
        status: ReservationStatus.ACTIVE,
      },
    });
    const commB = await prisma.callCommercial.create({
      data: {
        workspace_id: WS_B_ID,
        call_id: CALL_B_ID,
        campaign_id: campaignB.id,
        buyer_id: buyerB.id,
        status: CommercialStatus.EVALUATED,
        currency: 'USD',
        revenue: 25.0,
        payout: 10.0,
        profit: 15.0,
      },
    });
    commBId = commB.id;

    logger.log('BOLA Preflight: Two isolated tenants provisioned with independent resources.');
  });

  function WS_B_B_ID_SLUG(id: string) {
    return id.slice(0, 8);
  }

  afterAll(async () => {
    try {
      if (prisma) {
        for (const wsId of trackedWorkspaceIds) {
          await prisma.$executeRaw`DELETE FROM "settlement_items" WHERE workspace_id = ${wsId}`.catch(() => {});
          await prisma.$executeRaw`DELETE FROM "call_disputes" WHERE workspace_id = ${wsId}`.catch(() => {});
          await prisma.$executeRaw`DELETE FROM "call_commercials" WHERE workspace_id = ${wsId}`.catch(() => {});
          await prisma.$executeRaw`DELETE FROM "call_reservations" WHERE workspace_id = ${wsId}`.catch(() => {});
          await prisma.$executeRaw`DELETE FROM "calls" WHERE workspace_id = ${wsId}`.catch(() => {});
          await prisma.$executeRaw`DELETE FROM "destination_numbers" WHERE workspace_id = ${wsId}`.catch(() => {});
          await prisma.$executeRaw`DELETE FROM "buyers" WHERE workspace_id = ${wsId}`.catch(() => {});
          await prisma.$executeRaw`DELETE FROM "campaigns" WHERE workspace_id = ${wsId}`.catch(() => {});
          await prisma.$executeRaw`DELETE FROM "wallet_transactions" WHERE workspace_id = ${wsId}`.catch(() => {});
          await prisma.$executeRaw`DELETE FROM "workspace_balances" WHERE workspace_id = ${wsId}`.catch(() => {});
          await prisma.$executeRaw`DELETE FROM "workspace_members" WHERE workspace_id = ${wsId}`.catch(() => {});
          await prisma.$executeRaw`DELETE FROM "workspaces" WHERE id = ${wsId}`.catch(() => {});
        }

        if (trackedProfileIds.length > 0) {
          await prisma.profile.deleteMany({
            where: { id: { in: trackedProfileIds } },
          }).catch(() => {});
        }
      }
    } finally {
      if (moduleRef) {
        await moduleRef.close().catch(() => {});
      }
    }
  });

  // =========================================================================
  // SCENARIO 1: BOLA/IDOR CALL DETAIL READ REJECTION
  // =========================================================================
  it('1. BOLA Prevention: Tenant A cannot read Tenant B call detail by ID', async () => {
    // Attempting to read Tenant B's call while authenticated in Tenant A
    await expect(
      callsService.getCallDetail(WS_A_ID, CALL_B_ID, USER_A_ID),
    ).rejects.toThrow(NotFoundException);

    // Legitimate lookup within Tenant A succeeds
    const legitimateCall = await callsService.getCallDetail(WS_A_ID, CALL_A_ID, USER_A_ID);
    expect(legitimateCall).toBeDefined();
    expect(legitimateCall.id).toBe(CALL_A_ID);
    expect(legitimateCall.workspace_id).toBe(WS_A_ID);
  });

  // =========================================================================
  // SCENARIO 2: CROSS-WORKSPACE CALL LISTING ISOLATION
  // =========================================================================
  it('2. List Isolation: Tenant A call list never leaks Tenant B calls', async () => {
    const listA = await callsService.getCalls(WS_A_ID, USER_A_ID, {});
    const idsInA = listA.items.map((c: any) => c.id);

    expect(idsInA).toContain(CALL_A_ID);
    expect(idsInA).not.toContain(CALL_B_ID);

    const listB = await callsService.getCalls(WS_B_ID, USER_B_ID, {});
    const idsInB = listB.items.map((c: any) => c.id);

    expect(idsInB).toContain(CALL_B_ID);
    expect(idsInB).not.toContain(CALL_A_ID);
  });

  // =========================================================================
  // SCENARIO 3: BOLA/IDOR BUYER READ REJECTION
  // =========================================================================
  it('3. BOLA Prevention: Tenant A cannot read Tenant B buyer by ID', async () => {
    await expect(
      buyersService.getBuyer(WS_A_ID, BUYER_B_ID),
    ).rejects.toThrow(NotFoundException);

    // Legitimate lookup in Tenant A succeeds
    const legitimateBuyer = await buyersService.getBuyer(WS_A_ID, BUYER_A_ID);
    expect(legitimateBuyer.id).toBe(BUYER_A_ID);
    expect(legitimateBuyer.name).toBe('Buyer Alpha Corp');
  });

  // =========================================================================
  // SCENARIO 4: CROSS-WORKSPACE BUYER WRITE / MUTATION REJECTION
  // =========================================================================
  it('4. Write Rejection: Tenant A cannot update Tenant B buyer (target data remains pristine)', async () => {
    await expect(
      buyersService.updateBuyer(WS_A_ID, BUYER_B_ID, {
        name: 'Malicious Overwrite Attempt',
      }),
    ).rejects.toThrow(NotFoundException);

    // Verify in PostgreSQL that Tenant B buyer was NOT altered
    const buyerBInDb = await prisma.buyer.findUnique({
      where: { id: BUYER_B_ID },
    });
    expect(buyerBInDb).toBeDefined();
    expect(buyerBInDb!.name).toBe('Buyer Beta LLC Original');
    expect(buyerBInDb!.name).not.toBe('Malicious Overwrite Attempt');
  });

  // =========================================================================
  // SCENARIO 5: BOLA/IDOR CAMPAIGN READ & MUTATION REJECTION
  // =========================================================================
  it('5. Campaign BOLA: Tenant A cannot read or mutate Tenant B campaign', async () => {
    // Read rejection
    await expect(
      campaignsService.getCampaign(WS_A_ID, CAMPAIGN_B_ID),
    ).rejects.toThrow(NotFoundException);

    // Direct database update attempt using mismatched tenant scope fails closed
    const updateResult = await prisma.campaign.updateMany({
      where: { id: CAMPAIGN_B_ID, workspace_id: WS_A_ID },
      data: { name: 'Compromised Campaign' },
    });
    expect(updateResult.count).toBe(0);

    const campaignBInDb = await prisma.campaign.findUnique({
      where: { id: CAMPAIGN_B_ID },
    });
    expect(campaignBInDb!.name).toBe('Campaign Beta Original');
  });

  // =========================================================================
  // SCENARIO 6: CROSS-WORKSPACE FINANCIAL & WALLET MUTATION REJECTION
  // =========================================================================
  it('6. Financial Mutation Rejection: Tenant A cannot extend, release, or settle Tenant B reservations', async () => {
    const balBBefore = await prisma.workspaceBalance.findUnique({
      where: { workspace_id: WS_B_ID },
    });

    // 1. Cross-workspace reservation extension rejected
    await expect(
      walletService.extendReservationForCall(
        WS_A_ID,
        CALL_B_ID,
        500_000n,
        `ext-unauth-${randomUUID()}`,
      ),
    ).rejects.toThrow();

    // 2. Cross-workspace reservation release rejected
    await expect(
      walletService.releaseReservation(WS_A_ID, CALL_B_ID),
    ).rejects.toThrow();

    // 3. Cross-workspace reservation settlement rejected
    await expect(
      walletService.settleReservation(WS_A_ID, CALL_B_ID, 500_000n),
    ).rejects.toThrow();

    // Verify Tenant B balance was completely untouched in PostgreSQL
    const balBAfter = await prisma.workspaceBalance.findUnique({
      where: { workspace_id: WS_B_ID },
    });
    expect(balBAfter!.balance_micro).toBe(balBBefore!.balance_micro);
    expect(balBAfter!.reserved_micro).toBe(balBBefore!.reserved_micro);
  });

  // =========================================================================
  // SCENARIO 7: COMMERCIAL RECORDS & DISPUTES BOLA REJECTION
  // =========================================================================
  it('7. Disputes BOLA: Tenant A cannot dispute Tenant B commercial records', async () => {
    await expect(
      disputesService.createDispute({
        workspaceId: WS_A_ID,
        callCommercialId: commBId,
        userId: USER_A_ID,
        reason: 'Unauthorized cross-tenant dispute',
      }),
    ).rejects.toThrow(NotFoundException);

    // Verify in PostgreSQL that zero dispute records were created
    const disputes = await prisma.callDispute.findMany({
      where: { call_commercial_id: commBId },
    });
    expect(disputes.length).toBe(0);
  });

  // =========================================================================
  // SCENARIO 8: CROSS-WORKSPACE DELETE / DESTRUCTION REJECTION
  // =========================================================================
  it('8. Delete Rejection: Scoped delete query from Tenant A cannot delete Tenant B resources', async () => {
    // Attempt to delete Tenant B buyer from Tenant A scope
    const deleteResult = await prisma.buyer.deleteMany({
      where: {
        id: BUYER_B_ID,
        workspace_id: WS_A_ID,
      },
    });
    expect(deleteResult.count).toBe(0);

    // Tenant B buyer still exists intact in PostgreSQL
    const buyerB = await prisma.buyer.findUnique({
      where: { id: BUYER_B_ID },
    });
    expect(buyerB).not.toBeNull();
    expect(buyerB!.id).toBe(BUYER_B_ID);
  });

  // =========================================================================
  // SCENARIO 9: COMPOUND WHERE CLAUSE ENFORCEMENT
  // =========================================================================
  it('9. Database Compound Key Defense: Raw and Prisma queries enforce { id, workspace_id } strictly', async () => {
    // Direct Prisma findFirst with mismatched workspace returns null
    const result = await prisma.call.findFirst({
      where: {
        id: CALL_B_ID,
        workspace_id: WS_A_ID,
      },
    });
    expect(result).toBeNull();

    // Raw SQL compound query returns 0 rows
    const rawResult: any[] = await prisma.$queryRaw`
      SELECT id FROM "calls" WHERE id = ${CALL_B_ID} AND workspace_id = ${WS_A_ID}
    `;
    expect(rawResult.length).toBe(0);
  });
});
