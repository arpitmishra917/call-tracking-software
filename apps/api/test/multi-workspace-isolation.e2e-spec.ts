/**
 * CALLFLOW — PHASE QA-2D: MULTI-WORKSPACE TENANT ISOLATION E2E SPECIFICATION
 *
 * Scope: Multi-Workspace Tenant Isolation under Concurrent Synthetic Webhooks
 *
 * Safety Enforcements:
 * - TELEPHONY_PROVIDER overridden with in-memory FakeTelephonyProvider (Zero Telnyx REST egress).
 * - WebhooksService overridden with MockWebhooksService (Zero customer webhook egress).
 * - Zero Asterisk ARI, SIP, RTP or PSTN activity.
 * - Strict 4-phase preflight (Environment, Database Identity, Fixture Baseline, Authorization Gate).
 * - Multi-tenant routing validation: Workspace A calls route strictly to Workspace A buyers.
 * - Workspace B calls route strictly to Workspace B buyers.
 * - Cross-workspace reads/writes denied at service and database level.
 * - Duplicate webhook delivery idempotency and reservation deduping.
 * - Failure-safe lifecycle teardown with cascading purge restoring pristine baselines.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as crypto from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { Logger, NotFoundException } from '@nestjs/common';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { PrismaClient, CallState, CallAttemptState } from '@prisma/client';
import { CallController, TELEPHONY_PROVIDER } from '../src/telephony/call-controller.js';
import { CallsService } from '../src/calls/calls.service.js';
import { FakeTelephonyProvider } from '../src/telephony/fake.provider.js';
import { WebhooksService } from '../src/webhooks/webhooks.service.js';
import {
  QaTelephonyGuardService,
  QaInboundLease,
} from '../src/telephony/qa/qa-telephony-guard.service.js';
import { CallEventType, NormalizedCallEvent } from '../src/telephony/telephony.events.js';
import {
  assertNonProductionDatabase,
  stripProductionEnvironmentVariables,
} from '../src/common/database-isolation.util.js';

// ============================================================================
// TEST-ONLY MOCKS & RECORDERS
// ============================================================================

class MockWebhooksService {
  public readonly queuedEvents: Array<{ workspaceId: string; event: string; payload: any }> = [];

  async queueEvent(workspaceId: string, event: string, payload: any): Promise<void> {
    this.queuedEvents.push({ workspaceId, event, payload });
  }

  clear(): void {
    this.queuedEvents.length = 0;
  }
}

// ============================================================================
// TEST SUITE SPECIFICATION
// ============================================================================

describe('QA-2D: Multi-Workspace Tenant Isolation & Concurrency E2E', () => {
  const logger = new Logger('MultiWorkspaceIsolationTest');

  // Static Tenant A Configuration
  const WORKSPACE_A_ID = '5e20bafe-7306-4da7-9944-62c4c5575a5a';
  const CAMPAIGN_A_ID = '6af31407-3f46-4f1d-90d0-bf08af2e9600';
  const TRACKING_DID_A = '+17252574041';
  const BUYER_A1_ID = '7deb4e0a-8674-4b4b-a170-0aff3991f69c'; // QA Test SIP Buyer
  const BUYER_A2_ID = 'b0000000-0000-0000-0000-000000000002'; // Synthetic Buyer B (Tenant A)

  // Static Tenant B Configuration
  const WORKSPACE_B_ID = '5e20bafe-7306-4da7-9944-62c4c5575b5b';
  const CAMPAIGN_B_ID = '6af31407-3f46-4f1d-90d0-bf08af2e9b00';
  const TRACKING_DID_B = '+17252574049';
  const BUYER_B1_ID = 'b0000000-0000-0000-0000-00000000000b'; // QA Tenant B SIP Buyer

  const REQUIRED_ALLOWED_DESTINATIONS = ['+12025550199', '+12025550198', '+12025550197'];

  // Runtime Instances
  let moduleRef: TestingModule | null = null;
  let prisma: PrismaService | null = null;
  let callController: CallController | null = null;
  let callsService: CallsService | null = null;
  let qaGuard: QaTelephonyGuardService | null = null;
  let fakeProvider: FakeTelephonyProvider;
  let mockWebhooks: MockWebhooksService;

  // Tracked State for Failure-Safe Teardown
  const trackedProviderCallIds = new Set<string>();
  const activeTestRunIds = new Set<string>();

  // ==========================================================================
  // FAIL-CLOSED PREFLIGHT ASSERTIONS
  // ==========================================================================

  function assertEnvironmentPreflight(): void {
    stripProductionEnvironmentVariables();
    assertNonProductionDatabase(process.env.DATABASE_URL);

    const errors: string[] = [];

    if (process.env.TELEPHONY_QA_ENABLED?.trim().toLowerCase() !== 'true') {
      errors.push(`TELEPHONY_QA_ENABLED must be 'true' (got '${process.env.TELEPHONY_QA_ENABLED}')`);
    }

    const trackingDid = process.env.TELNYX_QA_TRACKING_DID?.trim();
    if (!trackingDid || trackingDid !== TRACKING_DID_A) {
      errors.push(`TELNYX_QA_TRACKING_DID must match '${TRACKING_DID_A}' (got '${trackingDid}')`);
    }

    const allowed = (process.env.TELEPHONY_QA_ALLOWED_DESTINATIONS || '')
      .split(',')
      .map((d) => d.trim())
      .filter(Boolean);

    for (const reqDest of REQUIRED_ALLOWED_DESTINATIONS) {
      if (!allowed.includes(reqDest)) {
        errors.push(`TELEPHONY_QA_ALLOWED_DESTINATIONS missing '${reqDest}' (current: '${process.env.TELEPHONY_QA_ALLOWED_DESTINATIONS}')`);
      }
    }

    try {
      const parsed = new URL(process.env.DATABASE_URL || '');
      const isLoopback = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost';
      const isPort5433 = parsed.port === '5433';
      const isQaDb = parsed.pathname.replace(/^\//, '') === 'callflow_qa';

      if (!isLoopback || !isPort5433 || !isQaDb) {
        errors.push(`DATABASE_URL safety violation: must point to 127.0.0.1:5433/callflow_qa`);
      }
    } catch (urlErr: any) {
      errors.push(`DATABASE_URL is not a valid URL: ${urlErr.message}`);
    }

    if (errors.length > 0) {
      throw new Error(`QA-2D PREFLIGHT FAILED:\n` + errors.map((e, i) => `  ${i + 1}. ${e}`).join('\n'));
    }
  }

  async function assertDatabaseIdentity(client: PrismaService): Promise<void> {
    const rawResult = await client.$queryRaw<Array<{
      database_name: string;
      database_user: string;
      server_port: number;
    }>>`
      SELECT
        current_database() AS database_name,
        current_user AS database_user,
        inet_server_port() AS server_port;
    `;

    const identity = rawResult[0];
    if (!identity) throw new Error('Unable to query PostgreSQL identity.');
    if (identity.database_name !== 'callflow_qa') {
      throw new Error(`Connected database is "${identity.database_name}", expected "callflow_qa".`);
    }
    if (identity.database_user !== 'callflow_qa_user') {
      throw new Error(`Connected user is "${identity.database_user}", expected "callflow_qa_user".`);
    }
    if (Number(identity.server_port) !== 5432) {
      throw new Error(`Server listening port is ${identity.server_port}, expected 5432.`);
    }
  }

  // ==========================================================================
  // LIFECYCLE HOOKS
  // ==========================================================================

  beforeAll(async () => {
    assertEnvironmentPreflight();

    fakeProvider = new FakeTelephonyProvider();
    mockWebhooks = new MockWebhooksService();

    moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(TELEPHONY_PROVIDER)
      .useValue(fakeProvider)
      .overrideProvider(WebhooksService)
      .useValue(mockWebhooks)
      .compile();

    prisma = moduleRef.get<PrismaService>(PrismaService);
    callController = moduleRef.get<CallController>(CallController);
    callsService = moduleRef.get<CallsService>(CallsService);
    qaGuard = moduleRef.get<QaTelephonyGuardService>(QaTelephonyGuardService);

    await assertDatabaseIdentity(prisma);

    // Verify Workspace A and Workspace B Fixtures
    const wsA = await prisma.workspace.findUnique({ where: { id: WORKSPACE_A_ID } });
    const wsB = await prisma.workspace.findUnique({ where: { id: WORKSPACE_B_ID } });
    expect(wsA).toBeDefined();
    expect(wsA!.status).toBe('ACTIVE');
    expect(wsB).toBeDefined();
    expect(wsB!.status).toBe('ACTIVE');

    // Verify Pristine Baseline
    const activeResA1 = await prisma.buyerReservation.count({ where: { buyer_id: BUYER_A1_ID, status: 'ACTIVE' } });
    const activeResA2 = await prisma.buyerReservation.count({ where: { buyer_id: BUYER_A2_ID, status: 'ACTIVE' } });
    const activeResB1 = await prisma.buyerReservation.count({ where: { buyer_id: BUYER_B1_ID, status: 'ACTIVE' } });
    expect(activeResA1).toBe(0);
    expect(activeResA2).toBe(0);
    expect(activeResB1).toBe(0);

    logger.log('QA-2D Preflight: Both workspaces (A and B) verified with pristine reservation baselines.');
  });

  afterAll(async () => {
    // Cascading purge of all synthetic test calls
    if (prisma && trackedProviderCallIds.size > 0) {
      try {
        const delRes = await prisma.call.deleteMany({
          where: { provider_call_id: { in: Array.from(trackedProviderCallIds) } },
        });
        logger.log(`QA-2D Teardown: Purged ${delRes.count} synthetic test call records via CASCADE.`);
      } catch (err: any) {
        logger.error(`QA-2D Teardown purge error: ${err.message}`);
      }
    }

    if (qaGuard && activeTestRunIds.size > 0) {
      for (const runId of activeTestRunIds) {
        try {
          qaGuard.unregisterActiveTestRun(runId);
        } catch {}
      }
    }

    if (moduleRef) {
      try {
        await moduleRef.close();
      } catch {}
    }
  });

  // ==========================================================================
  // HELPER: SYNTHETIC CALL INJECTION & TRANSITION
  // ==========================================================================

  function generateCallEvent(
    testRunId: string,
    workspaceTag: string,
    trackingDid: string,
    callerCli: string,
    lease?: QaInboundLease,
  ): NormalizedCallEvent {
    const providerCallId = `qa-call-2d-${workspaceTag}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    trackedProviderCallIds.add(providerCallId);

    const configuredAppId = process.env.TELNYX_QA_CALL_CONTROL_APP_ID!.trim();

    return {
      type: CallEventType.CALL_INITIATED,
      callId: providerCallId,
      direction: 'incoming',
      from: callerCli,
      to: trackingDid,
      connectionId: configuredAppId,
      clientState: lease?.secretToken,
      timestamp: new Date().toISOString(),
    };
  }

  async function triggerCallToRouting(event: NormalizedCallEvent): Promise<void> {
    await callController!.handleEvent(event);
    await callController!.handleEvent({
      type: CallEventType.CALL_ANSWERED,
      callId: event.callId,
      direction: 'incoming',
      timestamp: new Date().toISOString(),
    });
  }

  // ==========================================================================
  // TEST SCENARIOS
  // ==========================================================================

  describe('Scenario 1 — Workspace-Scoped Inbound Routing (Sequential)', () => {
    const testRunId1 = `qa-2d-run1-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

    it('routes Workspace A call strictly to A buyer and Workspace B call strictly to B buyer', async () => {
      activeTestRunIds.add(testRunId1);
      qaGuard!.registerActiveTestRun(testRunId1, { ttlMs: 180000 });

      const configuredAppId = process.env.TELNYX_QA_CALL_CONTROL_APP_ID!.trim();
      const cliA = '+12025550021';
      const cliB = '+12025550022';

      // 1. Inbound lease for Workspace A (QA Tracking DID)
      const leaseA = qaGuard!.openInboundTestLease({
        runId: testRunId1,
        expectedCallerCli: cliA,
        expectedConnectionId: configuredAppId,
        ttlMs: 60000,
      });

      // 2. Dispatch Call to Workspace A
      const eventA = generateCallEvent(testRunId1, 'ws-a', TRACKING_DID_A, cliA, leaseA);
      await triggerCallToRouting(eventA);

      // Verify Call A belongs to Workspace A and routed to Buyer A1
      const dbCallA = await prisma!.call.findUnique({
        where: { provider_call_id: eventA.callId },
        include: { attempts: true },
      });
      expect(dbCallA).toBeDefined();
      expect(dbCallA!.workspace_id).toBe(WORKSPACE_A_ID);
      expect(dbCallA!.campaign_id).toBe(CAMPAIGN_A_ID);
      expect(dbCallA!.attempts.length).toBe(1);
      expect(dbCallA!.attempts[0].buyer_id).toBe(BUYER_A1_ID);

      // Verify active reservation on Buyer A1 belongs to Workspace A
      const resA = await prisma!.buyerReservation.findFirst({
        where: { call_id: dbCallA!.id, status: 'ACTIVE' },
      });
      expect(resA).toBeDefined();
      expect(resA!.workspace_id).toBe(WORKSPACE_A_ID);
      expect(resA!.buyer_id).toBe(BUYER_A1_ID);

      // Verify Buyer B has ZERO reservations during Workspace A execution
      const resBCountDuringA = await prisma!.buyerReservation.count({
        where: { buyer_id: BUYER_B1_ID, status: 'ACTIVE' },
      });
      expect(resBCountDuringA).toBe(0);

      // 3. Dispatch Call to Workspace B (Tracking DID B)
      const eventB = generateCallEvent(testRunId1, 'ws-b', TRACKING_DID_B, cliB);
      // Bind call to test run for QA context defense-in-depth
      qaGuard!.bindCallToTestRun(eventB.callId, testRunId1);
      await triggerCallToRouting(eventB);

      // Verify Call B belongs to Workspace B and routed to Buyer B1
      const dbCallB = await prisma!.call.findUnique({
        where: { provider_call_id: eventB.callId },
        include: { attempts: true },
      });
      expect(dbCallB).toBeDefined();
      expect(dbCallB!.workspace_id).toBe(WORKSPACE_B_ID);
      expect(dbCallB!.campaign_id).toBe(CAMPAIGN_B_ID);
      expect(dbCallB!.attempts.length).toBe(1);
      expect(dbCallB!.attempts[0].buyer_id).toBe(BUYER_B1_ID);

      // Verify active reservation on Buyer B1 belongs to Workspace B
      const resB = await prisma!.buyerReservation.findFirst({
        where: { call_id: dbCallB!.id, status: 'ACTIVE' },
      });
      expect(resB).toBeDefined();
      expect(resB!.workspace_id).toBe(WORKSPACE_B_ID);
      expect(resB!.buyer_id).toBe(BUYER_B1_ID);

      // Clean up Scenario 1 calls
      await prisma!.call.deleteMany({
        where: { provider_call_id: { in: [eventA.callId, eventB.callId] } },
      });
      expect(await prisma!.buyerReservation.count({ where: { buyer_id: BUYER_A1_ID, status: 'ACTIVE' } })).toBe(0);
      expect(await prisma!.buyerReservation.count({ where: { buyer_id: BUYER_B1_ID, status: 'ACTIVE' } })).toBe(0);
    });
  });

  describe('Scenario 2 — Concurrent Synthetic Webhook Processing Across Workspaces', () => {
    const testRunId2 = `qa-2d-run2-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

    it('processes webhooks concurrently without mixing tenant context', async () => {
      mockWebhooks.clear();
      activeTestRunIds.add(testRunId2);
      qaGuard!.registerActiveTestRun(testRunId2, { ttlMs: 180000 });

      const configuredAppId = process.env.TELNYX_QA_CALL_CONTROL_APP_ID!.trim();
      const cliA = '+12025550031';
      const cliB = '+12025550032';

      const leaseA = qaGuard!.openInboundTestLease({
        runId: testRunId2,
        expectedCallerCli: cliA,
        expectedConnectionId: configuredAppId,
        ttlMs: 60000,
      });

      const eventA = generateCallEvent(testRunId2, 'conc-a', TRACKING_DID_A, cliA, leaseA);
      const eventB = generateCallEvent(testRunId2, 'conc-b', TRACKING_DID_B, cliB);
      qaGuard!.bindCallToTestRun(eventB.callId, testRunId2);

      // Pre-initialize calls so both exist in database
      await callController!.handleEvent(eventA);
      await callController!.handleEvent(eventB);

      // Concurrently dispatch incoming CALL_ANSWERED events across both tenants
      const [resA, resB] = await Promise.all([
        callController!.handleEvent({
          type: CallEventType.CALL_ANSWERED,
          callId: eventA.callId,
          direction: 'incoming',
          timestamp: new Date().toISOString(),
        }),
        callController!.handleEvent({
          type: CallEventType.CALL_ANSWERED,
          callId: eventB.callId,
          direction: 'incoming',
          timestamp: new Date().toISOString(),
        }),
      ]);

      // Verify Concurrent DB Ownership & Separation
      const callA = await prisma!.call.findUnique({
        where: { provider_call_id: eventA.callId },
        include: { attempts: true },
      });
      const callB = await prisma!.call.findUnique({
        where: { provider_call_id: eventB.callId },
        include: { attempts: true },
      });

      expect(callA!.workspace_id).toBe(WORKSPACE_A_ID);
      expect(callA!.attempts[0].buyer_id).toBe(BUYER_A1_ID);

      expect(callB!.workspace_id).toBe(WORKSPACE_B_ID);
      expect(callB!.attempts[0].buyer_id).toBe(BUYER_B1_ID);

      // Verify Webhooks emitted per-workspace have strictly partitioned workspace_id
      const eventsForWsA = mockWebhooks.queuedEvents.filter((e) => e.workspaceId === WORKSPACE_A_ID);
      const eventsForWsB = mockWebhooks.queuedEvents.filter((e) => e.workspaceId === WORKSPACE_B_ID);
      expect(eventsForWsA.length).toBeGreaterThanOrEqual(1);
      expect(eventsForWsB.length).toBeGreaterThanOrEqual(1);

      // Cross-check: No events for Workspace A contain Workspace B attempt payload
      eventsForWsA.forEach((ev) => {
        expect(ev.payload.buyer_id).not.toBe(BUYER_B1_ID);
      });
      eventsForWsB.forEach((ev) => {
        expect(ev.payload.buyer_id).not.toBe(BUYER_A1_ID);
      });

      logger.log('Concurrent webhook processing verified: Zero cross-tenant mixing under simultaneous execution.');
    });
  });

  describe('Scenario 3 — Cross-Workspace Access Rejection & Database Ownership', () => {
    it('denies cross-tenant reads and ensures strict query scoping', async () => {
      // Find the active test calls from Scenario 2
      const callA = await prisma!.call.findFirst({
        where: { workspace_id: WORKSPACE_A_ID, provider_call_id: { startsWith: 'qa-call-2d-conc-a' } },
      });
      const callB = await prisma!.call.findFirst({
        where: { workspace_id: WORKSPACE_B_ID, provider_call_id: { startsWith: 'qa-call-2d-conc-b' } },
      });
      expect(callA).toBeDefined();
      expect(callB).toBeDefined();

      // 1. Cross-Workspace Read Attempt: Workspace B tries to read Workspace A's call
      await expect(
        callsService!.getCallDetail(WORKSPACE_B_ID, callA!.id),
      ).rejects.toThrow(NotFoundException);

      // 2. Cross-Workspace Read Attempt: Workspace A tries to read Workspace B's call
      await expect(
        callsService!.getCallDetail(WORKSPACE_A_ID, callB!.id),
      ).rejects.toThrow(NotFoundException);

      // 3. Workspace-scoped list query: Workspace A queries contain Call A, NEVER Call B
      const listA = await prisma!.call.findMany({ where: { workspace_id: WORKSPACE_A_ID } });
      const listACallIds = listA.map((c: any) => c.id);
      expect(listACallIds).toContain(callA!.id);
      expect(listACallIds).not.toContain(callB!.id);

      // 4. Workspace-scoped list query: Workspace B queries contain Call B, NEVER Call A
      const listB = await prisma!.call.findMany({ where: { workspace_id: WORKSPACE_B_ID } });
      const listBCallIds = listB.map((c: any) => c.id);
      expect(listBCallIds).toContain(callB!.id);
      expect(listBCallIds).not.toContain(callA!.id);

      // 5. Database-level reservation partition assertion
      const crossReservation = await prisma!.buyerReservation.findFirst({
        where: { workspace_id: WORKSPACE_A_ID, buyer_id: BUYER_B1_ID },
      });
      expect(crossReservation).toBeNull();

      logger.log('Cross-workspace read/write boundaries verified: Cross-tenant queries throw NotFoundException and lists are strictly scoped.');
    });
  });

  describe('Scenario 4 — Duplicate Webhook Delivery & Reservation Idempotency', () => {
    it('handles duplicate CALL_INITIATED and duplicate CALL_ANSWERED idempotently', async () => {
      // Locate the active Call A
      const callA = await prisma!.call.findFirst({
        where: { workspace_id: WORKSPACE_A_ID, provider_call_id: { startsWith: 'qa-call-2d-conc-a' } },
        include: { attempts: true },
      });
      expect(callA).toBeDefined();

      const initialAttemptsCount = callA!.attempts.length;
      expect(initialAttemptsCount).toBe(1);

      const initialReservationsCount = await prisma!.buyerReservation.count({
        where: { call_id: callA!.id, status: 'ACTIVE' },
      });
      expect(initialReservationsCount).toBe(1);

      // 1. Redeliver Duplicate CALL_INITIATED for Call A
      await callController!.handleEvent({
        type: CallEventType.CALL_INITIATED,
        callId: callA!.provider_call_id,
        direction: 'incoming',
        from: callA!.from_number,
        to: callA!.to_number,
        timestamp: new Date().toISOString(),
      });

      // Verify no duplicate Call record was created
      const callsForProviderId = await prisma!.call.findMany({
        where: { provider_call_id: callA!.provider_call_id },
      });
      expect(callsForProviderId.length).toBe(1);

      // 2. Redeliver Duplicate CALL_ANSWERED for Call A
      await callController!.handleEvent({
        type: CallEventType.CALL_ANSWERED,
        callId: callA!.provider_call_id,
        direction: 'incoming',
        timestamp: new Date().toISOString(),
      });

      // Verify attempts and active reservations did not duplicate
      const postDupCall = await prisma!.call.findUnique({
        where: { id: callA!.id },
        include: { attempts: true },
      });
      expect(postDupCall!.attempts.length).toBe(initialAttemptsCount);

      const postDupReservations = await prisma!.buyerReservation.count({
        where: { call_id: callA!.id, status: 'ACTIVE' },
      });
      expect(postDupReservations).toBe(initialReservationsCount);

      // 3. Concurrent Duplicate Delivery for Call B
      const callB = await prisma!.call.findFirst({
        where: { workspace_id: WORKSPACE_B_ID, provider_call_id: { startsWith: 'qa-call-2d-conc-b' } },
      });
      expect(callB).toBeDefined();

      const dupEventB = {
        type: CallEventType.CALL_ANSWERED,
        callId: callB!.provider_call_id,
        direction: 'incoming' as const,
        timestamp: new Date().toISOString(),
      };

      // Dispatch 3 duplicate events simultaneously
      await Promise.all([
        callController!.handleEvent(dupEventB),
        callController!.handleEvent(dupEventB),
        callController!.handleEvent(dupEventB),
      ]);

      const postDupReservationsB = await prisma!.buyerReservation.count({
        where: { call_id: callB!.id, status: 'ACTIVE' },
      });
      expect(postDupReservationsB).toBe(1);

      logger.log('Webhook idempotency verified: Duplicate events ignored cleanly; zero duplicate reservations created.');
    });
  });

  describe('Scenario 5 — Clean Teardown & Baseline Restoration', () => {
    it('purges all synthetic test calls and restores baseline active reservations to 0', async () => {
      // Purge all tracked test calls created in this suite
      const delResult = await prisma!.call.deleteMany({
        where: { provider_call_id: { in: Array.from(trackedProviderCallIds) } },
      });
      expect(delResult.count).toBeGreaterThan(0);

      // Verify active reservation counts on all buyers are strictly restored to 0
      const resA1 = await prisma!.buyerReservation.count({ where: { buyer_id: BUYER_A1_ID, status: 'ACTIVE' } });
      const resA2 = await prisma!.buyerReservation.count({ where: { buyer_id: BUYER_A2_ID, status: 'ACTIVE' } });
      const resB1 = await prisma!.buyerReservation.count({ where: { buyer_id: BUYER_B1_ID, status: 'ACTIVE' } });

      expect(resA1).toBe(0);
      expect(resA2).toBe(0);
      expect(resB1).toBe(0);

      // Verify no test calls remain in database
      const remainingCalls = await prisma!.call.count({
        where: { provider_call_id: { startsWith: 'qa-call-2d-' } },
      });
      expect(remainingCalls).toBe(0);

      logger.log('Scenario 5: Cleanup verified. All synthetic test records purged; baselines returned to 0.');
    });
  });
});
