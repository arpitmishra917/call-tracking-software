import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CallController } from '../call-controller.js';
import { CallEventType } from '../telephony.events.js';
import { QaTelephonyGuardService } from './qa-telephony-guard.service.js';
import { QaSipUriAdapterService } from './qa-sip-uri-adapter.service.js';
import { validateQaDatabaseTarget } from '../../../../../qa/provision-qa.js';
import { CallState, CallAttemptState } from '@prisma/client';

describe('QA Financial & Infrastructure Isolation Invariants', () => {
  let controller: CallController;
  let guardService: QaTelephonyGuardService;
  let sipAdapter: QaSipUriAdapterService;

  let mockCallsService: any;
  let mockProvider: any;
  let mockWalletService: any;
  let mockUsageService: any;
  let mockUsageBillingService: any;
  let mockCommercialEvaluatorService: any;
  let mockCampaignsService: any;
  let mockNumbersService: any;
  let mockWebhooksService: any;
  let mockPrisma: any;

  const originalEnv = { ...process.env };

  const QA_WORKSPACE_ID = '5e20bafe-7306-4da7-9944-62c4c5575a5a';
  const QA_TRACKING_DID = '+17252574041';
  const QA_BUYER_CLI = '+12025550199';
  const QA_SIP_URI = 'sip:arpitmishra9178@sip.telnyx.com';

  beforeEach(() => {
    guardService = new QaTelephonyGuardService();
    sipAdapter = new QaSipUriAdapterService(guardService);

    mockCallsService = {
      createCall: vi.fn().mockResolvedValue({ id: 'call_qa_fin_1', workspace_id: QA_WORKSPACE_ID }),
      updateCallStatus: vi.fn().mockResolvedValue({}),
      recordAttempt: vi.fn().mockResolvedValue({ id: 'att_qa_fin_1' }),
      updateAttempt: vi.fn().mockResolvedValue({}),
      prepareNextBuyer: vi.fn(),
      handleCallerHangup: vi.fn().mockResolvedValue({
        id: 'call_qa_fin_1',
        provider_call_id: 'v3:caller_qa_1',
        workspace_id: QA_WORKSPACE_ID,
        to_number: QA_TRACKING_DID,
        from_number: QA_BUYER_CLI,
        state: CallState.ANSWERED,
        duration_secs: 30,
        attempts: [],
      }),
      handleBuyerHangup: vi.fn().mockResolvedValue({
        action: 'HANGUP_CALLER',
        call: {
          id: 'call_qa_fin_1',
          provider_call_id: 'v3:caller_qa_1',
          workspace_id: QA_WORKSPACE_ID,
          duration_secs: 15,
        },
      }),
      releaseBuyerReservation: vi.fn().mockResolvedValue({}),
      commitBuyerDial: vi.fn().mockResolvedValue(false),
      transitionAttempt: vi.fn().mockResolvedValue({}),
      getCallById: vi.fn().mockResolvedValue({ id: 'call_qa_fin_1', workspace_id: QA_WORKSPACE_ID }),
      findAttemptByProviderCallId: vi.fn().mockResolvedValue({ id: 'att_qa_fin_1', call_id: 'call_qa_fin_1' }),
    };

    mockProvider = {
      answerCall: vi.fn().mockResolvedValue({}),
      dialBuyer: vi.fn().mockResolvedValue('v3:buyer_leg_fin_1'),
      bridgeCalls: vi.fn().mockResolvedValue({}),
      hangupCall: vi.fn().mockResolvedValue({}),
      transferCall: vi.fn().mockResolvedValue({}),
      speakText: vi.fn().mockResolvedValue({}),
      playAudio: vi.fn().mockResolvedValue({}),
    };

    mockWalletService = {
      reserveBalance: vi.fn().mockResolvedValue({ success: true, reservationId: 'res_qa_1' }),
      reserveForCall: vi.fn().mockResolvedValue({ reserved: true }),
      releaseReservation: vi.fn().mockResolvedValue({ success: true }),
      commitReservation: vi.fn().mockResolvedValue({ success: true }),
      settleReservation: vi.fn().mockResolvedValue({ settled: true }),
      debitWallet: vi.fn().mockResolvedValue({ success: true }),
      creditWallet: vi.fn().mockResolvedValue({ success: true }),
      extendReservationForCall: vi.fn().mockResolvedValue({ totalReservedMicro: 0, availableMicro: 0 }),
    };

    mockUsageService = {
      recordUsage: vi.fn().mockResolvedValue({}),
    };

    mockUsageBillingService = {
      billCallUsage: vi.fn().mockResolvedValue({ billed: true, costMicro: 0n }),
      calculateInitialReservation: vi.fn().mockReturnValue(100000),
    };

    mockCommercialEvaluatorService = {
      evaluateCall: vi.fn().mockResolvedValue({ evaluated: true }),
    };

    mockCampaignsService = {
      getCampaignById: vi.fn().mockResolvedValue({ id: 'camp_qa', workspace_id: QA_WORKSPACE_ID }),
    };

    mockNumbersService = {
      findByNumber: vi.fn().mockResolvedValue({
        number: QA_TRACKING_DID,
        campaign_id: 'camp_qa',
        campaign: { id: 'camp_qa', workspace_id: QA_WORKSPACE_ID, status: 'ACTIVE' },
        workspace_id: QA_WORKSPACE_ID,
      }),
    };

    mockWebhooksService = {
      publish: vi.fn().mockResolvedValue({}),
    };

    mockPrisma = {
      workspace: {
        findUnique: vi.fn().mockResolvedValue({ id: QA_WORKSPACE_ID, status: 'ACTIVE' }),
      },
      call: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'call_qa_fin_1',
          provider_call_id: 'v3:caller_qa_1',
          workspace_id: QA_WORKSPACE_ID,
          to_number: QA_TRACKING_DID,
          from_number: QA_BUYER_CLI,
          state: CallState.ANSWERED,
          duration_secs: 30,
          attempts: [],
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      callAttempt: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'att_qa_fin_1',
          call_id: 'call_qa_fin_1',
          provider_call_id: 'v3:buyer_qa_1',
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      phoneNumber: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'phone_qa_1',
          phone_number: QA_TRACKING_DID,
          workspace_id: QA_WORKSPACE_ID,
          status: 'ACTIVE',
        }),
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

    controller = new CallController(
      mockProvider,
      mockPrisma,
      mockCallsService,
      mockUsageService,
      mockUsageBillingService,
      mockWebhooksService,
      mockWalletService,
      mockCommercialEvaluatorService,
      guardService,
      sipAdapter,
    );

    process.env.TELEPHONY_QA_ENABLED = 'true';
    process.env.TELNYX_QA_TRACKING_DID = QA_TRACKING_DID;
    process.env.QA_WORKSPACE_ID = QA_WORKSPACE_ID;
    process.env.TELEPHONY_QA_BUYER_SIP_URI = QA_SIP_URI;
    process.env.TELEPHONY_QA_ALLOWED_DESTINATIONS = QA_BUYER_CLI;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    guardService.clearActiveTestRuns();
    process.env = { ...originalEnv };
  });

  describe('Financial Invariants: Zero Debit, Zero Billing, Zero Settlement for QA Calls', () => {
    it('bypasses commercial evaluation and usage billing upon call hangup', async () => {
      const runId = 'run_fin_hangup_1';
      guardService.registerActiveTestRun(runId, { secretToken: 'token_1' });
      guardService.bindCallToTestRun('call_qa_fin_1', runId);

      await controller.handleEvent({
        type: CallEventType.CALL_HANGUP,
        callId: 'v3:caller_qa_1',
        direction: 'incoming',
      });

      // Financial assertion 1: UsageBillingService.billCallUsage MUST NEVER be called
      expect(mockUsageBillingService.billCallUsage).not.toHaveBeenCalled();

      // Financial assertion 2: CommercialEvaluatorService.evaluateCall MUST NEVER be called
      expect(mockCommercialEvaluatorService.evaluateCall).not.toHaveBeenCalled();

      // Financial assertion 3: WalletService.commitReservation MUST NEVER be called
      expect(mockWalletService.commitReservation).not.toHaveBeenCalled();
      expect(mockWalletService.debitWallet).not.toHaveBeenCalled();

      // Financial assertion 4: WalletService.releaseReservation MUST be called to release any reservation with zero debit
      expect(mockWalletService.releaseReservation).toHaveBeenCalledWith(
        QA_WORKSPACE_ID,
        'call_qa_fin_1',
      );
    });

    it('bypasses billing and releases reservation without debit when buyer hangs up', async () => {
      const runId = 'run_fin_buyer_hangup_1';
      guardService.registerActiveTestRun(runId, { secretToken: 'token_2' });
      guardService.bindCallToTestRun('call_qa_fin_1', runId);

      const callObj = {
        id: 'call_qa_fin_1',
        provider_call_id: 'v3:caller_qa_1',
        workspace_id: QA_WORKSPACE_ID,
        to_number: QA_TRACKING_DID,
        from_number: QA_BUYER_CLI,
        state: CallState.ANSWERED,
        answered_at: new Date(Date.now() - 15000),
        ended_at: new Date(),
        duration_secs: 15,
        attempts: [],
      };

      const attemptObj = {
        id: 'att_qa_fin_1',
        call_id: 'call_qa_fin_1',
        provider_call_id: 'v3:buyer_qa_1',
        call: callObj,
      };

      mockPrisma.call.findUnique.mockResolvedValueOnce(null);
      mockPrisma.callAttempt.findUnique.mockResolvedValueOnce(attemptObj);

      mockCallsService.handleBuyerHangup.mockResolvedValueOnce({
        action: 'HANGUP_CALLER',
      });
      mockCallsService.handleCallerHangup.mockResolvedValueOnce(callObj);

      await controller.handleEvent({
        type: CallEventType.CALL_HANGUP,
        callId: 'v3:buyer_qa_1',
      });

      expect(mockUsageBillingService.billCallUsage).not.toHaveBeenCalled();
      expect(mockCommercialEvaluatorService.evaluateCall).not.toHaveBeenCalled();
      expect(mockWalletService.commitReservation).not.toHaveBeenCalled();
      expect(mockWalletService.releaseReservation).toHaveBeenCalledWith(
        QA_WORKSPACE_ID,
        'call_qa_fin_1',
      );
    });

    it('bypasses billing and releases reservation without debit when call is answered then busy', async () => {
      const runId = 'run_fin_busy_1';
      guardService.registerActiveTestRun(runId, { secretToken: 'token_3' });
      guardService.bindCallToTestRun('call_qa_fin_1', runId);

      // Mock all buyers busy
      mockCallsService.prepareNextBuyer.mockResolvedValueOnce({
        action: 'BUSY',
        call: { id: 'call_qa_fin_1', workspace_id: QA_WORKSPACE_ID },
      });

      await controller.dialNextBuyer(
        {
          id: 'call_qa_fin_1',
          provider_call_id: 'v3:caller_busy',
          workspace_id: QA_WORKSPACE_ID,
          to_number: QA_TRACKING_DID,
          from_number: '+15551234567',
        } as any,
        'conn_qa',
      );

      expect(mockUsageBillingService.billCallUsage).not.toHaveBeenCalled();
      expect(mockCommercialEvaluatorService.evaluateCall).not.toHaveBeenCalled();
      expect(mockWalletService.releaseReservation).toHaveBeenCalledWith(
        QA_WORKSPACE_ID,
        'call_qa_fin_1',
      );
    });
  });

  describe('Database Connection Isolation Invariants', () => {
    it('rejects remote Supabase database URLs in QA configuration validation', () => {
      expect(() =>
        validateQaDatabaseTarget('postgresql://postgres.uwycbvnqnpnfisvvbabu:pass@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres'),
      ).toThrow(/Production database pattern .* detected in DATABASE_URL/);
    });

    it('rejects database port 5432 (requires isolated QA port 5433)', () => {
      expect(() =>
        validateQaDatabaseTarget('postgresql://callflow_qa_user:pass@127.0.0.1:5432/callflow_qa'),
      ).toThrow(/Database port "5432" is not the isolated QA port 5433/);
    });

    it('accepts strictly local loopback database URLs (127.0.0.1:5433/callflow_qa)', () => {
      expect(() =>
        validateQaDatabaseTarget('postgresql://callflow_qa_user:pass@127.0.0.1:5433/callflow_qa'),
      ).not.toThrow();
    });
  });

  describe('Fail-Closed Live Carrier Protection Guards', () => {
    it('halts waterfall and never dials provider if buyer destination is not in TELEPHONY_QA_ALLOWED_DESTINATIONS', async () => {
      const runId = 'run_fin_unauth_dest';
      guardService.registerActiveTestRun(runId, { secretToken: 'token_unauth' });
      guardService.bindCallToTestRun('call_qa_fin_unauth', runId);

      const qaCallPrisma = {
        id: 'call_qa_fin_unauth',
        provider_call_id: 'v3:caller_leg_unauth',
        workspace_id: QA_WORKSPACE_ID,
        to_number: QA_TRACKING_DID,
        from_number: '+15551234567',
      };

      mockCallsService.prepareNextBuyer
        .mockResolvedValueOnce({
          action: 'DIAL',
          call: qaCallPrisma,
          attempt: { id: 'att_unauth_1' },
          buyer: { id: 'buyer_unauth_1', destination_number: '+19998887777' }, // Unauthorized
        })
        .mockResolvedValueOnce({
          action: 'NONE',
        });

      await controller.dialNextBuyer(qaCallPrisma as any, 'conn_qa');

      // QA guard rejected outbound dial -> provider.dialBuyer was NEVER invoked
      expect(mockProvider.dialBuyer).not.toHaveBeenCalled();

      // Reservation released and attempt transitioned to FAILED
      expect(mockCallsService.releaseBuyerReservation).toHaveBeenCalledWith('att_unauth_1');
      expect(mockCallsService.transitionAttempt).toHaveBeenCalledWith('att_unauth_1', CallAttemptState.FAILED);

      // Caller leg hung up immediately via circuit breaker
      expect(mockProvider.hangupCall).toHaveBeenCalledWith('v3:caller_leg_unauth');

      // prepareNextBuyer was called ONLY ONCE (circuit breaker halted recursion)
      expect(mockCallsService.prepareNextBuyer).toHaveBeenCalledTimes(1);
    });

    it('blocks logical QA buyer from being dialed when TELEPHONY_QA_ENABLED is false', async () => {
      process.env.TELEPHONY_QA_ENABLED = 'false';

      const prodCallPrisma = {
        id: 'call_prod_blocked_buyer',
        provider_call_id: 'v3:caller_leg_prod',
        workspace_id: QA_WORKSPACE_ID,
        to_number: QA_TRACKING_DID,
        from_number: '+15551234567',
      };

      mockCallsService.prepareNextBuyer
        .mockResolvedValueOnce({
          action: 'DIAL',
          call: prodCallPrisma,
          attempt: { id: 'att_blocked_1' },
          buyer: { id: 'buyer_qa', destination_number: QA_BUYER_CLI }, // +12025550199
        })
        .mockResolvedValueOnce({
          action: 'NONE',
        });

      await controller.dialNextBuyer(prodCallPrisma as any, 'conn_prod');

      // Provider was never dialed with logical QA buyer
      expect(mockProvider.dialBuyer).not.toHaveBeenCalled();
      expect(mockCallsService.releaseBuyerReservation).toHaveBeenCalledWith('att_blocked_1');
      expect(mockCallsService.transitionAttempt).toHaveBeenCalledWith('att_blocked_1', CallAttemptState.FAILED);
    });
  });
});
