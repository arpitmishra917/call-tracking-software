import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CallController } from '../call-controller.js';
import { QaTelephonyGuardService } from './qa-telephony-guard.service.js';
import { QaSipUriAdapterService } from './qa-sip-uri-adapter.service.js';
import { UsageBillingService } from '../../billing/usage-billing.service.js';
import { ReservationRecoveryService } from '../reservation-recovery.service.js';
import { CallEventType } from '../telephony.events.js';
import { CallAttemptState, CallState } from '@prisma/client';

describe('Phase 7B-1: QA Ingress Shutdown Gate & Durable Billing Isolation', () => {
  let callController: CallController;
  let qaGuardService: QaTelephonyGuardService;
  let qaSipAdapter: QaSipUriAdapterService;

  let mockProvider: any;
  let mockPrisma: any;
  let mockCallsService: any;
  let mockUsageService: any;
  let mockUsageBillingService: any;
  let mockWebhooksService: any;
  let mockWalletService: any;
  let mockCommercialEvaluator: any;

  const originalEnv = { ...process.env };

  const QA_DID = '+14845560110';
  const QA_WORKSPACE = '550e8400-e29b-41d4-a716-446655440000';
  const PROD_WORKSPACE = 'prod-workspace-1111-2222-333344445555';
  const CALLER_CLI = '+17207159445';

  beforeEach(() => {
    qaGuardService = new QaTelephonyGuardService();
    qaSipAdapter = new QaSipUriAdapterService(qaGuardService);

    mockProvider = {
      hangupCall: vi.fn().mockResolvedValue({}),
      dialBuyer: vi.fn().mockResolvedValue({ callId: 'buyer_leg_1' }),
      bridgeCalls: vi.fn().mockResolvedValue({}),
      getCallStatus: vi.fn().mockResolvedValue('TERMINAL'),
    };

    mockPrisma = {
      call: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'call_created_1' }),
        update: vi.fn().mockResolvedValue({}),
      },
      callAttempt: {
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn().mockResolvedValue({}),
      },
      phoneNumber: {
        findFirst: vi.fn(),
      },
      blockedCaller: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
      callReservation: {
        findMany: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue({}),
      },
      buyerReservation: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };

    mockCallsService = {
      createCall: vi.fn().mockResolvedValue({ id: 'call_created_1' }),
      handleCallerHangup: vi.fn(),
      handleBuyerHangup: vi.fn(),
      prepareNextBuyer: vi.fn(),
      transitionAttempt: vi.fn().mockResolvedValue({}),
      releaseBuyerReservation: vi.fn().mockResolvedValue({}),
    };

    mockUsageService = {
      recordUsage: vi.fn().mockResolvedValue({}),
    };

    mockUsageBillingService = {
      billCallUsage: vi.fn().mockResolvedValue({ billed: true, costMicro: 50000n }),
    };

    mockWebhooksService = {
      dispatchWebhook: vi.fn().mockResolvedValue({}),
    };

    mockWalletService = {
      reserveForCall: vi.fn().mockResolvedValue({ reserved: true }),
      releaseReservation: vi.fn().mockResolvedValue({ released: true }),
      settleReservation: vi.fn().mockResolvedValue({ settled: true }),
    };

    mockCommercialEvaluator = {
      evaluateCall: vi.fn().mockResolvedValue({}),
    };

    callController = new CallController(
      mockProvider,
      mockPrisma,
      mockCallsService,
      mockUsageService,
      mockUsageBillingService,
      mockWebhooksService,
      mockWalletService,
      mockCommercialEvaluator,
      qaGuardService,
      qaSipAdapter,
    );

    process.env.TELEPHONY_QA_ENABLED = 'true';
    process.env.TELNYX_QA_TRACKING_DID = QA_DID;
    process.env.QA_WORKSPACE_ID = QA_WORKSPACE;
    process.env.TELEPHONY_QA_BUYER_SIP_URI = 'sip:arpitmishra9178@sip.telnyx.com';
    process.env.TELEPHONY_QA_ARI_URL = 'http://127.0.0.1:8088';
    process.env.TELEPHONY_QA_ARI_USERNAME = 'user';
    process.env.TELEPHONY_QA_ARI_PASSWORD = 'pass';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    qaGuardService.clearActiveTestRuns();
    process.env = { ...originalEnv };
  });

  describe('1. QA Ingress Shutdown Gate', () => {
    it('immediately hangs up call to QA DID when TELEPHONY_QA_ENABLED is false (no DB call, no wallet reserve)', async () => {
      process.env.TELEPHONY_QA_ENABLED = 'false';

      await callController.handleEvent({
        type: CallEventType.CALL_INITIATED,
        callId: 'v3:inbound_disabled_qa',
        direction: 'incoming',
        from: CALLER_CLI,
        to: QA_DID,
      });

      // Provider hangup was called immediately
      expect(mockProvider.hangupCall).toHaveBeenCalledWith('v3:inbound_disabled_qa');

      // Database phoneNumber lookup was never even performed
      expect(mockPrisma.phoneNumber.findFirst).not.toHaveBeenCalled();

      // Wallet reservation was never performed
      expect(mockWalletService.reserveForCall).not.toHaveBeenCalled();

      // Call record was never created
      expect(mockPrisma.call.create).not.toHaveBeenCalled();
      expect(mockCallsService.createCall).not.toHaveBeenCalled();
    });

    it('immediately hangs up call to QA DID when QA configuration is invalid', async () => {
      process.env.TELEPHONY_QA_ENABLED = 'true';
      delete process.env.QA_WORKSPACE_ID; // Invalid config

      await callController.handleEvent({
        type: CallEventType.CALL_INITIATED,
        callId: 'v3:inbound_bad_config',
        direction: 'incoming',
        from: CALLER_CLI,
        to: QA_DID,
      });

      expect(mockProvider.hangupCall).toHaveBeenCalledWith('v3:inbound_bad_config');
      expect(mockPrisma.phoneNumber.findFirst).not.toHaveBeenCalled();
      expect(mockWalletService.reserveForCall).not.toHaveBeenCalled();
    });

    it('immediately hangs up call to QA DID when no trusted lease matches', async () => {
      process.env.TELEPHONY_QA_ENABLED = 'true';

      await callController.handleEvent({
        type: CallEventType.CALL_INITIATED,
        callId: 'v3:inbound_no_lease',
        direction: 'incoming',
        from: CALLER_CLI,
        to: QA_DID,
      });

      expect(mockProvider.hangupCall).toHaveBeenCalledWith('v3:inbound_no_lease');
      expect(mockPrisma.phoneNumber.findFirst).not.toHaveBeenCalled();
      expect(mockWalletService.reserveForCall).not.toHaveBeenCalled();
    });

    it('defense-in-depth: immediately hangs up call to QA workspace numbers lacking verified lease', async () => {
      // Inbound number is not the env TELNYX_QA_TRACKING_DID, but phoneNumber DB record belongs to QA_WORKSPACE
      const OTHER_QA_DID = '+14845560999';

      mockPrisma.phoneNumber.findFirst.mockResolvedValueOnce({
        id: 'phone_qa_ws_num',
        phone_number: OTHER_QA_DID,
        status: 'ACTIVE',
        workspace_id: QA_WORKSPACE,
        workspace: { id: QA_WORKSPACE, status: 'ACTIVE' },
        campaign_id: 'camp_qa',
        campaign: { id: 'camp_qa', status: 'ACTIVE' },
      });

      await callController.handleEvent({
        type: CallEventType.CALL_INITIATED,
        callId: 'v3:inbound_unauthorized_ws_call',
        direction: 'incoming',
        from: CALLER_CLI,
        to: OTHER_QA_DID,
      });

      expect(mockProvider.hangupCall).toHaveBeenCalledWith('v3:inbound_unauthorized_ws_call');
      expect(mockWalletService.reserveForCall).not.toHaveBeenCalled();
      expect(mockCallsService.createCall).not.toHaveBeenCalled();
    });

    describe('Task 1 Verification: Fail-Closed QA Ingress Matrix across 6 Boundary Conditions', () => {
      it('Condition 1: TELEPHONY_QA_ENABLED=false -> immediate hangup, zero DB call, zero wallet reserve', async () => {
        process.env.TELEPHONY_QA_ENABLED = 'false';

        await callController.handleEvent({
          type: CallEventType.CALL_INITIATED,
          callId: 'v3:cond_1_call',
          direction: 'incoming',
          from: CALLER_CLI,
          to: QA_DID,
        });

        expect(mockProvider.hangupCall).toHaveBeenCalledWith('v3:cond_1_call');
        expect(mockCallsService.createCall).not.toHaveBeenCalled();
        expect(mockPrisma.call.create).not.toHaveBeenCalled();
        expect(mockWalletService.reserveForCall).not.toHaveBeenCalled();
      });

      it('Condition 2: TELNYX_QA_TRACKING_DID missing from env -> immediate hangup, zero DB call, zero wallet reserve', async () => {
        process.env.TELEPHONY_QA_ENABLED = 'true';
        delete process.env.TELNYX_QA_TRACKING_DID;

        mockPrisma.phoneNumber.findFirst.mockResolvedValueOnce({
          id: 'phone_qa_1',
          phone_number: QA_DID,
          status: 'ACTIVE',
          workspace_id: QA_WORKSPACE,
          workspace: { id: QA_WORKSPACE, status: 'ACTIVE' },
          campaign_id: 'camp_qa',
          campaign: { id: 'camp_qa', status: 'ACTIVE' },
        });

        await callController.handleEvent({
          type: CallEventType.CALL_INITIATED,
          callId: 'v3:cond_2_call',
          direction: 'incoming',
          from: CALLER_CLI,
          to: QA_DID,
        });

        expect(mockProvider.hangupCall).toHaveBeenCalledWith('v3:cond_2_call');
        expect(mockCallsService.createCall).not.toHaveBeenCalled();
        expect(mockPrisma.call.create).not.toHaveBeenCalled();
        expect(mockWalletService.reserveForCall).not.toHaveBeenCalled();
      });

      it('Condition 3: TELNYX_QA_TRACKING_DID incorrect in env -> immediate hangup, zero DB call, zero wallet reserve', async () => {
        process.env.TELEPHONY_QA_ENABLED = 'true';
        process.env.TELNYX_QA_TRACKING_DID = '+15559998888'; // incorrect DID in env

        mockPrisma.phoneNumber.findFirst.mockResolvedValueOnce({
          id: 'phone_qa_1',
          phone_number: QA_DID,
          status: 'ACTIVE',
          workspace_id: QA_WORKSPACE,
          workspace: { id: QA_WORKSPACE, status: 'ACTIVE' },
          campaign_id: 'camp_qa',
          campaign: { id: 'camp_qa', status: 'ACTIVE' },
        });

        await callController.handleEvent({
          type: CallEventType.CALL_INITIATED,
          callId: 'v3:cond_3_call',
          direction: 'incoming',
          from: CALLER_CLI,
          to: QA_DID,
        });

        expect(mockProvider.hangupCall).toHaveBeenCalledWith('v3:cond_3_call');
        expect(mockCallsService.createCall).not.toHaveBeenCalled();
        expect(mockPrisma.call.create).not.toHaveBeenCalled();
        expect(mockWalletService.reserveForCall).not.toHaveBeenCalled();
      });

      it('Condition 4: QA PhoneNumber row inactive in DB -> immediate hangup, zero DB call, zero wallet reserve', async () => {
        process.env.TELEPHONY_QA_ENABLED = 'true';
        process.env.TELNYX_QA_TRACKING_DID = QA_DID;

        // Open a valid lease
        qaGuardService.registerActiveTestRun('run_cond_4');
        qaGuardService.openInboundTestLease({ runId: 'run_cond_4' });

        // PhoneNumber row in DB is INACTIVE
        mockPrisma.phoneNumber.findFirst.mockResolvedValueOnce({
          id: 'phone_qa_inactive',
          phone_number: QA_DID,
          status: 'INACTIVE',
          workspace_id: QA_WORKSPACE,
          workspace: { id: QA_WORKSPACE, status: 'ACTIVE' },
        });

        await callController.handleEvent({
          type: CallEventType.CALL_INITIATED,
          callId: 'v3:cond_4_call',
          direction: 'incoming',
          from: CALLER_CLI,
          to: QA_DID,
        });

        expect(mockProvider.hangupCall).toHaveBeenCalledWith('v3:cond_4_call');
        expect(mockCallsService.createCall).not.toHaveBeenCalled();
        expect(mockPrisma.call.create).not.toHaveBeenCalled();
        expect(mockWalletService.reserveForCall).not.toHaveBeenCalled();
      });

      it('Condition 5: QA workspace suspended in DB -> immediate hangup, zero DB call (no FAILED call), zero wallet reserve', async () => {
        process.env.TELEPHONY_QA_ENABLED = 'true';
        process.env.TELNYX_QA_TRACKING_DID = QA_DID;

        // Open a valid lease
        qaGuardService.registerActiveTestRun('run_cond_5');
        qaGuardService.openInboundTestLease({ runId: 'run_cond_5' });

        // Workspace is SUSPENDED
        mockPrisma.phoneNumber.findFirst.mockResolvedValueOnce({
          id: 'phone_qa_1',
          phone_number: QA_DID,
          status: 'ACTIVE',
          workspace_id: QA_WORKSPACE,
          workspace: { id: QA_WORKSPACE, status: 'SUSPENDED' },
          campaign_id: 'camp_qa',
          campaign: { id: 'camp_qa', status: 'ACTIVE' },
        });

        await callController.handleEvent({
          type: CallEventType.CALL_INITIATED,
          callId: 'v3:cond_5_call',
          direction: 'incoming',
          from: CALLER_CLI,
          to: QA_DID,
        });

        expect(mockProvider.hangupCall).toHaveBeenCalledWith('v3:cond_5_call');
        expect(mockCallsService.createCall).not.toHaveBeenCalled();
        expect(mockPrisma.call.create).not.toHaveBeenCalled();
        expect(mockWalletService.reserveForCall).not.toHaveBeenCalled();
      });

      it('Condition 6: Delayed inbound webhook arrives after QA shutdown -> immediate hangup, zero DB call, zero wallet reserve', async () => {
        // QA previously ran, now shutdown (disabled or expired)
        process.env.TELEPHONY_QA_ENABLED = 'false';
        qaGuardService.clearActiveTestRuns();

        await callController.handleEvent({
          type: CallEventType.CALL_INITIATED,
          callId: 'v3:cond_6_delayed_webhook',
          direction: 'incoming',
          from: CALLER_CLI,
          to: QA_DID,
        });

        expect(mockProvider.hangupCall).toHaveBeenCalledWith('v3:cond_6_delayed_webhook');
        expect(mockCallsService.createCall).not.toHaveBeenCalled();
        expect(mockPrisma.call.create).not.toHaveBeenCalled();
        expect(mockWalletService.reserveForCall).not.toHaveBeenCalled();
      });
    });
  });

  describe('2. Durable Billing Isolation across CallController Termination Paths', () => {
    it('handleCallerHangup on QA call: releases wallet reservation and bypasses usageBillingService', async () => {
      // Setup a bound QA call
      qaGuardService.registerActiveTestRun('run_bill_bypass');
      qaGuardService.bindCallToTestRun('call_qa_bill_1', 'run_bill_bypass');

      mockPrisma.call.findUnique.mockResolvedValueOnce({
        id: 'call_qa_bill_1',
        provider_call_id: 'v3:caller_qa_bill_1',
        workspace_id: QA_WORKSPACE,
        to_number: QA_DID,
        from_number: CALLER_CLI,
        state: CallState.ANSWERED,
        answered_at: new Date(Date.now() - 30000),
        ended_at: new Date(),
        duration_secs: 30,
        attempts: [],
      });

      mockCallsService.handleCallerHangup.mockResolvedValueOnce({
        id: 'call_qa_bill_1',
        provider_call_id: 'v3:caller_qa_bill_1',
        workspace_id: QA_WORKSPACE,
        to_number: QA_DID,
        from_number: CALLER_CLI,
        state: CallState.ANSWERED,
        answered_at: new Date(Date.now() - 30000),
        ended_at: new Date(),
        duration_secs: 30,
        attempts: [],
      });

      await callController.handleEvent({
        type: CallEventType.CALL_HANGUP,
        callId: 'v3:caller_qa_bill_1',
        direction: 'incoming',
      });

      // Wallet reservation was released directly without debit
      expect(mockWalletService.releaseReservation).toHaveBeenCalledWith(QA_WORKSPACE, 'call_qa_bill_1');

      // billCallUsage was NOT called
      expect(mockUsageBillingService.billCallUsage).not.toHaveBeenCalled();

      // Commercial evaluation was bypassed
      expect(mockCommercialEvaluator.evaluateCall).not.toHaveBeenCalled();
    });

    it('handleBuyerHangup (HANGUP_CALLER) on QA call: releases wallet reservation and bypasses usageBillingService', async () => {
      qaGuardService.registerActiveTestRun('run_buyer_hangup_bypass');
      qaGuardService.bindCallToTestRun('call_qa_buyer_bill_1', 'run_buyer_hangup_bypass');

      const callObj = {
        id: 'call_qa_buyer_bill_1',
        provider_call_id: 'v3:caller_qa_buyer_bill_1',
        workspace_id: QA_WORKSPACE,
        to_number: QA_DID,
        from_number: CALLER_CLI,
        state: CallState.ANSWERED,
        answered_at: new Date(Date.now() - 15000),
        ended_at: new Date(),
        duration_secs: 15,
        attempts: [],
      };

      const attemptObj = {
        id: 'att_buyer_1',
        call_id: 'call_qa_buyer_bill_1',
        provider_call_id: 'v3:buyer_leg_1',
        call: callObj,
      };

      mockPrisma.call.findUnique.mockResolvedValueOnce(null);
      mockPrisma.callAttempt.findUnique.mockResolvedValueOnce(attemptObj);

      mockCallsService.handleBuyerHangup.mockResolvedValueOnce({
        action: 'HANGUP_CALLER',
      });
      mockCallsService.handleCallerHangup.mockResolvedValueOnce(callObj);

      await callController.handleEvent({
        type: CallEventType.CALL_HANGUP,
        callId: 'v3:buyer_leg_1',
      });

      expect(mockWalletService.releaseReservation).toHaveBeenCalledWith(QA_WORKSPACE, 'call_qa_buyer_bill_1');
      expect(mockUsageBillingService.billCallUsage).not.toHaveBeenCalled();
      expect(mockCommercialEvaluator.evaluateCall).not.toHaveBeenCalled();
    });

    it('dialNextBuyer BUSY on QA call: releases wallet reservation and bypasses usageBillingService', async () => {
      qaGuardService.registerActiveTestRun('run_busy_bypass');
      qaGuardService.bindCallToTestRun('call_qa_busy_1', 'run_busy_bypass');

      mockCallsService.prepareNextBuyer.mockResolvedValueOnce({
        action: 'BUSY',
        call: {
          id: 'call_qa_busy_1',
          provider_call_id: 'v3:caller_busy_leg',
          workspace_id: QA_WORKSPACE,
          to_number: QA_DID,
        },
      });

      await (callController as any).dialNextBuyer({
        id: 'call_qa_busy_1',
        provider_call_id: 'v3:caller_busy_leg',
        workspace_id: QA_WORKSPACE,
        to_number: QA_DID,
      });

      expect(mockProvider.hangupCall).toHaveBeenCalledWith('v3:caller_busy_leg', 'BUSY');
      expect(mockWalletService.releaseReservation).toHaveBeenCalledWith(QA_WORKSPACE, 'call_qa_busy_1');
      expect(mockUsageBillingService.billCallUsage).not.toHaveBeenCalled();
    });

    it('dialNextBuyer HANGUP (exhaustion) on QA call: releases wallet reservation and bypasses usageBillingService', async () => {
      qaGuardService.registerActiveTestRun('run_hangup_bypass');
      qaGuardService.bindCallToTestRun('call_qa_hangup_1', 'run_hangup_bypass');

      mockCallsService.prepareNextBuyer.mockResolvedValueOnce({
        action: 'HANGUP',
        call: {
          id: 'call_qa_hangup_1',
          provider_call_id: 'v3:caller_hangup_leg',
          workspace_id: QA_WORKSPACE,
          to_number: QA_DID,
          state: CallState.ROUTING,
        },
      });

      await (callController as any).dialNextBuyer({
        id: 'call_qa_hangup_1',
        provider_call_id: 'v3:caller_hangup_leg',
        workspace_id: QA_WORKSPACE,
        to_number: QA_DID,
        state: CallState.ROUTING,
      });

      expect(mockProvider.hangupCall).toHaveBeenCalledWith('v3:caller_hangup_leg');
      expect(mockWalletService.releaseReservation).toHaveBeenCalledWith(QA_WORKSPACE, 'call_qa_hangup_1');
      expect(mockUsageBillingService.billCallUsage).not.toHaveBeenCalled();
    });
  });

  describe('3. UsageBillingService QA Workspace Bypass', () => {
    it('releases reservation without debiting when call belongs to QA_WORKSPACE_ID', async () => {
      const realUsageBilling = new UsageBillingService(mockPrisma, mockWalletService);

      const result = await realUsageBilling.billCallUsage(
        QA_WORKSPACE,
        'call_qa_in_usage_service',
        'local',
        120, // 2 minutes talk time
      );

      expect(result.billed).toBe(false);
      expect(result.reason).toContain('QA workspace call');
      expect(mockWalletService.releaseReservation).toHaveBeenCalledWith(
        QA_WORKSPACE,
        'call_qa_in_usage_service',
      );
      expect(mockWalletService.settleReservation).not.toHaveBeenCalled();
    });

    it('settles reservation normally for production workspace', async () => {
      const realUsageBilling = new UsageBillingService(mockPrisma, mockWalletService);

      const result = await realUsageBilling.billCallUsage(
        PROD_WORKSPACE,
        'call_prod_normal',
        'local',
        60, // 1 minute
      );

      expect(result.billed).toBe(true);
      expect(mockWalletService.settleReservation).toHaveBeenCalledWith(
        PROD_WORKSPACE,
        'call_prod_normal',
        expect.any(BigInt),
      );
    });
  });

  describe('4. ReservationRecoveryService QA Workspace Bypass', () => {
    it('sweeper releases reservation without debit when call belongs to QA_WORKSPACE_ID', async () => {
      const sweeper = new ReservationRecoveryService(
        mockPrisma,
        mockWalletService,
        mockUsageBillingService,
        mockProvider,
      );

      mockPrisma.call.findUnique.mockResolvedValueOnce({
        id: 'call_stale_qa_1',
        provider_call_id: 'v3:stale_qa_call',
        workspace_id: QA_WORKSPACE,
        to_number: QA_DID,
        state: 'COMPLETED',
        answered_at: new Date(Date.now() - 60000),
        ended_at: new Date(),
        callReservation: { status: 'ACTIVE' },
      });

      mockProvider.getCallStatus.mockResolvedValueOnce('TERMINAL');

      await (sweeper as any).reconcileReservation('call_stale_qa_1', QA_WORKSPACE);

      // Wallet reservation was released
      expect(mockWalletService.releaseReservation).toHaveBeenCalledWith(QA_WORKSPACE, 'call_stale_qa_1');

      // Buyer reservations released
      expect(mockPrisma.buyerReservation.updateMany).toHaveBeenCalledWith({
        where: { call_id: 'call_stale_qa_1', status: 'ACTIVE' },
        data: { status: 'RELEASED' },
      });

      // usageBillingService.billCallUsage was NOT called
      expect(mockUsageBillingService.billCallUsage).not.toHaveBeenCalled();
    });
  });
});
