/**
 * CALLFLOW PHASE 2 — P2.3 WORKSTREAM D
 * POSTGRESQL INTEGRATION SUITE: AUTHENTICATION & RBAC REJECTION SCENARIOS
 *
 * Scenarios Covered:
 * 1. Unauthenticated user (no member record) is rejected from workspace operations.
 * 2. User not a member of the target workspace cannot access workspace resources.
 * 3. RBAC: VENDOR participant is rejected from buyer-only operations (disputes).
 * 4. RBAC: INTERNAL member without buyer_id cannot create disputes.
 * 5. Cross-workspace authentication: User authenticated in Workspace A cannot operate in Workspace B.
 * 6. Workspace status enforcement: operations against SUSPENDED/INACTIVE workspace are blocked.
 * 7. WorkspaceRolesGuard: validateWorkspaceAccess rejects non-members and suspended workspaces.
 * 8. Privilege escalation prevention: non-owner cannot add new members with elevated roles.
 *
 * Safety & Isolation:
 * - Real PostgreSQL-backed operations against test database.
 * - Non-production database assertion (fails closed).
 * - Cascading cleanup in afterAll.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException, Logger } from '@nestjs/common';
import { CommercialStatus } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { CommercialDisputesService } from '../src/commercial/commercial-disputes.service.js';
import { AuditLogsService } from '../src/audit-logs/audit-logs.service.js';
import { AuthorizationService } from '../src/authorization/authorization.service.js';
import { WorkspacesService } from '../src/workspaces/workspaces.service.js';
import { assertNonProductionDatabase } from '../src/common/database-isolation.util.js';

describe('P2.3 Workstream D: Authentication & RBAC Rejection Integration Suite (Real PostgreSQL)', () => {
  const logger = new Logger('AuthRbacRejectionSuite');
  const qaDbUrl =
    process.env.DATABASE_URL ||
    'postgresql://postgres:%2A222%2A2%23Arpit@localhost:5432/calltracking_mvp_test?schema=public';

  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let disputesService: CommercialDisputesService;
  let authorizationService: AuthorizationService;

  // Workspace A: active workspace with various member types
  const WS_A_ID = `ws-p23-rbac-a-${randomUUID()}`;
  const USER_OWNER_ID = `usr-p23-owner-${randomUUID()}`;
  const USER_VENDOR_ID = `usr-p23-vendor-${randomUUID()}`;
  const USER_BUYER_ID = `usr-p23-buyer-${randomUUID()}`;
  const USER_INTERNAL_ID = `usr-p23-internal-${randomUUID()}`;
  const USER_STRANGER_ID = `usr-p23-stranger-${randomUUID()}`;
  const BUYER_ID = `byr-p23-${randomUUID()}`;
  const CALL_ID = `call-p23-auth-${randomUUID()}`;
  const CAMPAIGN_ID = `cmp-p23-auth-${randomUUID()}`;
  let commId: string;

  // Workspace B: inactive/suspended workspace
  const WS_B_ID = `ws-p23-rbac-b-${randomUUID()}`;
  const USER_B_OWNER_ID = `usr-p23-b-owner-${randomUUID()}`;

  const trackedWorkspaceIds: string[] = [WS_A_ID, WS_B_ID];
  const trackedProfileIds: string[] = [USER_OWNER_ID, USER_VENDOR_ID, USER_BUYER_ID, USER_INTERNAL_ID, USER_STRANGER_ID, USER_B_OWNER_ID];

  beforeAll(async () => {
    assertNonProductionDatabase(qaDbUrl, 'P2.3 Auth & RBAC Rejection Suite');

    moduleRef = await Test.createTestingModule({
      providers: [
        PrismaService,
        CommercialDisputesService,
        AuditLogsService,
        AuthorizationService,
      ],
    }).compile();

    prisma = moduleRef.get<PrismaService>(PrismaService);
    disputesService = moduleRef.get<CommercialDisputesService>(CommercialDisputesService);
    authorizationService = moduleRef.get<AuthorizationService>(AuthorizationService);

    // === Provision Workspace A (ACTIVE) ===
    await prisma.workspace.create({
      data: {
        id: WS_A_ID,
        name: 'RBAC Test Workspace Alpha',
        slug: `rbac-alpha-${WS_A_ID.slice(0, 8)}`,
        status: 'ACTIVE',
      },
    });

    // Create profiles for all users
    for (const [id, name] of [
      [USER_OWNER_ID, 'Owner User'],
      [USER_VENDOR_ID, 'Vendor User'],
      [USER_BUYER_ID, 'Buyer User'],
      [USER_INTERNAL_ID, 'Internal User'],
      [USER_STRANGER_ID, 'Stranger User'],
      [USER_B_OWNER_ID, 'WS-B Owner'],
    ]) {
      await prisma.profile.create({ data: { id, display_name: name } });
    }

    // Create a buyer for workspace A
    const buyer = await prisma.buyer.create({
      data: {
        id: BUYER_ID,
        workspace_id: WS_A_ID,
        name: 'RBAC Test Buyer',
        destination_number: '+18005559999',
        status: 'ACTIVE',
        max_concurrent_calls: 3,
      },
    });

    // Add members with different participant types
    await prisma.workspaceMember.create({
      data: {
        workspace_id: WS_A_ID,
        user_id: USER_OWNER_ID,
        role: 'OWNER',
        participant_type: 'INTERNAL',
      },
    });
    await prisma.workspaceMember.create({
      data: {
        workspace_id: WS_A_ID,
        user_id: USER_VENDOR_ID,
        role: 'MEMBER',
        participant_type: 'VENDOR',
      },
    });
    await prisma.workspaceMember.create({
      data: {
        workspace_id: WS_A_ID,
        user_id: USER_BUYER_ID,
        role: 'MEMBER',
        participant_type: 'BUYER',
        buyer_id: buyer.id,
      },
    });
    await prisma.workspaceMember.create({
      data: {
        workspace_id: WS_A_ID,
        user_id: USER_INTERNAL_ID,
        role: 'MEMBER',
        participant_type: 'INTERNAL',
      },
    });
    // USER_STRANGER_ID: NOT a member of WS_A

    // Create a campaign and call for dispute testing
    await prisma.campaign.create({
      data: {
        id: CAMPAIGN_ID,
        workspace_id: WS_A_ID,
        name: 'RBAC Auth Test Campaign',
        status: 'ACTIVE',
      },
    });

    await prisma.call.create({
      data: {
        id: CALL_ID,
        workspace_id: WS_A_ID,
        provider: 'telnyx',
        provider_call_id: `prov-${CALL_ID}`,
        from_number: '+15550001111',
        to_number: '+15550002222',
        state: 'INITIATED',
      },
    });

    // Create a commercial record attributed to Buyer
    const comm = await prisma.callCommercial.create({
      data: {
        workspace_id: WS_A_ID,
        call_id: CALL_ID,
        campaign_id: CAMPAIGN_ID,
        buyer_id: BUYER_ID,
        status: CommercialStatus.EVALUATED,
        currency: 'USD',
        revenue: 10.0,
        payout: 5.0,
        profit: 5.0,
      },
    });
    commId = comm.id;

    // === Provision Workspace B (SUSPENDED) ===
    await prisma.workspace.create({
      data: {
        id: WS_B_ID,
        name: 'RBAC Suspended Workspace Beta',
        slug: `rbac-beta-${WS_B_ID.slice(0, 8)}`,
        status: 'SUSPENDED',
      },
    });
    await prisma.workspaceMember.create({
      data: {
        workspace_id: WS_B_ID,
        user_id: USER_B_OWNER_ID,
        role: 'OWNER',
        participant_type: 'INTERNAL',
      },
    });

    logger.log('RBAC Preflight: Active workspace (mixed participant types) and suspended workspace provisioned.');
  });

  afterAll(async () => {
    try {
      if (prisma) {
        for (const wsId of trackedWorkspaceIds) {
          await prisma.$executeRaw`DELETE FROM "call_disputes" WHERE workspace_id = ${wsId}`.catch(() => {});
          await prisma.$executeRaw`DELETE FROM "call_commercials" WHERE workspace_id = ${wsId}`.catch(() => {});
          await prisma.$executeRaw`DELETE FROM "call_reservations" WHERE workspace_id = ${wsId}`.catch(() => {});
          await prisma.$executeRaw`DELETE FROM "calls" WHERE workspace_id = ${wsId}`.catch(() => {});
          await prisma.$executeRaw`DELETE FROM "buyers" WHERE workspace_id = ${wsId}`.catch(() => {});
          await prisma.$executeRaw`DELETE FROM "campaigns" WHERE workspace_id = ${wsId}`.catch(() => {});
          await prisma.$executeRaw`DELETE FROM "workspace_balances" WHERE workspace_id = ${wsId}`.catch(() => {});
          await prisma.$executeRaw`DELETE FROM "workspace_members" WHERE workspace_id = ${wsId}`.catch(() => {});
          await prisma.$executeRaw`DELETE FROM "workspaces" WHERE id = ${wsId}`.catch(() => {});
        }
        await prisma.profile.deleteMany({
          where: { id: { in: trackedProfileIds } },
        }).catch(() => {});
      }
    } finally {
      if (moduleRef) {
        await moduleRef.close().catch(() => {});
      }
    }
  });

  // =========================================================================
  // SCENARIO 1: STRANGER (NON-MEMBER) IS REJECTED
  // =========================================================================
  it('1. Auth Rejection: Non-member (stranger) user cannot access workspace (workspace membership check)', async () => {
    const role = await authorizationService.getUserWorkspaceRole(USER_STRANGER_ID, WS_A_ID);
    expect(role).toBeNull();

    // validateWorkspaceAccess should throw ForbiddenException for non-member
    await expect(
      authorizationService.validateWorkspaceAccess(USER_STRANGER_ID, WS_A_ID),
    ).rejects.toThrow(ForbiddenException);
  });

  // =========================================================================
  // SCENARIO 2: NON-MEMBER CANNOT CREATE DISPUTE
  // =========================================================================
  it('2. Auth Rejection: Non-member user cannot dispute any commercial record (ForbiddenException)', async () => {
    await expect(
      disputesService.createDispute({
        workspaceId: WS_A_ID,
        callCommercialId: commId,
        userId: USER_STRANGER_ID,
        reason: 'Non-member dispute attempt',
      }),
    ).rejects.toThrow(ForbiddenException);

    // Verify no disputes were created
    const disputes = await prisma.callDispute.count({
      where: { call_commercial_id: commId },
    });
    expect(disputes).toBe(0);
  });

  // =========================================================================
  // SCENARIO 3: VENDOR PARTICIPANT CANNOT CREATE BUYER DISPUTE
  // =========================================================================
  it('3. RBAC Rejection: VENDOR participant cannot create buyer-only disputes', async () => {
    await expect(
      disputesService.createDispute({
        workspaceId: WS_A_ID,
        callCommercialId: commId,
        userId: USER_VENDOR_ID,
        reason: 'Vendor dispute attempt',
      }),
    ).rejects.toThrow(ForbiddenException);

    const disputes = await prisma.callDispute.count({
      where: { call_commercial_id: commId },
    });
    expect(disputes).toBe(0);
  });

  // =========================================================================
  // SCENARIO 4: INTERNAL MEMBER (NO BUYER_ID) CANNOT CREATE DISPUTE
  // =========================================================================
  it('4. RBAC Rejection: INTERNAL participant without buyer_id cannot create disputes', async () => {
    // USER_INTERNAL_ID is INTERNAL participant type (no buyer_id)
    await expect(
      disputesService.createDispute({
        workspaceId: WS_A_ID,
        callCommercialId: commId,
        userId: USER_INTERNAL_ID,
        reason: 'Internal member dispute attempt',
      }),
    ).rejects.toThrow(ForbiddenException);

    const disputes = await prisma.callDispute.count({
      where: { call_commercial_id: commId },
    });
    expect(disputes).toBe(0);
  });

  // =========================================================================
  // SCENARIO 5: OWNER INTERNAL MEMBER CANNOT CREATE DISPUTE (not buyer)
  // =========================================================================
  it('5. RBAC Rejection: OWNER/INTERNAL cannot create disputes (requires BUYER participant)', async () => {
    await expect(
      disputesService.createDispute({
        workspaceId: WS_A_ID,
        callCommercialId: commId,
        userId: USER_OWNER_ID,
        reason: 'Owner internal dispute attempt',
      }),
    ).rejects.toThrow(ForbiddenException);

    const disputes = await prisma.callDispute.count({
      where: { call_commercial_id: commId },
    });
    expect(disputes).toBe(0);
  });

  // =========================================================================
  // SCENARIO 6: BUYER PARTICIPANT CAN CREATE DISPUTE (positive case)
  // =========================================================================
  it('6. RBAC Positive: BUYER participant can create a dispute against their attributed commercial', async () => {
    const dispute = await disputesService.createDispute({
      workspaceId: WS_A_ID,
      callCommercialId: commId,
      userId: USER_BUYER_ID,
      reason: 'Authorized buyer dispute',
    });

    expect(dispute).toBeDefined();
    expect(dispute.call_commercial_id).toBe(commId);
    expect(dispute.workspace_id).toBe(WS_A_ID);
    expect(dispute.reason).toBe('Authorized buyer dispute');
  });

  // =========================================================================
  // SCENARIO 7: CROSS-WORKSPACE AUTH REJECTION (database layer)
  // =========================================================================
  it('7. Cross-Workspace Auth: User from Workspace A is not a member of Workspace B', async () => {
    // USER_OWNER_ID is a member of WS_A but NOT WS_B
    const role = await authorizationService.getUserWorkspaceRole(USER_OWNER_ID, WS_B_ID);
    expect(role).toBeNull();

    await expect(
      authorizationService.validateWorkspaceAccess(USER_OWNER_ID, WS_B_ID),
    ).rejects.toThrow(ForbiddenException);
  });

  // =========================================================================
  // SCENARIO 8: SUSPENDED WORKSPACE BLOCKS MUTATIONS
  // =========================================================================
  it('8. Workspace Status Enforcement: SUSPENDED workspace blocks all non-GET mutations', async () => {
    // USER_B_OWNER_ID is a valid member of WS_B, but WS_B is SUSPENDED
    // GET requests (no method restriction) should work
    const role = await authorizationService.validateWorkspaceAccess(USER_B_OWNER_ID, WS_B_ID, undefined, 'GET', '/workspaces');
    expect(role).toBe('OWNER');

    // POST mutation against suspended workspace should throw ForbiddenException
    await expect(
      authorizationService.validateWorkspaceAccess(USER_B_OWNER_ID, WS_B_ID, undefined, 'POST', '/workspaces/some-resource'),
    ).rejects.toThrow(ForbiddenException);

    // PUT mutation against suspended workspace should throw ForbiddenException
    await expect(
      authorizationService.validateWorkspaceAccess(USER_B_OWNER_ID, WS_B_ID, undefined, 'PUT', '/workspaces/some-resource'),
    ).rejects.toThrow(ForbiddenException);

    // DELETE mutation against suspended workspace should throw ForbiddenException
    await expect(
      authorizationService.validateWorkspaceAccess(USER_B_OWNER_ID, WS_B_ID, undefined, 'DELETE', '/workspaces/some-resource'),
    ).rejects.toThrow(ForbiddenException);
  });

  // =========================================================================
  // SCENARIO 9: REQUIRED ROLE ENFORCEMENT
  // =========================================================================
  it('9. Required Role Enforcement: MEMBER cannot perform OWNER-restricted operations', async () => {
    // USER_BUYER_ID has role MEMBER, not OWNER or ADMIN
    await expect(
      authorizationService.validateWorkspaceAccess(USER_BUYER_ID, WS_A_ID, ['OWNER', 'ADMIN'] as any),
    ).rejects.toThrow(ForbiddenException);

    // USER_OWNER_ID has role OWNER, should succeed
    const role = await authorizationService.validateWorkspaceAccess(USER_OWNER_ID, WS_A_ID, ['OWNER', 'ADMIN'] as any);
    expect(role).toBe('OWNER');
  });
});
