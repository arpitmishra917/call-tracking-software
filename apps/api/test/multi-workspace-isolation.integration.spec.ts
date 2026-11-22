/**
 * CALLFLOW PHASE 2 — P2.1 MULTI-WORKSPACE ISOLATION INTEGRATION & CONCURRENCY SUITE
 *
 * Scenarios Covered:
 * 1. Two workspaces receive calls concurrently.
 * 2. Each workspace routes calls using its own configuration.
 * 3. Buyers belonging to Workspace A never receive Workspace B calls.
 * 4. Concurrent webhooks cannot mutate another workspace's call state.
 * 5. Wallet reservations and financial records remain workspace-scoped.
 * 6. Workspace A cannot query Workspace B's call or commercial records.
 * 7. Duplicate and out-of-order webhook events remain idempotent.
 * 8. Failure or recovery in one workspace does not corrupt another workspace.
 *
 * Safety & Isolation:
 * - Real PostgreSQL-backed database transactions and row-level locks.
 * - Non-production database assertion (fails closed if non-test target detected).
 * - TELEPHONY_PROVIDER overridden with in-memory FakeTelephonyProvider (zero Telnyx egress).
 * - WebhooksService overridden with MockWebhooksService (zero external egress).
 * - Cascading lifecycle teardown restoring baseline state.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException, ForbiddenException, Logger } from '@nestjs/common';
import { CallState, CallAttemptState, ReservationStatus, CommercialStatus, SettlementParticipantType } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { CallController, TELEPHONY_PROVIDER } from '../src/telephony/call-controller.js';
import { CallsService } from '../src/calls/calls.service.js';
import { FakeTelephonyProvider } from '../src/telephony/fake.provider.js';
import { WebhooksService } from '../src/webhooks/webhooks.service.js';
import { UsageService } from '../src/usage/usage.service.js';
import { UsageBillingService } from '../src/billing/usage-billing.service.js';
import { WalletService } from '../src/billing/wallet.service.js';
import { ReportsService } from '../src/reports/reports.service.js';
import { CommercialDisputesService } from '../src/commercial/commercial-disputes.service.js';
import { ReservationRecoveryService } from '../src/telephony/reservation-recovery.service.js';
import { PermissionsService } from '../src/permissions/permissions.service.js';
import { AuditLogsService } from '../src/audit-logs/audit-logs.service.js';
import { CallEventType, NormalizedCallEvent } from '../src/telephony/telephony.events.js';
import { assertNonProductionDatabase } from '../src/common/database-isolation.util.js';

class MockWebhooksService {
  public readonly queuedEvents: Array<{ workspaceId: string; event: string; payload: any }> = [];

  async queueEvent(workspaceId: string, event: string, payload: any): Promise<void> {
    this.queuedEvents.push({ workspaceId, event, payload });
  }

  clear(): void {
    this.queuedEvents.length = 0;
  }
}

describe('Phase 2 — P2.1: Multi-Workspace Isolation & Concurrency Suite', () => {
  const logger = new Logger('MultiWorkspaceIsolationSuite');
  const qaDbUrl =
    process.env.DATABASE_URL ||
    'postgresql://postgres:%2A222%2A2%23Arpit@localhost:5432/calltracking_mvp_test?schema=public';

  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let callController: CallController;
  let callsService: CallsService;
  let walletService: WalletService;
  let reportsService: ReportsService;
  let disputesService: CommercialDisputesService;
  let recoveryService: ReservationRecoveryService;
  let fakeProvider: FakeTelephonyProvider;
  let mockWebhooks: MockWebhooksService;

  // Workspace A Fixture IDs
  const WS_A_ID = `ws-iso-a-${randomUUID()}`;
  const CAMPAIGN_A_ID = `cmp-iso-a-${randomUUID()}`;
  const TRACKING_DID_A = `+1700${Math.floor(1000000 + Math.random() * 9000000)}`;
  const BUYER_A_ID = `byr-iso-a-${randomUUID()}`;
  const DEST_A_ID = `dst-iso-a-${randomUUID()}`;
  const USER_A_ID = `usr-iso-a-${randomUUID()}`;

  // Workspace B Fixture IDs
  const WS_B_ID = `ws-iso-b-${randomUUID()}`;
  const CAMPAIGN_B_ID = `cmp-iso-b-${randomUUID()}`;
  const TRACKING_DID_B = `+1700${Math.floor(1000000 + Math.random() * 9000000)}`;
  const BUYER_B_ID = `byr-iso-b-${randomUUID()}`;
  const DEST_B_ID = `dst-iso-b-${randomUUID()}`;
  const USER_B_ID = `usr-iso-b-${randomUUID()}`;

  // Track created IDs for strict teardown
  const trackedWorkspaceIds: string[] = [WS_A_ID, WS_B_ID];
  const trackedProfileIds: string[] = [USER_A_ID, USER_B_ID];
  const trackedProviderCallIds = new Set<string>();

  beforeAll(async () => {
    // 1. Enforce database isolation
    assertNonProductionDatabase(qaDbUrl, 'Multi-Workspace Isolation Suite');

    fakeProvider = new FakeTelephonyProvider();
    mockWebhooks = new MockWebhooksService();

    moduleRef = await Test.createTestingModule({
      providers: [
        CallController,
        CallsService,
        PrismaService,
        UsageService,
        UsageBillingService,
        WalletService,
        ReportsService,
        CommercialDisputesService,
        ReservationRecoveryService,
        AuditLogsService,
        {
          provide: PermissionsService,
          useValue: {
            getPermissionsForUser: async (workspaceId: string, userId: string) => [
              { key: 'call:read', scope_type: 'ALL' },
              { key: 'buyer:read', scope_type: 'ALL' },
              { key: 'dispute:create', scope_type: 'ALL' },
              { key: 'dispute:manage', scope_type: 'ALL' },
            ],
          },
        },
        { provide: TELEPHONY_PROVIDER, useValue: fakeProvider },
        { provide: WebhooksService, useValue: mockWebhooks },
      ],
    }).compile();

    prisma = moduleRef.get<PrismaService>(PrismaService);
    callController = moduleRef.get<CallController>(CallController);
    callsService = moduleRef.get<CallsService>(CallsService);
    walletService = moduleRef.get<WalletService>(WalletService);
    reportsService = moduleRef.get<ReportsService>(ReportsService);
    disputesService = moduleRef.get<CommercialDisputesService>(CommercialDisputesService);
    recoveryService = moduleRef.get<ReservationRecoveryService>(ReservationRecoveryService);

    // 2. Provision Isolated Workspace A Fixtures
    await prisma.workspace.create({
      data: {
        id: WS_A_ID,
        name: 'Isolation Tenant Alpha',
        slug: `tenant-alpha-${WS_A_ID.substring(0, 8)}`,
        status: 'ACTIVE',
      },
    });

    const buyerA = await prisma.buyer.create({
      data: {
        id: BUYER_A_ID,
        workspace_id: WS_A_ID,
        name: 'Buyer Alpha Corp',
        destination_number: '+18005550001',
        status: 'ACTIVE',
        max_concurrent_calls: 5,
      },
    });

    await prisma.profile.create({
      data: { id: USER_A_ID, display_name: 'User Alpha' },
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
        balance_micro: 100_000_000n, // $100 available
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

    await prisma.phoneNumber.create({
      data: {
        workspace_id: WS_A_ID,
        campaign_id: campaignA.id,
        phone_number: TRACKING_DID_A,
        provider: 'fake',
        number_type: 'local',
        status: 'ACTIVE',
      },
    });

    const destA = await prisma.destinationNumber.create({
      data: {
        id: DEST_A_ID,
        workspace_id: WS_A_ID,
        buyer_id: buyerA.id,
        destination_number: '+18005550001',
        status: 'ACTIVE',
        max_concurrent_calls: 5,
      },
    });

    await prisma.campaignDestinationNumber.create({
      data: {
        workspace_id: WS_A_ID,
        campaign_id: campaignA.id,
        destination_number_id: destA.id,
        priority: 1,
        weight: 100,
        status: 'ACTIVE',
      },
    });

    // 3. Provision Isolated Workspace B Fixtures
    await prisma.workspace.create({
      data: {
        id: WS_B_ID,
        name: 'Isolation Tenant Beta',
        slug: `tenant-beta-${WS_B_ID.substring(0, 8)}`,
        status: 'ACTIVE',
      },
    });

    const buyerB = await prisma.buyer.create({
      data: {
        id: BUYER_B_ID,
        workspace_id: WS_B_ID,
        name: 'Buyer Beta LLC',
        destination_number: '+18005550002',
        status: 'ACTIVE',
        max_concurrent_calls: 5,
      },
    });

    await prisma.profile.create({
      data: { id: USER_B_ID, display_name: 'User Beta' },
    });

    await prisma.workspaceMember.create({
      data: {
        workspace_id: WS_B_ID,
        user_id: USER_B_ID,
        role: 'OWNER',
        participant_type: 'BUYER',
        buyer_id: buyerB.id,
      },
    });

    await prisma.workspaceBalance.create({
      data: {
        workspace_id: WS_B_ID,
        balance_micro: 50_000_000n, // $50 available
        reserved_micro: 0n,
      },
    });

    const campaignB = await prisma.campaign.create({
      data: {
        id: CAMPAIGN_B_ID,
        workspace_id: WS_B_ID,
        name: 'Campaign Beta',
        status: 'ACTIVE',
      },
    });

    await prisma.phoneNumber.create({
      data: {
        workspace_id: WS_B_ID,
        campaign_id: campaignB.id,
        phone_number: TRACKING_DID_B,
        provider: 'fake',
        number_type: 'local',
        status: 'ACTIVE',
      },
    });

    const destB = await prisma.destinationNumber.create({
      data: {
        id: DEST_B_ID,
        workspace_id: WS_B_ID,
        buyer_id: buyerB.id,
        destination_number: '+18005550002',
        status: 'ACTIVE',
        max_concurrent_calls: 5,
      },
    });

    await prisma.campaignDestinationNumber.create({
      data: {
        workspace_id: WS_B_ID,
        campaign_id: campaignB.id,
        destination_number_id: destB.id,
        priority: 1,
        weight: 100,
        status: 'ACTIVE',
      },
    });

    logger.log('Preflight complete: Two independent workspaces provisioned with pristine balances and routing fixtures.');
  });

  afterAll(async () => {
    // Cascading cleanup of created test entities
    try {
      if (trackedProviderCallIds.size > 0) {
        await prisma.call.deleteMany({
          where: { provider_call_id: { in: Array.from(trackedProviderCallIds) } },
        }).catch(() => {});
      }

      for (const wsId of trackedWorkspaceIds) {
        await prisma.$executeRaw`DELETE FROM "settlement_items" WHERE workspace_id = ${wsId}`.catch(() => {});
        await prisma.$executeRaw`DELETE FROM "call_disputes" WHERE call_commercial_id IN (SELECT id FROM "call_commercials" WHERE workspace_id = ${wsId})`.catch(() => {});
        await prisma.$executeRaw`DELETE FROM "call_commercials" WHERE workspace_id = ${wsId}`.catch(() => {});
        await prisma.$executeRaw`DELETE FROM "buyer_reservations" WHERE workspace_id = ${wsId}`.catch(() => {});
        await prisma.$executeRaw`DELETE FROM "call_reservations" WHERE workspace_id = ${wsId}`.catch(() => {});
        await prisma.$executeRaw`DELETE FROM "call_attempts" WHERE call_id IN (SELECT id FROM "calls" WHERE workspace_id = ${wsId})`.catch(() => {});
        await prisma.$executeRaw`DELETE FROM "calls" WHERE workspace_id = ${wsId}`.catch(() => {});
        await prisma.$executeRaw`DELETE FROM "campaign_destination_numbers" WHERE campaign_id IN (SELECT id FROM "campaigns" WHERE workspace_id = ${wsId})`.catch(() => {});
        await prisma.$executeRaw`DELETE FROM "campaign_buyers" WHERE workspace_id = ${wsId}`.catch(() => {});
        await prisma.$executeRaw`DELETE FROM "destination_numbers" WHERE workspace_id = ${wsId}`.catch(() => {});
        await prisma.$executeRaw`DELETE FROM "phone_numbers" WHERE workspace_id = ${wsId}`.catch(() => {});
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
    } finally {
      if (moduleRef) {
        await moduleRef.close().catch(() => {});
      }
    }
  });

  beforeEach(() => {
    mockWebhooks.clear();
  });

  function createCallEvent(toDid: string, fromCli: string, tag: string): NormalizedCallEvent {
    const callId = `iso-${tag}-${Date.now()}-${randomUUID().substring(0, 8)}`;
    trackedProviderCallIds.add(callId);
    return {
      type: CallEventType.CALL_INITIATED,
      callId,
      direction: 'incoming',
      from: fromCli,
      to: toDid,
      timestamp: new Date().toISOString(),
    };
  }

  // =========================================================================
  // SCENARIO 1: CONCURRENT INBOUND CALLS ACROSS WORKSPACES
  // =========================================================================
  it('Scenario 1: Two workspaces receive calls concurrently with strict tenant separation', async () => {
    const eventA = createCallEvent(TRACKING_DID_A, '+12025551001', 'ws-a-concurrent');
    const eventB = createCallEvent(TRACKING_DID_B, '+12025551002', 'ws-b-concurrent');

    // Dispatch both incoming calls simultaneously
    await Promise.all([
      callController.handleEvent(eventA),
      callController.handleEvent(eventB),
    ]);

    const callA = await prisma.call.findUnique({
      where: { provider_call_id: eventA.callId },
    });
    const callB = await prisma.call.findUnique({
      where: { provider_call_id: eventB.callId },
    });

    expect(callA).toBeDefined();
    expect(callA!.workspace_id).toBe(WS_A_ID);
    expect(callA!.state).toBe(CallState.INITIATED);

    expect(callB).toBeDefined();
    expect(callB!.workspace_id).toBe(WS_B_ID);
    expect(callB!.state).toBe(CallState.INITIATED);

    // Initial wallet reservations were created strictly scoped to each workspace
    const resA = await prisma.callReservation.findUnique({ where: { call_id: callA!.id } });
    const resB = await prisma.callReservation.findUnique({ where: { call_id: callB!.id } });
    expect(resA?.workspace_id).toBe(WS_A_ID);
    expect(resB?.workspace_id).toBe(WS_B_ID);
  });

  // =========================================================================
  // SCENARIO 2: WORKSPACE-SCOPED INDEPENDENT ROUTING CONFIGURATION
  // =========================================================================
  it('Scenario 2: Each workspace routes calls using its own distinct campaign & buyer configuration', async () => {
    const eventA = createCallEvent(TRACKING_DID_A, '+12025552001', 'ws-a-routing');
    const eventB = createCallEvent(TRACKING_DID_B, '+12025552002', 'ws-b-routing');

    // 1. Ingress
    await Promise.all([
      callController.handleEvent(eventA),
      callController.handleEvent(eventB),
    ]);

    // 2. Answer and route concurrently
    await Promise.all([
      callController.handleEvent({
        type: CallEventType.CALL_ANSWERED,
        callId: eventA.callId,
        direction: 'incoming',
        timestamp: new Date().toISOString(),
      }),
      callController.handleEvent({
        type: CallEventType.CALL_ANSWERED,
        callId: eventB.callId,
        direction: 'incoming',
        timestamp: new Date().toISOString(),
      }),
    ]);

    const callA = await prisma.call.findUnique({
      where: { provider_call_id: eventA.callId },
      include: { attempts: true },
    });
    const callB = await prisma.call.findUnique({
      where: { provider_call_id: eventB.callId },
      include: { attempts: true },
    });

    expect(callA?.state).toBe(CallState.ROUTING);
    expect(callA?.attempts.length).toBe(1);
    expect(callA?.attempts[0].buyer_id).toBe(BUYER_A_ID);
    expect(callA?.attempts[0].destination_number_id).toBe(DEST_A_ID);

    expect(callB?.state).toBe(CallState.ROUTING);
    expect(callB?.attempts.length).toBe(1);
    expect(callB?.attempts[0].buyer_id).toBe(BUYER_B_ID);
    expect(callB?.attempts[0].destination_number_id).toBe(DEST_B_ID);
  });

  // =========================================================================
  // SCENARIO 3: BUYERS IN WORKSPACE A NEVER RECEIVE WORKSPACE B CALLS
  // =========================================================================
  it('Scenario 3: Buyers belonging to Workspace A never receive Workspace B calls even if cross-linked', async () => {
    // Attempt malicious / erroneous cross-tenant linking: attach Buyer A to Campaign B in fallback table
    await prisma.campaignBuyer.create({
      data: {
        workspace_id: WS_B_ID,
        campaign_id: CAMPAIGN_B_ID,
        buyer_id: BUYER_A_ID, // Buyer belonging to Tenant A!
        priority: 1,
      },
    });

    const eventB = createCallEvent(TRACKING_DID_B, '+12025553001', 'ws-b-cross-guard');
    await callController.handleEvent(eventB);

    const callB = await prisma.call.findUnique({
      where: { provider_call_id: eventB.callId },
    });

    // Advance to routing
    await callsService.transitionCall(callB!.id, CallState.ROUTING);

    // Call prepareNextBuyer for Call B
    const routeResult = await callsService.prepareNextBuyer(callB!.id);

    // Should dial Buyer B (or route according to Workspace B), NEVER Buyer A
    expect(routeResult.action).toBe('DIAL');
    expect(routeResult.attempt.buyer_id).toBe(BUYER_B_ID);
    expect(routeResult.attempt.buyer_id).not.toBe(BUYER_A_ID);

    // Assert database-level active buyer reservations
    const reservationsForBuyerAOnCallB = await prisma.buyerReservation.count({
      where: { call_id: callB!.id, buyer_id: BUYER_A_ID },
    });
    expect(reservationsForBuyerAOnCallB).toBe(0);
  });

  // =========================================================================
  // SCENARIO 4: CONCURRENT WEBHOOKS CANNOT MUTATE ANOTHER WORKSPACE'S CALL
  // =========================================================================
  it('Scenario 4: Concurrent webhooks cannot mutate another workspace call state', async () => {
    const eventA = createCallEvent(TRACKING_DID_A, '+12025554001', 'ws-a-mutation');
    await callController.handleEvent(eventA);
    await callController.handleEvent({
      type: CallEventType.CALL_ANSWERED,
      callId: eventA.callId,
      direction: 'incoming',
      timestamp: new Date().toISOString(),
    });

    const callA = await prisma.call.findUnique({
      where: { provider_call_id: eventA.callId },
      include: { attempts: true },
    });
    const attemptA = callA!.attempts[0];

    // Attacker crafts a synthetic webhook carrying ClientState claiming to be Workspace B
    const spoofedClientState = Buffer.from(
      JSON.stringify({
        callId: callA!.id,
        attemptId: attemptA.id,
        workspaceId: WS_B_ID, // Mismatched workspace!
      }),
    ).toString('base64');

    const rogueBuyerCallId = `rogue-buyer-leg-${randomUUID().substring(0, 8)}`;
    await callController.handleEvent({
      type: CallEventType.CALL_ANSWERED,
      callId: rogueBuyerCallId,
      direction: 'outgoing',
      clientState: spoofedClientState,
      timestamp: new Date().toISOString(),
    });

    // Verify attempt provider_call_id was NOT corrupted with rogue call ID
    const untouchedAttempt = await prisma.callAttempt.findUnique({
      where: { id: attemptA.id },
    });
    expect(untouchedAttempt?.provider_call_id).not.toBe(rogueBuyerCallId);
  });

  // =========================================================================
  // SCENARIO 5: WALLET RESERVATIONS & FINANCIAL RECORDS ARE WORKSPACE-SCOPED
  // =========================================================================
  it('Scenario 5: Wallet reservations and financial records remain strictly workspace-scoped', async () => {
    const balA_before = await prisma.workspaceBalance.findUnique({ where: { workspace_id: WS_A_ID } });
    const balB_before = await prisma.workspaceBalance.findUnique({ where: { workspace_id: WS_B_ID } });

    const eventA = createCallEvent(TRACKING_DID_A, '+12025555001', 'ws-a-wallet');
    await callController.handleEvent(eventA);

    const callA = await prisma.call.findUnique({
      where: { provider_call_id: eventA.callId },
    });

    const balA_after = await prisma.workspaceBalance.findUnique({ where: { workspace_id: WS_A_ID } });
    const balB_after = await prisma.workspaceBalance.findUnique({ where: { workspace_id: WS_B_ID } });

    // Workspace A reserved funds increased; Workspace B remained completely unchanged
    expect(balA_after!.reserved_micro).toBeGreaterThan(balA_before!.reserved_micro);
    expect(balB_after!.reserved_micro).toBe(balB_before!.reserved_micro);
    expect(balB_after!.balance_micro).toBe(balB_before!.balance_micro);

    // Cross-workspace reservation extension rejection: Workspace B cannot extend Workspace A call
    await expect(
      walletService.extendReservationForCall(WS_B_ID, callA!.id, 5_000_000n, `ext-${randomUUID()}`),
    ).rejects.toThrow('Cross-workspace access denied.');

    // Cross-workspace reservation release rejection: Workspace B cannot release Workspace A call
    await expect(
      walletService.releaseReservation(WS_B_ID, callA!.id),
    ).rejects.toThrow('Cross-workspace access denied.');

    // Cross-workspace reservation settlement rejection: Workspace B cannot settle Workspace A call
    await expect(
      walletService.settleReservation(WS_B_ID, callA!.id, 1_000_000n),
    ).rejects.toThrow('Cross-workspace access denied.');

    // Proper settlement by owning workspace executes cleanly (using 50,000 microcents within the 100,000 initial reservation)
    const settleResult = await walletService.settleReservation(WS_A_ID, callA!.id, 50_000n);
    expect(settleResult.status).toBe(ReservationStatus.SETTLED);

    // Ledger transactions are strictly scoped
    const txsA = await walletService.getTransactions(WS_A_ID);
    const txsB = await walletService.getTransactions(WS_B_ID);
    expect(txsA.length).toBeGreaterThan(0);
    expect(txsB.length).toBe(0);
  });

  // =========================================================================
  // SCENARIO 6: WORKSPACE A CANNOT QUERY WORKSPACE B CALL OR COMMERCIAL RECORDS
  // =========================================================================
  it('Scenario 6: Workspace A cannot query Workspace B call or commercial records', async () => {
    const eventB = createCallEvent(TRACKING_DID_B, '+12025556001', 'ws-b-query-leak');
    await callController.handleEvent(eventB);

    const callB = await prisma.call.findUnique({
      where: { provider_call_id: eventB.callId },
    });

    // Create a commercial record for Call B
    const commB = await prisma.callCommercial.create({
      data: {
        workspace: { connect: { id: WS_B_ID } },
        call: { connect: { id: callB!.id } },
        campaign: { connect: { id: CAMPAIGN_B_ID } },
        buyer: { connect: { id: BUYER_B_ID } },
        status: CommercialStatus.EVALUATED,
        currency: 'USD',
        revenue: 15.0,
        payout: 8.0,
        profit: 7.0,
      },
    });

    // 1. Direct call detail lookup across workspaces throws NotFoundException
    await expect(
      callsService.getCallDetail(WS_A_ID, callB!.id, USER_A_ID),
    ).rejects.toThrow(NotFoundException);

    // 2. Workspace A call list does not contain Call B
    const listA = await callsService.getCalls(WS_A_ID, USER_A_ID, {});
    const idsInA = listA.items.map((c: any) => c.id);
    expect(idsInA).not.toContain(callB!.id);

    // 3. Workspace A cannot file a dispute on Workspace B commercial record
    await expect(
      disputesService.createDispute({
        workspaceId: WS_A_ID,
        callCommercialId: commB.id,
        userId: USER_A_ID,
        reason: 'Unauthorized cross dispute attempt',
      }),
    ).rejects.toThrow(NotFoundException);

    // 4. Reports export for Workspace A contains zero rows belonging to Call B
    const exportResult = await reportsService.generateExport(
      WS_A_ID,
      USER_A_ID,
      'csv',
      {},
      [{ id: 'id', visible: true, order: 1 }],
    );
    const csvContent = exportResult.buffer.toString('utf8');
    expect(csvContent).not.toContain(callB!.id);
  });

  // =========================================================================
  // SCENARIO 7: DUPLICATE AND OUT-OF-ORDER WEBHOOK EVENTS REMAIN IDEMPOTENT
  // =========================================================================
  it('Scenario 7: Duplicate and out-of-order webhook events remain strictly idempotent', async () => {
    const eventA = createCallEvent(TRACKING_DID_A, '+12025557001', 'ws-a-idempotency');

    // 1. First delivery
    await callController.handleEvent(eventA);

    const callA = await prisma.call.findUnique({
      where: { provider_call_id: eventA.callId },
    });
    expect(callA).toBeDefined();

    // 2. Duplicate delivery of CALL_INITIATED is safely ignored
    await callController.handleEvent(eventA);
    const countAfterDup = await prisma.call.count({
      where: { provider_call_id: eventA.callId },
    });
    expect(countAfterDup).toBe(1);

    // 3. Out-of-order test: deliver CALL_HANGUP before CALL_ANSWERED
    await callController.handleEvent({
      type: CallEventType.CALL_HANGUP,
      callId: eventA.callId,
      timestamp: new Date().toISOString(),
    });

    const callAfterHangup = await prisma.call.findUnique({
      where: { id: callA!.id },
    });
    expect([CallState.CANCELED, CallState.COMPLETED, CallState.FAILED]).toContain(callAfterHangup!.state);

    // 4. Delayed / stale CALL_ANSWERED arriving AFTER hangup does NOT revive routing or create phantom attempts
    const attemptsBeforeLateAnswer = await prisma.callAttempt.count({
      where: { call_id: callA!.id },
    });

    await callController.handleEvent({
      type: CallEventType.CALL_ANSWERED,
      callId: eventA.callId,
      direction: 'incoming',
      timestamp: new Date().toISOString(),
    });

    const attemptsAfterLateAnswer = await prisma.callAttempt.count({
      where: { call_id: callA!.id },
    });
    expect(attemptsAfterLateAnswer).toBe(attemptsBeforeLateAnswer);
  });

  // =========================================================================
  // SCENARIO 8: FAILURE OR RECOVERY IN ONE WORKSPACE DOES NOT CORRUPT ANOTHER
  // =========================================================================
  it('Scenario 8: Failure or recovery in Workspace A does not corrupt Workspace B', async () => {
    // 1. Exhaust Workspace A balance to 0
    await prisma.workspaceBalance.update({
      where: { workspace_id: WS_A_ID },
      data: { balance_micro: 0n, reserved_micro: 0n },
    });

    // 2. Inbound call to Workspace A fails closed due to insufficient funds
    const failEventA = createCallEvent(TRACKING_DID_A, '+12025558001', 'ws-a-exhausted');
    await callController.handleEvent(failEventA);

    const failedCallA = await prisma.call.findUnique({
      where: { provider_call_id: failEventA.callId },
    });
    expect(failedCallA?.state).toBe(CallState.FAILED);

    // 3. Inbound call to Workspace B succeeds completely unaffected
    const successEventB = createCallEvent(TRACKING_DID_B, '+12025558002', 'ws-b-healthy');
    await callController.handleEvent(successEventB);

    const healthyCallB = await prisma.call.findUnique({
      where: { provider_call_id: successEventB.callId },
    });
    expect(healthyCallB?.state).toBe(CallState.INITIATED);

    const resB = await prisma.callReservation.findUnique({
      where: { call_id: healthyCallB!.id },
    });
    expect(resB?.status).toBe(ReservationStatus.ACTIVE);

    // 4. Stale reservation recovery test: simulate stale reservation on Workspace A
    const staleRes = await prisma.callReservation.create({
      data: {
        workspace_id: WS_A_ID,
        call_id: failedCallA!.id,
        status: ReservationStatus.ACTIVE,
        original_reserved_micro: 5_000_000n,
        total_reserved_micro: 5_000_000n,
        updated_at: new Date(Date.now() - 20 * 60 * 1000), // 20 mins ago (stale)
      },
    });

    // Run recovery loop
    await recoveryService.runRecoveryBatch();

    // Verify Workspace B reservation remains ACTIVE and uncorrupted
    const resBAfterRecovery = await prisma.callReservation.findUnique({
      where: { call_id: healthyCallB!.id },
    });
    expect(resBAfterRecovery?.status).toBe(ReservationStatus.ACTIVE);
  });
});
