import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { CallController, TELEPHONY_PROVIDER } from './call-controller.js';
import { TelnyxWebhookController } from './telnyx/telnyx.webhook.controller.js';
import { WebhookIdempotencyService } from './webhook-idempotency.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CallsService } from '../calls/calls.service.js';
import { UsageService } from '../usage/usage.service.js';
import { UsageBillingService } from '../billing/usage-billing.service.js';
import { WalletService } from '../billing/wallet.service.js';
import { WebhooksService } from '../webhooks/webhooks.service.js';
import { CallEventType } from './telephony.events.js';
import { CallState, CallAttemptState, WebhookStatus } from '@prisma/client';
import {
  validateDatabaseTarget,
  assertNonProductionDatabase,
  stripProductionEnvironmentVariables,
  FORBIDDEN_PRODUCTION_PATTERNS,
} from '../common/database-isolation.util.js';
import { ForbiddenException } from '@nestjs/common';

describe('CALLFLOW PHASE 2 — P2.1 Telephony Multi-Workspace Isolation & Infrastructure Suite', () => {
  let callController: CallController;
  let webhookController: TelnyxWebhookController;
  let idempotencyService: WebhookIdempotencyService;
  let prisma: any;
  let provider: any;
  let callsService: any;
  let walletService: any;
  let usageBillingService: any;
  let webhooksService: any;

  const originalEnv = { ...process.env };

  beforeEach(async () => {
    process.env = { ...originalEnv };
    process.env.NODE_ENV = 'test';
    delete process.env.APP_ENV;
    delete process.env.TELNYX_PUBLIC_KEY;
    process.env.ALLOW_UNVERIFIED_WEBHOOKS = 'true';
    process.env.TELNYX_API_KEY = 'mock-ci-test-key-00000000';

    prisma = {
      $transaction: vi.fn(async (cb) => cb(prisma)),
      call: {
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      callAttempt: {
        findUnique: vi.fn(),
        update: vi.fn(),
        create: vi.fn(),
      },
      phoneNumber: {
        findFirst: vi.fn(),
        findUnique: vi.fn(),
      },
      blockedCaller: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
      },
      webhookEvent: {
        findUnique: vi.fn(),
        create: vi.fn(),
        updateMany: vi.fn(),
      },
      recording: {
        create: vi.fn(),
      },
    };

    provider = {
      answerCall: vi.fn().mockResolvedValue(undefined),
      hangupCall: vi.fn().mockResolvedValue(undefined),
      bridgeCalls: vi.fn().mockResolvedValue(undefined),
      dialBuyer: vi.fn().mockResolvedValue('v3:buyer_leg_123'),
      startRingback: vi.fn().mockResolvedValue(undefined),
      stopRingback: vi.fn().mockResolvedValue(undefined),
    };

    callsService = {
      createCall: vi.fn(),
      markCallAnswered: vi.fn().mockResolvedValue(true),
      transitionCall: vi.fn(),
      commitBuyerDial: vi.fn().mockResolvedValue(false),
      handleBridgeFailure: vi.fn(),
      handleCallerHangup: vi.fn().mockResolvedValue({ id: 'call_synth_1', state: CallState.COMPLETED, ended_at: new Date() }),
      handleBuyerHangup: vi.fn().mockResolvedValue({ action: 'HANGUP_CALLER' }),
    };

    walletService = {
      reserveForCall: vi.fn().mockResolvedValue({ totalReservedMicro: 100000 }),
      extendReservationForCall: vi.fn().mockResolvedValue({ totalReservedMicro: 200000, availableMicro: 500000 }),
    };

    usageBillingService = {
      calculateInitialReservation: vi.fn().mockReturnValue(100000),
      billCallUsage: vi.fn().mockResolvedValue(undefined),
      billRecordingUsage: vi.fn().mockResolvedValue(undefined),
    };

    webhooksService = {
      queueEvent: vi.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TelnyxWebhookController],
      providers: [
        CallController,
        WebhookIdempotencyService,
        { provide: TELEPHONY_PROVIDER, useValue: provider },
        { provide: PrismaService, useValue: prisma },
        { provide: CallsService, useValue: callsService },
        { provide: UsageService, useValue: { recordUsage: vi.fn() } },
        { provide: UsageBillingService, useValue: usageBillingService },
        { provide: WalletService, useValue: walletService },
        { provide: WebhooksService, useValue: webhooksService },
      ],
    }).compile();

    callController = module.get<CallController>(CallController);
    webhookController = module.get<TelnyxWebhookController>(TelnyxWebhookController);
    idempotencyService = module.get<WebhookIdempotencyService>(WebhookIdempotencyService);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('1. Inbound Webhook Workspace Correlation', () => {
    it('correlates incoming call to Workspace A based on Workspace A DID and creates call in Workspace A', async () => {
      const DID_A = '+12025550100';
      const WS_A = 'ws_alpha_corp';
      const CALL_ID_A = 'v3:call_inbound_ws_a';

      prisma.phoneNumber.findFirst.mockResolvedValueOnce({
        id: 'phone_a',
        phone_number: DID_A,
        workspace_id: WS_A,
        number_type: 'local',
        status: 'ACTIVE',
        workspace: { id: WS_A, status: 'ACTIVE' },
        campaign: { id: 'camp_a', status: 'ACTIVE' },
      });

      callsService.createCall.mockResolvedValueOnce({
        id: 'db_call_a',
        workspace_id: WS_A,
        provider_call_id: CALL_ID_A,
        to_number: DID_A,
        state: CallState.INITIATED,
      });

      await callController.handleEvent({
        type: CallEventType.CALL_INITIATED,
        callId: CALL_ID_A,
        direction: 'incoming',
        to: DID_A,
        from: '+15559998888',
        timestamp: new Date().toISOString(),
      });

      // Verifies DID lookup was for the dialed number
      expect(prisma.phoneNumber.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { phone_number: DID_A },
        }),
      );

      // Verifies Call was created strictly with Workspace A's workspace_id
      expect(callsService.createCall).toHaveBeenCalledWith(
        expect.objectContaining({
          workspace_id: WS_A,
          phone_number_id: 'phone_a',
          provider_call_id: CALL_ID_A,
        }),
      );

      // Verifies wallet reservation was strictly scoped to Workspace A
      expect(walletService.reserveForCall).toHaveBeenCalledWith(
        WS_A,
        'db_call_a',
        100000,
      );

      // Verifies call answered
      expect(provider.answerCall).toHaveBeenCalledWith(CALL_ID_A);
    });

    it('correlates incoming call to Workspace B based on Workspace B DID and isolates from Workspace A', async () => {
      const DID_B = '+12025550200';
      const WS_B = 'ws_beta_holdings';
      const CALL_ID_B = 'v3:call_inbound_ws_b';

      prisma.phoneNumber.findFirst.mockResolvedValueOnce({
        id: 'phone_b',
        phone_number: DID_B,
        workspace_id: WS_B,
        number_type: 'toll_free',
        status: 'ACTIVE',
        workspace: { id: WS_B, status: 'ACTIVE' },
        campaign: { id: 'camp_b', status: 'ACTIVE' },
      });

      callsService.createCall.mockResolvedValueOnce({
        id: 'db_call_b',
        workspace_id: WS_B,
        provider_call_id: CALL_ID_B,
        to_number: DID_B,
        state: CallState.INITIATED,
      });

      await callController.handleEvent({
        type: CallEventType.CALL_INITIATED,
        callId: CALL_ID_B,
        direction: 'incoming',
        to: DID_B,
        from: '+15557776666',
        timestamp: new Date().toISOString(),
      });

      expect(callsService.createCall).toHaveBeenCalledWith(
        expect.objectContaining({
          workspace_id: WS_B,
          phone_number_id: 'phone_b',
        }),
      );
      expect(walletService.reserveForCall).toHaveBeenCalledWith(
        WS_B,
        'db_call_b',
        100000,
      );
    });

    it('fails closed when receiving inbound call for unassigned or inactive DID without cross-tenant leakage', async () => {
      const UNASSIGNED_DID = '+12025550999';
      prisma.phoneNumber.findFirst.mockResolvedValueOnce(null);

      await callController.handleEvent({
        type: CallEventType.CALL_INITIATED,
        callId: 'v3:unassigned_call',
        direction: 'incoming',
        to: UNASSIGNED_DID,
        from: '+15551112222',
        timestamp: new Date().toISOString(),
      });

      // Immediate hangup, zero DB call records, zero wallet reservation
      expect(provider.hangupCall).toHaveBeenCalledWith('v3:unassigned_call');
      expect(callsService.createCall).not.toHaveBeenCalled();
      expect(walletService.reserveForCall).not.toHaveBeenCalled();
    });

    it('enforces cross-tenant blocked caller isolation: caller blocked in WS A is NOT blocked in WS B', async () => {
      const CALLER = '+15554443333';
      const DID_B = '+12025550200';
      const WS_B = 'ws_beta';

      prisma.phoneNumber.findFirst.mockResolvedValueOnce({
        id: 'phone_b',
        phone_number: DID_B,
        workspace_id: WS_B,
        number_type: 'local',
        status: 'ACTIVE',
        workspace: { id: WS_B, status: 'ACTIVE' },
        campaign: { id: 'camp_b', status: 'ACTIVE' },
      });

      // Blocked caller check is scoped to workspace_id
      prisma.blockedCaller.findUnique.mockResolvedValueOnce(null); // Not blocked in WS B

      callsService.createCall.mockResolvedValueOnce({
        id: 'call_b_clean',
        workspace_id: WS_B,
        provider_call_id: 'v3:call_b_clean',
        to_number: DID_B,
        state: CallState.INITIATED,
      });

      await callController.handleEvent({
        type: CallEventType.CALL_INITIATED,
        callId: 'v3:call_b_clean',
        direction: 'incoming',
        to: DID_B,
        from: CALLER,
        timestamp: new Date().toISOString(),
      });

      // Scoped check verifies workspace_id_phone_number composite lookup
      expect(prisma.blockedCaller.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            workspace_id_phone_number: {
              workspace_id: WS_B,
              phone_number: CALLER,
            },
          },
        }),
      );
      expect(callsService.createCall).toHaveBeenCalled();
      expect(provider.answerCall).toHaveBeenCalledWith('v3:call_b_clean');
    });
  });

  describe('2. Client State & Call Identifier Anti-Tampering Isolation', () => {
    it('correlates fast buyer answer webhook via client_state when workspaceId matches perfectly', async () => {
      const BUYER_CALL_ID = 'v3:buyer_fast_answer';
      const CALL_ID = 'call_ws_alpha_1';
      const ATTEMPT_ID = 'att_ws_alpha_1';
      const WS_ALPHA = 'ws_alpha';

      const validClientState = Buffer.from(
        JSON.stringify({
          callId: CALL_ID,
          attemptId: ATTEMPT_ID,
          workspaceId: WS_ALPHA,
        }),
      ).toString('base64');

      // Provider call ID not yet persisted
      prisma.call.findUnique.mockResolvedValueOnce(null);
      prisma.callAttempt.findUnique
        .mockResolvedValueOnce(null) // by provider_call_id
        .mockResolvedValueOnce({     // by decoded attemptId
          id: ATTEMPT_ID,
          call_id: CALL_ID,
          provider_call_id: null,
          state: CallAttemptState.RINGING,
          call: {
            id: CALL_ID,
            workspace_id: WS_ALPHA,
            state: CallState.ROUTING,
            provider_call_id: 'v3:caller_leg_alpha',
            attempts: [],
          },
        });

      await callController.handleEvent({
        type: CallEventType.CALL_ANSWERED,
        callId: BUYER_CALL_ID,
        clientState: validClientState,
        timestamp: new Date().toISOString(),
      });

      // Provider call ID backfilled on attempt
      expect(prisma.callAttempt.update).toHaveBeenCalledWith({
        where: { id: ATTEMPT_ID },
        data: { provider_call_id: BUYER_CALL_ID },
      });

      // Calls bridged
      expect(callsService.markCallAnswered).toHaveBeenCalledWith(CALL_ID, ATTEMPT_ID);
      expect(provider.bridgeCalls).toHaveBeenCalledWith(
        'v3:caller_leg_alpha',
        BUYER_CALL_ID,
      );
    });

    it('hard-rejects client_state correlation when workspaceId belongs to a different workspace (tampering defense)', async () => {
      const BUYER_CALL_ID = 'v3:buyer_tamper_attempt';
      const CALL_ID = 'call_ws_victim';
      const ATTEMPT_ID = 'att_ws_victim';
      const VICTIM_WS = 'ws_victim_workspace';
      const ATTACKER_WS = 'ws_attacker_workspace';

      // Attacker attempts to forge client_state with their own workspaceId for victim call
      const spoofedClientState = Buffer.from(
        JSON.stringify({
          callId: CALL_ID,
          attemptId: ATTEMPT_ID,
          workspaceId: ATTACKER_WS,
        }),
      ).toString('base64');

      prisma.call.findUnique.mockResolvedValueOnce(null);
      prisma.callAttempt.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: ATTEMPT_ID,
          call_id: CALL_ID,
          provider_call_id: null,
          state: CallAttemptState.RINGING,
          call: {
            id: CALL_ID,
            workspace_id: VICTIM_WS, // Real workspace is victim
            state: CallState.ROUTING,
            provider_call_id: 'v3:victim_caller_leg',
            attempts: [],
          },
        });

      await callController.handleEvent({
        type: CallEventType.CALL_ANSWERED,
        callId: BUYER_CALL_ID,
        clientState: spoofedClientState,
        timestamp: new Date().toISOString(),
      });

      // Verification fails: provider_call_id is NOT updated and bridge is NEVER called
      expect(prisma.callAttempt.update).not.toHaveBeenCalled();
      expect(callsService.markCallAnswered).not.toHaveBeenCalled();
      expect(provider.bridgeCalls).not.toHaveBeenCalled();
    });

    it('hard-rejects client_state when attemptId does not match the callId', async () => {
      const mismatchedClientState = Buffer.from(
        JSON.stringify({
          callId: 'call_target_1',
          attemptId: 'att_different_call',
          workspaceId: 'ws_alpha',
        }),
      ).toString('base64');

      prisma.call.findUnique.mockResolvedValueOnce(null);
      prisma.callAttempt.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: 'att_different_call',
          call_id: 'call_unrelated_99', // Mismatched!
          call: {
            id: 'call_unrelated_99',
            workspace_id: 'ws_alpha',
          },
        });

      await callController.handleEvent({
        type: CallEventType.CALL_ANSWERED,
        callId: 'v3:buyer_mismatch',
        clientState: mismatchedClientState,
        timestamp: new Date().toISOString(),
      });

      expect(prisma.callAttempt.update).not.toHaveBeenCalled();
      expect(provider.bridgeCalls).not.toHaveBeenCalled();
    });

    it('gracefully handles malformed base64 client_state without throwing unhandled exceptions', async () => {
      prisma.call.findUnique.mockResolvedValueOnce(null);
      prisma.callAttempt.findUnique.mockResolvedValueOnce(null);

      await expect(
        callController.handleEvent({
          type: CallEventType.CALL_ANSWERED,
          callId: 'v3:buyer_corrupt',
          clientState: 'not-valid-base64-json!@#$%',
          timestamp: new Date().toISOString(),
        }),
      ).resolves.not.toThrow();

      expect(provider.bridgeCalls).not.toHaveBeenCalled();
    });
  });

  describe('3. Concurrent Webhook Deliveries for Separate Workspaces', () => {
    it('processes concurrent webhooks for separate workspaces in parallel without locking or interference', async () => {
      const DID_A = '+12025550100';
      const DID_B = '+12025550200';
      const WS_A = 'ws_alpha';
      const WS_B = 'ws_beta';

      // Mock phone number resolution for concurrent calls
      prisma.phoneNumber.findFirst.mockImplementation(async ({ where }: any) => {
        if (where.phone_number === DID_A) {
          return {
            id: 'phone_a',
            phone_number: DID_A,
            workspace_id: WS_A,
            number_type: 'local',
            status: 'ACTIVE',
            workspace: { id: WS_A, status: 'ACTIVE' },
            campaign: { id: 'camp_a', status: 'ACTIVE' },
          };
        }
        if (where.phone_number === DID_B) {
          return {
            id: 'phone_b',
            phone_number: DID_B,
            workspace_id: WS_B,
            number_type: 'local',
            status: 'ACTIVE',
            workspace: { id: WS_B, status: 'ACTIVE' },
            campaign: { id: 'camp_b', status: 'ACTIVE' },
          };
        }
        return null;
      });

      callsService.createCall.mockImplementation(async (data: any) => {
        return {
          id: `call_${data.workspace_id}`,
          workspace_id: data.workspace_id,
          provider_call_id: data.provider_call_id,
          to_number: data.to_number,
          state: CallState.INITIATED,
        };
      });

      // Simulate simultaneous inbound event arrival
      await Promise.all([
        callController.handleEvent({
          type: CallEventType.CALL_INITIATED,
          callId: 'v3:concurrent_call_a',
          direction: 'incoming',
          to: DID_A,
          from: '+15551110001',
          timestamp: new Date().toISOString(),
        }),
        callController.handleEvent({
          type: CallEventType.CALL_INITIATED,
          callId: 'v3:concurrent_call_b',
          direction: 'incoming',
          to: DID_B,
          from: '+15552220002',
          timestamp: new Date().toISOString(),
        }),
      ]);

      // Both workspaces had their calls created independently
      expect(callsService.createCall).toHaveBeenCalledWith(
        expect.objectContaining({ workspace_id: WS_A, provider_call_id: 'v3:concurrent_call_a' }),
      );
      expect(callsService.createCall).toHaveBeenCalledWith(
        expect.objectContaining({ workspace_id: WS_B, provider_call_id: 'v3:concurrent_call_b' }),
      );

      // Both wallets had their initial reservation created independently
      expect(walletService.reserveForCall).toHaveBeenCalledWith(WS_A, 'call_ws_alpha', 100000);
      expect(walletService.reserveForCall).toHaveBeenCalledWith(WS_B, 'call_ws_beta', 100000);

      // Both calls answered
      expect(provider.answerCall).toHaveBeenCalledWith('v3:concurrent_call_a');
      expect(provider.answerCall).toHaveBeenCalledWith('v3:concurrent_call_b');
    });
  });

  describe('4. Webhook Idempotency Across Concurrent Workers', () => {
    it('concurrent duplicate webhook delivery: only worker 1 acquires lock, worker 2 receives duplicate NO-OP', async () => {
      const EVENT_ID = 'evt_concurrent_race_999';

      // Both check findUnique concurrently -> returns null
      prisma.webhookEvent.findUnique.mockResolvedValue(null);

      // Worker 1 create succeeds
      prisma.webhookEvent.create.mockResolvedValueOnce({ id: 'evt-db-1' });
      // Worker 2 create fails with Prisma unique constraint code P2002
      prisma.webhookEvent.create.mockRejectedValueOnce({
        code: 'P2002',
        message: 'Unique constraint failed on the fields: (`provider`,`providerEventId`)',
      });

      const [worker1Result, worker2Result] = await Promise.all([
        idempotencyService.acquireLock('telnyx', EVENT_ID, { leg: 1 }),
        idempotencyService.acquireLock('telnyx', EVENT_ID, { leg: 1 }),
      ]);

      expect(worker1Result.canProcess).toBe(true);
      expect(worker1Result.id).toBe('evt-db-1');
      expect(worker1Result.leaseToken).toBeDefined();

      expect(worker2Result.canProcess).toBe(false);
      expect(worker2Result.id).toBeUndefined();
    });

    it('replayed webhook after PROCESSED returns canProcess: false and never triggers duplicate business logic', async () => {
      const EVENT_ID = 'evt_replayed_123';

      prisma.webhookEvent.findUnique.mockResolvedValue({
        id: 'evt-db-existing',
        provider: 'telnyx',
        providerEventId: EVENT_ID,
        status: WebhookStatus.PROCESSED,
      });

      const result = await idempotencyService.acquireLock('telnyx', EVENT_ID, {});
      expect(result.canProcess).toBe(false);
      expect(result.id).toBe('evt-db-existing');
      expect(prisma.webhookEvent.updateMany).not.toHaveBeenCalled();
      expect(prisma.webhookEvent.create).not.toHaveBeenCalled();
    });

    it('enforces mandatory leaseToken on markProcessed: state transition fails if leaseToken is invalid or expired', async () => {
      prisma.webhookEvent.updateMany.mockResolvedValueOnce({ count: 0 }); // Token mismatch in DB

      const success = await idempotencyService.markProcessed('evt-db-1', 'expired-token-uuid');
      expect(success).toBe(false);
      expect(prisma.webhookEvent.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'evt-db-1',
          status: WebhookStatus.PENDING,
          error: 'lease:expired-token-uuid',
        },
        data: {
          status: WebhookStatus.PROCESSED,
          error: null,
        },
      });
    });
  });

  describe('5. Synthetic Telephony & Credential-Free Execution', () => {
    it('executes synthetic webhooks and call control without live Telnyx credentials or PSTN connections', async () => {
      // In test mode with explicit mock bypass, webhook signature bypass is accepted
      const req: any = {
        rawBody: Buffer.from(JSON.stringify({ data: { id: 'evt_synth_1', event_type: 'call.hangup' } })),
        headers: {
          'telnyx-signature-ed25519': 'synthetic-sig',
          'telnyx-timestamp': '1234567890',
        },
        body: {
          data: {
            id: 'evt_synth_1',
            event_type: 'call.hangup',
            payload: {
              call_control_id: 'v3:synth_hangup',
              cause: 'NORMAL_CLEARING',
            },
          },
        },
      };

      const res: any = {
        status: vi.fn().mockReturnThis(),
        send: vi.fn().mockReturnThis(),
      };

      prisma.webhookEvent.findUnique.mockResolvedValueOnce(null);
      prisma.webhookEvent.create.mockResolvedValueOnce({ id: 'evt_synth_db_1' });
      prisma.webhookEvent.updateMany.mockResolvedValueOnce({ count: 1 });

      prisma.call.findUnique.mockResolvedValueOnce({
        id: 'call_synth_1',
        workspace_id: 'ws_alpha',
        provider_call_id: 'v3:synth_hangup',
        state: CallState.IN_PROGRESS,
        attempts: [],
      });

      await webhookController.handleWebhook(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.send).toHaveBeenCalledWith('OK');
      // No live Telnyx API or network error thrown
    });

    it('rejects unverified webhook signature when not in test bypass mode', async () => {
      delete process.env.ALLOW_UNVERIFIED_WEBHOOKS;
      delete process.env.TELNYX_PUBLIC_KEY;
      process.env.APP_ENV = 'production'; // simulate non-isolated runtime

      const req: any = {
        rawBody: Buffer.from('{}'),
        headers: {
          'telnyx-signature-ed25519': 'fake-sig',
          'telnyx-timestamp': '1234567890',
        },
        body: {},
      };

      const res: any = {
        status: vi.fn().mockReturnThis(),
        send: vi.fn().mockReturnThis(),
      };

      await webhookController.handleWebhook(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.send).toHaveBeenCalledWith(
        expect.stringContaining('TELNYX_PUBLIC_KEY is required for webhook signature verification'),
      );
    });
  });

  describe('6. PostgreSQL Test Infrastructure Isolation Verification', () => {
    it('hard-rejects any remote or Supabase production database patterns', () => {
      for (const pattern of FORBIDDEN_PRODUCTION_PATTERNS) {
        const prodUrl = `postgresql://postgres.uwycbvnqnpnfisvvbabu:secret@aws-0-ap-south-1.pooler.supabase.com:6543/postgres?search=${pattern}`;
        const check = validateDatabaseTarget(prodUrl);
        expect(check.isValid).toBe(false);
        expect(check.reason).toContain('Production database pattern detected');
        expect(() => assertNonProductionDatabase(prodUrl)).toThrow(ForbiddenException);
      }
    });

    it('hard-rejects Supabase transaction pooler port 6543 even on local alias', () => {
      const poolerLocal = 'postgresql://postgres:pass@127.0.0.1:6543/callflow_test';
      const check = validateDatabaseTarget(poolerLocal);
      expect(check.isValid).toBe(false);
      expect(check.reason).toContain('Production database pattern detected');
    });

    it('accepts strictly isolated local loopback test database on port 5432 or 5433', () => {
      const localTestDb = 'postgresql://callflow_test_user:test_pass@127.0.0.1:5432/callflow_isolated_test';
      const check = validateDatabaseTarget(localTestDb, { allowTest: true });
      expect(check.isValid).toBe(true);
      expect(check.sanitizedUrl).toBe('postgresql://callflow_test_user:***@127.0.0.1:5432/callflow_isolated_test');
      expect(() => assertNonProductionDatabase(localTestDb, { allowTest: true })).not.toThrow();
    });

    it('strips inherited Supabase production keys from process.env via stripProductionEnvironmentVariables', () => {
      process.env.SUPABASE_URL = 'https://uwycbvnqnpnfisvvbabu.supabase.co';
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://uwycbvnqnpnfisvvbabu.supabase.co';
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'secret-key-123';

      stripProductionEnvironmentVariables();

      expect(process.env.SUPABASE_URL).toBeUndefined();
      expect(process.env.NEXT_PUBLIC_SUPABASE_URL).toBeUndefined();
    });
  });
});
