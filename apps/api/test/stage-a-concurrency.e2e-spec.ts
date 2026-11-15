/**
 * CALLFLOW — PHASE QA-2B STAGE A: SYNTHETIC CONCURRENCY & WATERFALL E2E SPECIFICATION
 *
 * Mode: TEST HARNESS IMPLEMENTATION (READ-ONLY PREFLIGHT UNTIL AUTHORIZED)
 * Scope: Synthetic Backend Concurrency, Sequential Waterfall & Row-Lock Serialization
 *
 * Safety Enforcements:
 * - TELEPHONY_PROVIDER overridden with in-memory FakeTelephonyProvider (Zero Telnyx REST API egress).
 * - WebhooksService overridden with MockWebhooksService (Zero customer webhook HTTP egress).
 * - Zero Asterisk ARI or SIP/RTP media socket activity.
 * - Strict 4-phase preflight (Environment, Dual Database Identity, Fixture & Baseline Verification, Authorization Gate).
 * - Explicit execution opt-in gate: CALLFLOW_QA2B_STAGE_A_EXECUTE=true required.
 * - Failure-safe lifecycle teardown with helper lock release, promise settlement, and ON DELETE CASCADE purge.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as crypto from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { PrismaClient, CallState, CallAttemptState } from '@prisma/client';
import { CallController, TELEPHONY_PROVIDER } from '../src/telephony/call-controller.js';
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
// TEST-ONLY MOCKS & HELPERS
// ============================================================================

/**
 * In-memory MockWebhooksService ensuring zero outbound HTTP egress to customer webhooks.
 */
class MockWebhooksService {
  public readonly queuedEvents: Array<{ workspaceId: string; event: string; payload: any }> = [];

  async queueEvent(workspaceId: string, event: string, payload: any): Promise<void> {
    this.queuedEvents.push({ workspaceId, event, payload });
  }

  clear(): void {
    this.queuedEvents.length = 0;
  }
}

/**
 * Deferred promise helper for deterministic transaction hold/release synchronization.
 */
interface Deferred<T = void> {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: any) => void;
}

function createDeferred<T = void>(): Deferred<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: any) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// ============================================================================
// TEST SUITE SPECIFICATION
// ============================================================================

describe('QA-2B Stage A: Synthetic Backend Concurrency & Waterfall E2E', () => {
  const logger = new Logger('StageAConcurrencyTest');

  // Static QA Configuration & Fixture IDs
  const EXPECTED_QA_WORKSPACE_ID = '5e20bafe-7306-4da7-9944-62c4c5575a5a';
  const EXPECTED_QA_CAMPAIGN_ID = '6af31407-3f46-4f1d-90d0-bf08af2e9600';
  const EXPECTED_QA_TRACKING_DID = '+17252574041';
  const BUYER_A_ID = '7deb4e0a-8674-4b4b-a170-0aff3991f69c';
  const BUYER_B_ID = 'b0000000-0000-0000-0000-000000000002';
  const REQUIRED_ALLOWED_DESTINATIONS = ['+12025550199', '+12025550198'];

  // Runtime Instances
  let moduleRef: TestingModule | null = null;
  let prisma: PrismaService | null = null;
  let helperPrisma: PrismaClient | null = null;
  let callController: CallController | null = null;
  let qaGuard: QaTelephonyGuardService | null = null;
  let fakeProvider: FakeTelephonyProvider;
  let mockWebhooks: MockWebhooksService;

  // Tracked State for Failure-Safe Teardown
  const trackedProviderCallIds = new Set<string>();
  const activeTestRunIds = new Set<string>();
  const pendingWorkerPromises: Promise<any>[] = [];
  let activeHelperReleaseFn: (() => void) | null = null;
  let activeHelperTxPromise: Promise<any> | null = null;

  // ==========================================================================
  // 4-PHASE FAIL-CLOSED PREFLIGHT ASSERTIONS
  // ==========================================================================

  /**
   * Phase A: Environment-Only Preflight (Zero Database Connections)
   * Executes entirely in-memory against process.env before any network connection.
   */
  function assertPhaseAEnvironmentPreflight(): void {
    // 0. Explicit Execution Opt-In Gate: runs before any DB connection or module setup
    if (process.env.CALLFLOW_QA2B_STAGE_A_EXECUTE?.trim().toLowerCase() !== 'true') {
      throw new Error(
        `\n====================================================================\n` +
        `STAGE A EXECUTION GATE REFUSAL (Zero DB Connections / Zero Mutations):\n` +
        `Environment variable "CALLFLOW_QA2B_STAGE_A_EXECUTE=true" is required to execute Stage A.\n` +
        `Note: This variable requires explicit separate user authorization.\n` +
        `====================================================================\n`,
      );
    }

    stripProductionEnvironmentVariables();
    assertNonProductionDatabase(process.env.DATABASE_URL);

    const errors: string[] = [];

    // 1. TELEPHONY_QA_ENABLED === 'true'
    if (process.env.TELEPHONY_QA_ENABLED?.trim().toLowerCase() !== 'true') {
      errors.push(`TELEPHONY_QA_ENABLED must be exactly 'true' (got '${process.env.TELEPHONY_QA_ENABLED}')`);
    }

    // 2. TELNYX_QA_TRACKING_DID matches expected QA DID
    const trackingDid = process.env.TELNYX_QA_TRACKING_DID?.trim();
    if (!trackingDid) {
      errors.push('TELNYX_QA_TRACKING_DID is unset or empty');
    } else if (trackingDid !== EXPECTED_QA_TRACKING_DID) {
      errors.push(`TELNYX_QA_TRACKING_DID '${trackingDid}' does not match expected '${EXPECTED_QA_TRACKING_DID}'`);
    }

    // 3. TELNYX_QA_CALL_CONTROL_APP_ID is present
    const callControlAppId = process.env.TELNYX_QA_CALL_CONTROL_APP_ID?.trim();
    if (!callControlAppId) {
      errors.push('TELNYX_QA_CALL_CONTROL_APP_ID is unset or empty');
    }

    // 4. TELEPHONY_QA_ALLOWED_DESTINATIONS contains Buyer A and Buyer B
    const allowed = (process.env.TELEPHONY_QA_ALLOWED_DESTINATIONS || '')
      .split(',')
      .map((d) => d.trim())
      .filter(Boolean);

    for (const reqDest of REQUIRED_ALLOWED_DESTINATIONS) {
      if (!allowed.includes(reqDest)) {
        errors.push(`TELEPHONY_QA_ALLOWED_DESTINATIONS missing required destination '${reqDest}' (current: '${process.env.TELEPHONY_QA_ALLOWED_DESTINATIONS}')`);
      }
    }

    // 5. DATABASE_URL format points to 127.0.0.1:5433/callflow_qa
    try {
      const parsed = new URL(process.env.DATABASE_URL || '');
      const isLoopback = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost';
      const isPort5433 = parsed.port === '5433';
      const isQaDb = parsed.pathname.replace(/^\//, '') === 'callflow_qa';

      if (!isLoopback || !isPort5433 || !isQaDb) {
        errors.push(`DATABASE_URL safety violation: must point to 127.0.0.1:5433/callflow_qa (got ${parsed.hostname}:${parsed.port}/${parsed.pathname})`);
      }
    } catch (urlErr: any) {
      errors.push(`DATABASE_URL is not a valid URL: ${urlErr.message}`);
    }

    // 6. QA_WORKSPACE_ID matches expected QA workspace
    const qaWorkspaceId = process.env.QA_WORKSPACE_ID?.trim();
    if (!qaWorkspaceId || qaWorkspaceId !== EXPECTED_QA_WORKSPACE_ID) {
      errors.push(`QA_WORKSPACE_ID must match '${EXPECTED_QA_WORKSPACE_ID}' (got '${qaWorkspaceId}')`);
    }

    // 7. TELEPHONY_QA_BUYER_SIP_URI is present
    const buyerSip = process.env.TELEPHONY_QA_BUYER_SIP_URI?.trim();
    if (!buyerSip) {
      errors.push('TELEPHONY_QA_BUYER_SIP_URI is unset or empty');
    }

    if (errors.length > 0) {
      throw new Error(
        `\n====================================================================\n` +
        `PHASE A ENVIRONMENT PREFLIGHT FAILED (Zero DB Connections Initiated):\n` +
        errors.map((e, idx) => `  ${idx + 1}. ${e}`).join('\n') +
        `\n====================================================================\n`,
      );
    }
  }

  /**
   * Phase B: Post-Connection Database Identity Verification
   * Accounts for Docker port forwarding: Host port 5433 -> Container internal port 5432.
   * Executed against BOTH PrismaService (app pool) and helperPrisma (contention client).
   */
  async function assertPhaseBDatabaseIdentity(
    client: PrismaClient | PrismaService,
    connectionLabel: string,
  ): Promise<void> {
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
    if (!identity) {
      throw new Error(`PHASE B FAILED [${connectionLabel}]: Unable to query PostgreSQL server session identity.`);
    }

    const errors: string[] = [];

    // 1. Database name check
    if (identity.database_name !== 'callflow_qa') {
      errors.push(`[${connectionLabel}] Connected database is "${identity.database_name}", expected strictly "callflow_qa".`);
    }

    // 2. Database user check
    if (identity.database_user !== 'callflow_qa_user') {
      errors.push(`[${connectionLabel}] Connected user is "${identity.database_user}", expected strictly "callflow_qa_user".`);
    }

    // 3. Container internal listening port check
    // In Docker bridge networking (-p 127.0.0.1:5433:5432), PostgreSQL inside container listens on 5432.
    if (Number(identity.server_port) !== 5432) {
      errors.push(`[${connectionLabel}] PostgreSQL server listening port is ${identity.server_port}, expected internal container port 5432.`);
    }

    if (errors.length > 0) {
      throw new Error(
        `\n====================================================================\n` +
        `PHASE B DATABASE IDENTITY VERIFICATION FAILED [${connectionLabel}]:\n` +
        errors.map((e, idx) => `  ${idx + 1}. ${e}`).join('\n') +
        `\n====================================================================\n`,
      );
    }
  }

  /**
   * Phase C: Read-Only Fixture & Baseline Verification
   * Validates required static tenant fixtures, Buyer A, Buyer B, and clean reservation baseline.
   */
  async function assertPhaseCFixtures(client: PrismaClient | PrismaService): Promise<void> {
    const errors: string[] = [];

    // 1. Workspace
    const workspace = await client.workspace.findUnique({ where: { id: EXPECTED_QA_WORKSPACE_ID } });
    if (!workspace) {
      errors.push(`QA Workspace "${EXPECTED_QA_WORKSPACE_ID}" not found in database.`);
    }

    // 2. Campaign
    const campaign = await client.campaign.findUnique({
      where: { id: EXPECTED_QA_CAMPAIGN_ID },
      include: {
        buyers: {
          include: { buyer: true },
          orderBy: { priority: 'asc' },
        },
      },
    });

    if (!campaign) {
      errors.push(`QA Campaign "${EXPECTED_QA_CAMPAIGN_ID}" not found in database.`);
    } else {
      if (campaign.status !== 'ACTIVE') {
        errors.push(`QA Campaign "${EXPECTED_QA_CAMPAIGN_ID}" status is "${campaign.status}", expected "ACTIVE".`);
      }

      // 3. Buyer A Verification (Concurreny Limit = 2, Status = ACTIVE)
      const buyerALink = campaign.buyers.find((cb) => cb.buyer_id === BUYER_A_ID);
      if (!buyerALink) {
        errors.push(`Buyer A ("${BUYER_A_ID}") is not associated with campaign "${EXPECTED_QA_CAMPAIGN_ID}".`);
      } else {
        if (buyerALink.buyer.status !== 'ACTIVE') {
          errors.push(`Buyer A status is "${buyerALink.buyer.status}", expected "ACTIVE".`);
        }
        if (buyerALink.buyer.max_concurrent_calls !== 2) {
          errors.push(`Buyer A max_concurrent_calls is ${buyerALink.buyer.max_concurrent_calls}, expected 2.`);
        }
      }

      // 4. Buyer B Verification (Concurrency Limit = 2, Status = ACTIVE, Priority Order)
      const buyerBLink = campaign.buyers.find((cb) => cb.buyer_id === BUYER_B_ID);
      if (!buyerBLink) {
        errors.push(
          `Buyer B ("${BUYER_B_ID}") is not seeded in campaign "${EXPECTED_QA_CAMPAIGN_ID}". ` +
          `Execution cannot proceed without Buyer B pre-seeded.`,
        );
      } else {
        if (buyerBLink.buyer.status !== 'ACTIVE') {
          errors.push(`Buyer B status is "${buyerBLink.buyer.status}", expected "ACTIVE".`);
        }
        if (buyerBLink.buyer.max_concurrent_calls !== 2) {
          errors.push(`Buyer B max_concurrent_calls is ${buyerBLink.buyer.max_concurrent_calls}, expected 2.`);
        }
        if (buyerALink && buyerBLink.priority <= buyerALink.priority) {
          errors.push(`Buyer B priority (${buyerBLink.priority}) must be strictly lower priority than Buyer A (${buyerALink.priority}).`);
        }
      }
    }

    // 5. Initial Clean Baseline Verification
    const initialBuyerAReservations = await client.buyerReservation.count({
      where: { buyer_id: BUYER_A_ID, status: 'ACTIVE' },
    });
    const initialBuyerBReservations = await client.buyerReservation.count({
      where: { buyer_id: BUYER_B_ID, status: 'ACTIVE' },
    });

    if (initialBuyerAReservations !== 0 || initialBuyerBReservations !== 0) {
      errors.push(
        `Initial active reservation baseline is dirty: Buyer A has ${initialBuyerAReservations} active (expected 0), ` +
        `Buyer B has ${initialBuyerBReservations} active (expected 0). Prior test run records may require cleanup.`,
      );
    }

    if (errors.length > 0) {
      throw new Error(
        `\n====================================================================\n` +
        `PHASE C FIXTURE & BASELINE VERIFICATION FAILED (Zero Test Calls Injected):\n` +
        errors.map((e, idx) => `  ${idx + 1}. ${e}`).join('\n') +
        `\n====================================================================\n`,
      );
    }
  }

  // ==========================================================================
  // LIFECYCLE HOOKS
  // ==========================================================================

  beforeAll(async () => {
    // Stage 1: Phase A Environment Preflight (Enforces CALLFLOW_QA2B_STAGE_A_EXECUTE=true)
    assertPhaseAEnvironmentPreflight();

    // Stage 2: Initialize Provider Mocks
    fakeProvider = new FakeTelephonyProvider();
    mockWebhooks = new MockWebhooksService();

    // Stage 3: Compile Isolated NestJS TestingModule
    // Overriding TELEPHONY_PROVIDER and WebhooksService guarantees zero carrier/webhook egress
    moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(TELEPHONY_PROVIDER)
      .useValue(fakeProvider)
      .overrideProvider(WebhooksService)
      .useValue(mockWebhooks)
      .compile();

    // Note: moduleRef.init() is deliberately OMITTED so OnModuleInit timers never start
    prisma = moduleRef.get<PrismaService>(PrismaService);
    callController = moduleRef.get<CallController>(CallController);
    qaGuard = moduleRef.get<QaTelephonyGuardService>(QaTelephonyGuardService);

    // Dedicated helper client for row-lock contention testing
    helperPrisma = new PrismaClient({
      datasources: {
        db: { url: process.env.DATABASE_URL },
      },
    });
    await helperPrisma.$connect();

    // Stage 4: Phase B Post-Connection Database Identity Check for BOTH connections
    await assertPhaseBDatabaseIdentity(prisma, 'PrismaService (Application Pool)');
    await assertPhaseBDatabaseIdentity(helperPrisma, 'helperPrisma (Contention Client)');

    // Stage 5: Phase C Read-Only Fixture & Baseline Verification
    await assertPhaseCFixtures(prisma);

    logger.log('All preflight phases (A, B, C) successfully verified across both connections. Test environment is isolated.');
  });

  afterAll(async () => {
    const teardownErrors: Array<{ stage: string; error: Error }> = [];

    // Stage 1: Failure-Safe Helper Lock Release Before Awaiting Workers
    if (activeHelperReleaseFn) {
      try {
        activeHelperReleaseFn();
      } catch (err: any) {
        teardownErrors.push({ stage: 'Teardown Helper Release Trigger', error: err });
      }
    }
    if (activeHelperTxPromise) {
      try {
        await activeHelperTxPromise;
      } catch (err: any) {
        teardownErrors.push({ stage: 'Teardown Helper Transaction Await', error: err });
      }
    }

    // Stage 2: Settle Pending Worker Promises (Prevent Indefinite Hangs)
    if (pendingWorkerPromises.length > 0) {
      const settlements = await Promise.allSettled(pendingWorkerPromises);
      settlements.forEach((result, idx) => {
        if (result.status === 'rejected') {
          const err = result.reason instanceof Error ? result.reason : new Error(String(result.reason));
          teardownErrors.push({ stage: `Worker Promise ${idx + 1}`, error: err });
        }
      });
    }

    // Stage 3: Disconnect Helper Client
    if (helperPrisma) {
      try {
        await helperPrisma.$disconnect();
      } catch (err: any) {
        teardownErrors.push({ stage: 'Helper Prisma Disconnect', error: err });
      }
    }

    // Stage 4: Targeted Database Record Cleanup (While Prisma is Connected)
    // Foreign keys on calls.id use ON DELETE CASCADE to cleanly purge attempts and reservations
    if (prisma && trackedProviderCallIds.size > 0) {
      try {
        const deleteResult = await prisma.call.deleteMany({
          where: {
            provider_call_id: { in: Array.from(trackedProviderCallIds) },
          },
        });
        logger.log(`Teardown: Purged ${deleteResult.count} synthetic test call records via CASCADE.`);
      } catch (err: any) {
        teardownErrors.push({ stage: 'Database Cleanup (deleteMany)', error: err });
      }
    }

    // Stage 5: Unregister Active Test Runs from QA Guard
    if (qaGuard && activeTestRunIds.size > 0) {
      for (const runId of activeTestRunIds) {
        try {
          qaGuard.unregisterActiveTestRun(runId);
        } catch (err: any) {
          teardownErrors.push({ stage: `QA Guard Unregister (${runId})`, error: err });
        }
      }
    }

    // Stage 6: Close NestJS TestingModule (Manages Internal Providers & Prisma Disconnection)
    if (moduleRef) {
      try {
        await moduleRef.close();
      } catch (err: any) {
        teardownErrors.push({ stage: 'TestingModule Close', error: err });
      }
    }

    // Stage 7: Fail Loudly if Any Teardown Step Failed
    if (teardownErrors.length > 0) {
      const summary = teardownErrors.map((e) => `[${e.stage}] ${e.error.message}`).join(' | ');
      throw new Error(`CRITICAL: Stage A Teardown encountered unhandled error(s): ${summary}`);
    }
  });

  // ==========================================================================
  // SYNTHETIC EVENT GENERATION HELPERS
  // ==========================================================================

  function generateUniqueCallEvent(
    testRunId: string,
    stepName: string,
    callerCli: string,
    lease: QaInboundLease,
  ): NormalizedCallEvent {
    const providerCallId = `qa-call-${testRunId}-${stepName}-${crypto.randomBytes(4).toString('hex')}`;
    trackedProviderCallIds.add(providerCallId);

    const configuredAppId = process.env.TELNYX_QA_CALL_CONTROL_APP_ID!.trim();

    return {
      type: CallEventType.CALL_INITIATED,
      callId: providerCallId,
      direction: 'incoming',
      from: callerCli,
      to: EXPECTED_QA_TRACKING_DID,
      connectionId: configuredAppId,
      clientState: lease.secretToken, // Cryptographic single-use lease match
      timestamp: new Date().toISOString(),
    };
  }

  // ==========================================================================
  // SUITE A — SEQUENTIAL WATERFALL SCENARIO
  // ==========================================================================

  describe('Suite A — Sequential Capacity Exhaustion & Waterfall Overflow', () => {
    const testRunIdA = `qa-run-suite-a-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

    it('routes Call 1 to Buyer A (Slot 1/2), Call 2 to Buyer A (Slot 2/2), and overflows Call 3 to Buyer B', async () => {
      // 0. Verify and Record Pre-Suite Baseline
      const preSuiteABaselineA = await prisma!.buyerReservation.count({
        where: { buyer_id: BUYER_A_ID, status: 'ACTIVE' },
      });
      const preSuiteABaselineB = await prisma!.buyerReservation.count({
        where: { buyer_id: BUYER_B_ID, status: 'ACTIVE' },
      });
      expect(preSuiteABaselineA).toBe(0);
      expect(preSuiteABaselineB).toBe(0);

      // 1. Register Suite A Test Run
      activeTestRunIds.add(testRunIdA);
      qaGuard!.registerActiveTestRun(testRunIdA, { ttlMs: 180000 });

      const configuredAppId = process.env.TELNYX_QA_CALL_CONTROL_APP_ID!.trim();
      const cli1 = '+12025550001';
      const cli2 = '+12025550002';
      const cli3 = '+12025550003';

      // 2. Open 3 Dedicated Single-Use Inbound Leases
      const lease1 = qaGuard!.openInboundTestLease({
        runId: testRunIdA,
        expectedCallerCli: cli1,
        expectedConnectionId: configuredAppId,
        ttlMs: 60000,
      });

      const lease2 = qaGuard!.openInboundTestLease({
        runId: testRunIdA,
        expectedCallerCli: cli2,
        expectedConnectionId: configuredAppId,
        ttlMs: 60000,
      });

      const lease3 = qaGuard!.openInboundTestLease({
        runId: testRunIdA,
        expectedCallerCli: cli3,
        expectedConnectionId: configuredAppId,
        ttlMs: 60000,
      });

      // 3. Inject Call 1 -> Expect Buyer A (Slot 1 of 2)
      const event1 = generateUniqueCallEvent(testRunIdA, 'call-1', cli1, lease1);
      await callController!.handleEvent(event1);
      await callController!.handleEvent({
        type: CallEventType.CALL_ANSWERED,
        callId: event1.callId,
        direction: 'incoming',
        timestamp: new Date().toISOString(),
      });

      const dbCall1 = await prisma!.call.findUnique({
        where: { provider_call_id: event1.callId },
        include: { attempts: true },
      });
      expect(dbCall1).toBeDefined();
      expect(dbCall1!.attempts.length).toBe(1);
      expect(dbCall1!.attempts[0].buyer_id).toBe(BUYER_A_ID);

      let activeReservationsBuyerA = await prisma!.buyerReservation.count({
        where: { buyer_id: BUYER_A_ID, status: 'ACTIVE' },
      });
      expect(activeReservationsBuyerA).toBe(preSuiteABaselineA + 1);

      // 4. Inject Call 2 -> Expect Buyer A (Slot 2 of 2 - Capacity Exhausted)
      const event2 = generateUniqueCallEvent(testRunIdA, 'call-2', cli2, lease2);
      await callController!.handleEvent(event2);
      await callController!.handleEvent({
        type: CallEventType.CALL_ANSWERED,
        callId: event2.callId,
        direction: 'incoming',
        timestamp: new Date().toISOString(),
      });

      const dbCall2 = await prisma!.call.findUnique({
        where: { provider_call_id: event2.callId },
        include: { attempts: true },
      });
      expect(dbCall2).toBeDefined();
      expect(dbCall2!.attempts.length).toBe(1);
      expect(dbCall2!.attempts[0].buyer_id).toBe(BUYER_A_ID);

      activeReservationsBuyerA = await prisma!.buyerReservation.count({
        where: { buyer_id: BUYER_A_ID, status: 'ACTIVE' },
      });
      expect(activeReservationsBuyerA).toBe(preSuiteABaselineA + 2);

      // 5. Inject Call 3 -> Buyer A is Saturated -> Expect Waterfall to Buyer B (Slot 1 of 2)
      const event3 = generateUniqueCallEvent(testRunIdA, 'call-3', cli3, lease3);
      await callController!.handleEvent(event3);
      await callController!.handleEvent({
        type: CallEventType.CALL_ANSWERED,
        callId: event3.callId,
        direction: 'incoming',
        timestamp: new Date().toISOString(),
      });

      const dbCall3 = await prisma!.call.findUnique({
        where: { provider_call_id: event3.callId },
        include: { attempts: true },
      });
      expect(dbCall3).toBeDefined();
      expect(dbCall3!.attempts.length).toBe(1);
      expect(dbCall3!.attempts[0].buyer_id).toBe(BUYER_B_ID);

      const activeReservationsBuyerB = await prisma!.buyerReservation.count({
        where: { buyer_id: BUYER_B_ID, status: 'ACTIVE' },
      });
      expect(activeReservationsBuyerB).toBe(preSuiteABaselineB + 1);

      // Verify Final Suite A Capacity Distribution
      expect(await prisma!.buyerReservation.count({ where: { buyer_id: BUYER_A_ID, status: 'ACTIVE' } })).toBe(2);
      expect(await prisma!.buyerReservation.count({ where: { buyer_id: BUYER_B_ID, status: 'ACTIVE' } })).toBe(1);

      // 6. Suite A Isolation Teardown: Purge Suite A records so Suite B starts from pristine baseline
      const suiteACallIds = [event1.callId, event2.callId, event3.callId];
      await prisma!.call.deleteMany({
        where: { provider_call_id: { in: suiteACallIds } },
      });

      // Verify Baseline Restored to Original Pre-Suite Baseline
      expect(await prisma!.buyerReservation.count({ where: { buyer_id: BUYER_A_ID, status: 'ACTIVE' } })).toBe(preSuiteABaselineA);
      expect(await prisma!.buyerReservation.count({ where: { buyer_id: BUYER_B_ID, status: 'ACTIVE' } })).toBe(preSuiteABaselineB);
    });
  });

  // ==========================================================================
  // SUITE B — CONCURRENT RESERVATION RACE SCENARIO
  // ==========================================================================

  describe('Suite B — Simultaneous Transactional Concurrency Race', () => {
    const testRunIdB = `qa-run-suite-b-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

    it('proves PostgreSQL row lock contention, atomic serialization, and overflow under concurrency', async () => {
      // 0. Verify and Record Pre-Suite Baseline Before Starting Suite B
      const preSuiteBBaselineA = await prisma!.buyerReservation.count({
        where: { buyer_id: BUYER_A_ID, status: 'ACTIVE' },
      });
      const preSuiteBBaselineB = await prisma!.buyerReservation.count({
        where: { buyer_id: BUYER_B_ID, status: 'ACTIVE' },
      });
      expect(preSuiteBBaselineA).toBe(0);
      expect(preSuiteBBaselineB).toBe(0);

      // 1. Register Suite B Test Run
      activeTestRunIds.add(testRunIdB);
      qaGuard!.registerActiveTestRun(testRunIdB, { ttlMs: 180000 });

      const configuredAppId = process.env.TELNYX_QA_CALL_CONTROL_APP_ID!.trim();
      const cli0 = '+12025550010';
      const cli1 = '+12025550111';
      const cli2 = '+12025550112';

      // 2. Open Leases for Call B0 (Baseline) and Racing Calls B1 & B2
      const lease0 = qaGuard!.openInboundTestLease({
        runId: testRunIdB,
        expectedCallerCli: cli0,
        expectedConnectionId: configuredAppId,
        ttlMs: 60000,
      });

      const lease1 = qaGuard!.openInboundTestLease({
        runId: testRunIdB,
        expectedCallerCli: cli1,
        expectedConnectionId: configuredAppId,
        ttlMs: 60000,
      });

      const lease2 = qaGuard!.openInboundTestLease({
        runId: testRunIdB,
        expectedCallerCli: cli2,
        expectedConnectionId: configuredAppId,
        ttlMs: 60000,
      });

      // 3. Establish Baseline: Inject Call B0 to claim slot 1 of Buyer A
      const event0 = generateUniqueCallEvent(testRunIdB, 'call-b0', cli0, lease0);
      await callController!.handleEvent(event0);
      await callController!.handleEvent({
        type: CallEventType.CALL_ANSWERED,
        callId: event0.callId,
        direction: 'incoming',
        timestamp: new Date().toISOString(),
      });

      const buyerAReservationsInitial = await prisma!.buyerReservation.count({
        where: { buyer_id: BUYER_A_ID, status: 'ACTIVE' },
      });
      expect(buyerAReservationsInitial).toBe(preSuiteBBaselineA + 1); // Exactly 1 capacity slot remaining on Buyer A!

      // 4. Acquire Helper Pre-Lock on Buyer A Row with Guaranteed Acquisition Notification
      const helperLockAcquiredDeferred = createDeferred<{ helperPid: number }>();
      const helperReleaseDeferred = createDeferred<void>();

      // Register active helper release and promise for teardown failure-safety
      activeHelperReleaseFn = () => helperReleaseDeferred.resolve();

      const helperTxPromise = helperPrisma!.$transaction(async (tx) => {
        try {
          const pidResult = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
          const helperPid = pidResult[0].pid;

          // Acquire exclusive row lock on Buyer A tuple
          await tx.$queryRaw`SELECT id FROM "buyers" WHERE id = ${BUYER_A_ID} FOR UPDATE`;

          // CRITICAL: Resolve deferred ONLY AFTER SELECT ... FOR UPDATE completes successfully
          helperLockAcquiredDeferred.resolve({ helperPid });
        } catch (lockErr) {
          helperLockAcquiredDeferred.reject(lockErr);
          throw lockErr;
        }

        // Hold transaction open until controlling test confirms both workers are waiting
        await helperReleaseDeferred.promise;
      });

      // Attach diagnostic catch to helper promise to eliminate unhandled rejection window
      helperTxPromise.catch((err) => {
        logger.debug(`helperTxPromise caught: ${err.message}`);
      });

      activeHelperTxPromise = helperTxPromise;

      // DO NOT dispatch racing calls until helper lock is positively confirmed acquired
      const { helperPid } = await helperLockAcquiredDeferred.promise;
      expect(helperPid).toBeGreaterThan(0);

      try {
        // 5. Dispatch Call B1 and Call B2 Concurrently
        const event1 = generateUniqueCallEvent(testRunIdB, 'call-b1', cli1, lease1);
        const event2 = generateUniqueCallEvent(testRunIdB, 'call-b2', cli2, lease2);

        // Pre-initialize calls so both exist in database
        await callController!.handleEvent(event1);
        await callController!.handleEvent(event2);

        // Concurrently dispatch incoming CALL_ANSWERED to trigger dialNextBuyer() / prepareNextBuyer()
        const p1 = callController!.handleEvent({
          type: CallEventType.CALL_ANSWERED,
          callId: event1.callId,
          direction: 'incoming',
          timestamp: new Date().toISOString(),
        });
        const p2 = callController!.handleEvent({
          type: CallEventType.CALL_ANSWERED,
          callId: event2.callId,
          direction: 'incoming',
          timestamp: new Date().toISOString(),
        });
        pendingWorkerPromises.push(p1, p2);

        // 6. Observe Row Lock Contention in PostgreSQL Catalog
        // Workers reach CallsService.prepareNextBuyer() and stall behind helperPid on Buyer A row lock
        let contentionObserved = false;
        let observedBlockedCount = 0;
        const pollStart = Date.now();
        const pollTimeoutMs = 5000;

        while (Date.now() - pollStart < pollTimeoutMs) {
          const blockedSessions = await prisma!.$queryRaw<Array<{
            blocked_pid: number;
            wait_event_type: string;
            blocking_pids: number[];
          }>>`
            SELECT
              pid AS blocked_pid,
              wait_event_type,
              pg_blocking_pids(pid) AS blocking_pids
            FROM pg_stat_activity
            WHERE wait_event_type = 'Lock'
              AND (
                ${helperPid} = ANY(pg_blocking_pids(pid))
                OR EXISTS (
                  SELECT 1 FROM pg_stat_activity b
                  WHERE ${helperPid} = ANY(pg_blocking_pids(b.pid))
                    AND b.pid = ANY(pg_blocking_pids(pg_stat_activity.pid))
                )
              );
          `;

          if (blockedSessions.length > 0) {
            observedBlockedCount = blockedSessions.length;
            contentionObserved = true;
            logger.log(
              `Row lock contention observed in pg_stat_activity: ${blockedSessions.length} worker(s) blocked behind helper PID ${helperPid} (Blocked PIDs: ${blockedSessions.map((s) => s.blocked_pid).join(', ')})`,
            );
            break;
          }

          await new Promise((resolve) => setTimeout(resolve, 50));
        }

        // Assert that row lock contention behind helper's row lock was empirically proven
        expect(contentionObserved).toBe(true);
        expect(observedBlockedCount).toBeGreaterThanOrEqual(1);

        // 7. Release Helper Row Lock & Await Worker Completion
        helperReleaseDeferred.resolve();
        await helperTxPromise;
        await Promise.all([p1, p2]);

        // 8. Verify Atomic Capacity Serialization & Invariants
        const activeBuyerAReservations = await prisma!.buyerReservation.count({
          where: { buyer_id: BUYER_A_ID, status: 'ACTIVE' },
        });
        // Invariant: Buyer A maximum capacity (2) is strictly respected (NEVER 3)
        expect(activeBuyerAReservations).toBe(2);

        const activeBuyerBReservations = await prisma!.buyerReservation.count({
          where: { buyer_id: BUYER_B_ID, status: 'ACTIVE' },
        });
        // Invariant: The losing call waterfalls cleanly to Buyer B (Slot 1 of 2)
        expect(activeBuyerBReservations).toBe(1);

        // Verify Attempt Distribution for Racing Calls B1 and B2
        const callB1 = await prisma!.call.findUnique({
          where: { provider_call_id: event1.callId },
          include: { attempts: true },
        });
        const callB2 = await prisma!.call.findUnique({
          where: { provider_call_id: event2.callId },
          include: { attempts: true },
        });

        expect(callB1!.attempts.length).toBe(1);
        expect(callB2!.attempts.length).toBe(1);

        const assignedBuyerIds = [callB1!.attempts[0].buyer_id, callB2!.attempts[0].buyer_id];
        expect(assignedBuyerIds).toContain(BUYER_A_ID);
        expect(assignedBuyerIds).toContain(BUYER_B_ID);

        logger.log('Suite B Concurrency Race successfully proven: PostgreSQL row-locking serialized conflicting calls atomically.');

        // 9. Suite B Isolation Teardown: Purge Suite B calls and verify baseline restored
        const suiteBCallIds = [event0.callId, event1.callId, event2.callId];
        await prisma!.call.deleteMany({
          where: { provider_call_id: { in: suiteBCallIds } },
        });

        expect(await prisma!.buyerReservation.count({ where: { buyer_id: BUYER_A_ID, status: 'ACTIVE' } })).toBe(preSuiteBBaselineA);
        expect(await prisma!.buyerReservation.count({ where: { buyer_id: BUYER_B_ID, status: 'ACTIVE' } })).toBe(preSuiteBBaselineB);
      } finally {
        // Guaranteed Failure-Safe Helper Lock Release Regardless of Contention Timeout or Assertion Failure
        helperReleaseDeferred.resolve();
        try {
          await helperTxPromise;
        } catch (txErr: any) {
          logger.warn(`Helper transaction ended in finally: ${txErr.message}`);
        }
        activeHelperReleaseFn = null;
        activeHelperTxPromise = null;
      }
    });
  });
});
