import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CallController } from '../call-controller.js';
import { QaTelephonyGuardService } from './qa-telephony-guard.service.js';
import { QaSipUriAdapterService } from './qa-sip-uri-adapter.service.js';
import { CallAttemptState, CallState } from '@prisma/client';
import { CallEventType } from '../telephony.events.js';
import { TelephonyProviderError, TelephonyErrorType } from '../telephony.errors.js';

describe('QA Waterfall Circuit-Breaker Isolation', () => {
  let controller: CallController;
  let guardService: QaTelephonyGuardService;
  let adapterService: QaSipUriAdapterService;
  let mockProvider: any;
  let mockPrisma: any;
  let mockCallsService: any;
  let mockWalletService: any;
  let mockWebhooksService: any;

  const QA_TRACKING_DID = '+14845560110';
  const QA_CALLER_CLI = '+17207159445';
  const QA_ALLOWED_BUYER = '+12025550199'; // Logical QA Buyer
  const PROD_BUYER_PSTN = '+19195551234';  // Second Production Buyer in Campaign
  const VALID_TELNYX_SIP_URI = 'sip:arpitmishra9178@sip.telnyx.com';

  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.TELEPHONY_QA_ENABLED = 'true';
    process.env.TELEPHONY_QA_ALLOWED_DESTINATIONS = QA_ALLOWED_BUYER;
    process.env.TELEPHONY_QA_BUYER_SIP_URI = VALID_TELNYX_SIP_URI;
    process.env.TELNYX_QA_TRACKING_DID = QA_TRACKING_DID;
    process.env.TELNYX_QA_CALLER_ID = QA_CALLER_CLI;
    process.env.QA_WORKSPACE_ID = '550e8400-e29b-41d4-a716-446655440000';

    guardService = new QaTelephonyGuardService();
    adapterService = new QaSipUriAdapterService(guardService);

    mockProvider = {
      dialBuyer: vi.fn().mockResolvedValue('v3:buyer_leg_qa_123'),
      hangupCall: vi.fn().mockResolvedValue(undefined),
      startRingback: vi.fn().mockResolvedValue(undefined),
      stopRingback: vi.fn().mockResolvedValue(undefined),
      startRecording: vi.fn().mockResolvedValue(undefined),
      answerCall: vi.fn().mockResolvedValue(undefined),
    };

    mockPrisma = {
      call: { findUnique: vi.fn(), update: vi.fn().mockResolvedValue({}) },
      callAttempt: {
        findUnique: vi.fn().mockResolvedValue({ id: 'att_qa_1', state: CallAttemptState.INITIATED }),
      },
      phoneNumber: { findFirst: vi.fn().mockResolvedValue({ number_type: 'LOCAL' }) },
      blockedCaller: { findUnique: vi.fn().mockResolvedValue(null) },
    };

    mockCallsService = {
      createCall: vi.fn(),
      prepareNextBuyer: vi.fn(),
      commitBuyerDial: vi.fn().mockResolvedValue(false),
      releaseBuyerReservation: vi.fn().mockResolvedValue(undefined),
      transitionAttempt: vi.fn().mockResolvedValue(undefined),
      handleBuyerHangup: vi.fn(),
      handleCallerHangup: vi.fn().mockResolvedValue({ id: 'call_qa_cb_1', ended_at: new Date() }),
    };

    mockWalletService = {
      reserveForCall: vi.fn().mockResolvedValue(true),
      releaseReservation: vi.fn().mockResolvedValue(undefined),
    };

    mockWebhooksService = {
      queueEvent: vi.fn().mockResolvedValue(undefined),
    };

    controller = new CallController(
      mockProvider,
      mockPrisma,
      mockCallsService,
      {} as any, // usageService
      { calculateInitialReservation: vi.fn(), billCallUsage: vi.fn().mockResolvedValue(undefined) } as any, // usageBillingService
      mockWebhooksService, // webhooksService
      mockWalletService, // walletService
      undefined, // commercialEvaluatorService
      guardService, // qaGuardService
      adapterService, // qaSipAdapter
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    guardService.clearActiveTestRuns();
    process.env = { ...originalEnv };
  });

  describe('Scenario 1: QA Buyer Leg Provider Rejection / Dial Failure', () => {
    it('releases reservation, transitions attempt to FAILED, hangs up caller, and NEVER evaluates second buyer', async () => {
      guardService.registerActiveTestRun('run_cb_1');
      guardService.bindCallToTestRun('call_qa_cb_1', 'run_cb_1');

      const qaCallPrisma = {
        id: 'call_qa_cb_1',
        provider_call_id: 'v3:caller_leg_qa_999',
        workspace_id: 'ws_1',
        to_number: QA_TRACKING_DID,
        from_number: QA_CALLER_CLI,
      };

      // Campaign contains 2 buyers: Buyer 1 (QA), Buyer 2 (Production)
      mockCallsService.prepareNextBuyer
        .mockResolvedValueOnce({
          action: 'DIAL',
          call: qaCallPrisma,
          attempt: { id: 'att_qa_1' },
          buyer: { id: 'buyer_qa_1', destination_number: QA_ALLOWED_BUYER },
        })
        .mockResolvedValueOnce({
          // Second buyer in campaign: MUST NEVER BE REACHED
          action: 'DIAL',
          call: qaCallPrisma,
          attempt: { id: 'att_prod_2' },
          buyer: { id: 'buyer_prod_2', destination_number: PROD_BUYER_PSTN },
        });

      // Provider rejects the dial (e.g., Telnyx 503 or network error)
      mockProvider.dialBuyer.mockRejectedValueOnce(new Error('Telnyx SIP trunk network timeout'));

      await controller.dialNextBuyer(qaCallPrisma as any, 'conn_qa');

      // 1. QA Attempt 1 reservation is released
      expect(mockCallsService.releaseBuyerReservation).toHaveBeenCalledWith('att_qa_1');
      // 2. QA Attempt 1 transitioned to FAILED
      expect(mockCallsService.transitionAttempt).toHaveBeenCalledWith(
        'att_qa_1',
        CallAttemptState.FAILED,
      );
      // 3. QA Caller leg hung up immediately
      expect(mockProvider.hangupCall).toHaveBeenCalledWith('v3:caller_leg_qa_999');
      // 4. Circuit-breaker halted recursion: prepareNextBuyer was called ONLY ONCE
      expect(mockCallsService.prepareNextBuyer).toHaveBeenCalledTimes(1);
      // 5. Production buyer was never dialed
      expect(mockProvider.dialBuyer).toHaveBeenCalledTimes(1); // Only the first QA attempt
      expect(mockProvider.dialBuyer).not.toHaveBeenCalledWith(
        expect.stringContaining(PROD_BUYER_PSTN),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
      );
      // 6. Call binding released from registry
      expect(guardService.isCallBound('call_qa_cb_1')).toBe(false);
    });
  });

  describe('Scenario 2: QA SIP URI Resolution Failure', () => {
    it('fails closed, releases reservation, hangs up caller, and NEVER advances to second buyer', async () => {
      guardService.registerActiveTestRun('run_cb_2');
      guardService.bindCallToTestRun('call_qa_cb_2', 'run_cb_2');

      const qaCallPrisma = {
        id: 'call_qa_cb_2',
        provider_call_id: 'v3:caller_leg_qa_888',
        workspace_id: 'ws_1',
        to_number: QA_TRACKING_DID,
        from_number: QA_CALLER_CLI,
      };

      // Unset buyer SIP URI to trigger resolution failure
      delete process.env.TELEPHONY_QA_BUYER_SIP_URI;

      mockCallsService.prepareNextBuyer
        .mockResolvedValueOnce({
          action: 'DIAL',
          call: qaCallPrisma,
          attempt: { id: 'att_qa_res_fail' },
          buyer: { id: 'buyer_qa_1', destination_number: QA_ALLOWED_BUYER },
        })
        .mockResolvedValueOnce({
          action: 'DIAL',
          call: qaCallPrisma,
          attempt: { id: 'att_prod_2' },
          buyer: { id: 'buyer_prod_2', destination_number: PROD_BUYER_PSTN },
        });

      await controller.dialNextBuyer(qaCallPrisma as any, 'conn_qa');

      // Provider dialBuyer NEVER called because resolution failed
      expect(mockProvider.dialBuyer).not.toHaveBeenCalled();
      // Reservation released and attempt marked FAILED
      expect(mockCallsService.releaseBuyerReservation).toHaveBeenCalledWith('att_qa_res_fail');
      expect(mockCallsService.transitionAttempt).toHaveBeenCalledWith(
        'att_qa_res_fail',
        CallAttemptState.FAILED,
      );
      // Caller leg terminated immediately
      expect(mockProvider.hangupCall).toHaveBeenCalledWith('v3:caller_leg_qa_888');
      // Prepare next buyer called only once
      expect(mockCallsService.prepareNextBuyer).toHaveBeenCalledTimes(1);
    });
  });

  describe('Scenario 3: QA Buyer Timeout / No Answer / Hangup', () => {
    it('activates circuit-breaker on handleBuyerHangup DIAL_NEXT, hangs up caller, and NEVER dials second buyer', async () => {
      guardService.registerActiveTestRun('run_cb_3');
      guardService.bindCallToTestRun('call_qa_cb_3', 'run_cb_3');

      const qaCallPrisma = {
        id: 'call_qa_cb_3',
        provider_call_id: 'v3:caller_leg_qa_777',
        workspace_id: 'ws_1',
        to_number: QA_TRACKING_DID,
        from_number: QA_CALLER_CLI,
        state: CallState.ROUTING,
      };

      const buyerAttempt = {
        id: 'att_qa_timeout',
        provider_call_id: 'v3:buyer_leg_timeout',
        call_id: 'call_qa_cb_3',
        state: CallAttemptState.RINGING,
        call: qaCallPrisma,
      };

      mockPrisma.call.findUnique.mockResolvedValue(null);
      mockPrisma.callAttempt.findUnique.mockResolvedValue(buyerAttempt);

      // Buyer leg times out -> handleBuyerHangup returns DIAL_NEXT
      mockCallsService.handleBuyerHangup.mockResolvedValueOnce({
        action: 'DIAL_NEXT',
        call: qaCallPrisma,
      });

      // Telnyx sends CALL_HANGUP event for buyer leg
      await controller.handleEvent({
        type: CallEventType.CALL_HANGUP,
        callId: 'v3:buyer_leg_timeout',
        hangupCause: 'TIMEOUT',
        timestamp: new Date().toISOString(),
      });

      // 1. Caller leg terminated immediately
      expect(mockProvider.hangupCall).toHaveBeenCalledWith('v3:caller_leg_qa_777');
      // 2. dialNextBuyer was NOT called to advance to second buyer
      expect(mockCallsService.prepareNextBuyer).not.toHaveBeenCalled();
      // 3. Provider never dialed second buyer
      expect(mockProvider.dialBuyer).not.toHaveBeenCalled();
      // 4. Call binding released from registry
      expect(guardService.isCallBound('call_qa_cb_3')).toBe(false);
    });
  });

  describe('Scenario 4: Production Waterfall Regression Integrity', () => {
    it('continues advancing to second buyer when call is a standard production call', async () => {
      // Normal production call (unregistered call ID)
      const prodCallPrisma = {
        id: 'call_prod_normal_1',
        provider_call_id: 'v3:caller_leg_prod_1',
        workspace_id: 'ws_prod',
        to_number: '+15551110000',
        from_number: '+15552220000',
        state: CallState.ROUTING,
      };

      // First buyer fails, second buyer succeeds
      mockCallsService.prepareNextBuyer
        .mockResolvedValueOnce({
          action: 'DIAL',
          call: prodCallPrisma,
          attempt: { id: 'att_prod_1' },
          buyer: { id: 'buyer_prod_1', destination_number: '+15553330001' },
        })
        .mockResolvedValueOnce({
          action: 'DIAL',
          call: prodCallPrisma,
          attempt: { id: 'att_prod_2' },
          buyer: { id: 'buyer_prod_2', destination_number: '+15553330002' },
        });

      // First dial throws error
      mockProvider.dialBuyer
        .mockRejectedValueOnce(new Error('Buyer 1 busy'))
        .mockResolvedValueOnce('v3:buyer_leg_prod_2');

      await controller.dialNextBuyer(prodCallPrisma as any, 'conn_prod');

      // Production waterfall cascaded through both buyers
      expect(mockCallsService.prepareNextBuyer).toHaveBeenCalledTimes(2);
      expect(mockProvider.dialBuyer).toHaveBeenCalledTimes(2);
      expect(mockProvider.dialBuyer).toHaveBeenNthCalledWith(
        1,
        '+15553330001',
        '+15551110000',
        'conn_prod',
        30,
        expect.any(String),
        undefined,
      );
      expect(mockProvider.dialBuyer).toHaveBeenNthCalledWith(
        2,
        '+15553330002',
        '+15551110000',
        'conn_prod',
        30,
        expect.any(String),
        undefined,
      );
      // Caller leg was NOT hung up because second buyer was dialed successfully
      expect(mockProvider.hangupCall).not.toHaveBeenCalledWith('v3:caller_leg_prod_1');
    });
  });
  describe('Scenario 5: Inbound CALL_INITIATED Dedicated QA Ingress Candidate Gate', () => {
    it('terminates call immediately if dedicated QA ingress has no active lease (fails closed)', async () => {
      // Unregistered incoming call to QA tracking DID
      await controller.handleEvent({
        type: CallEventType.CALL_INITIATED,
        callId: 'v3:unregistered_qa_ingress_call',
        direction: 'incoming',
        to: QA_TRACKING_DID,
        from: QA_CALLER_CLI,
        timestamp: new Date().toISOString(),
      });

      // Provider hangupCall MUST have been called immediately
      expect(mockProvider.hangupCall).toHaveBeenCalledWith('v3:unregistered_qa_ingress_call');
      // CallsService.createCall MUST NOT have been called
      expect(mockCallsService.createCall).not.toHaveBeenCalled();
      // Provider answerCall MUST NOT have been called
      expect(mockProvider.answerCall).not.toHaveBeenCalled();
      // PrepareNextBuyer MUST NOT have been called
      expect(mockCallsService.prepareNextBuyer).not.toHaveBeenCalled();
      // No buyer dial
      expect(mockProvider.dialBuyer).not.toHaveBeenCalled();
    });

    it('terminates call immediately if dedicated QA ingress provides invalid token', async () => {
      guardService.registerActiveTestRun('run_token_gate');
      guardService.openInboundTestLease({
        runId: 'run_token_gate',
        secretToken: 'valid_expected_token_abc',
      });

      await controller.handleEvent({
        type: CallEventType.CALL_INITIATED,
        callId: 'v3:bad_token_call',
        direction: 'incoming',
        to: QA_TRACKING_DID,
        from: QA_CALLER_CLI,
        clientState: 'invalid_token_xyz',
        timestamp: new Date().toISOString(),
      });

      // Rejected immediately
      expect(mockProvider.hangupCall).toHaveBeenCalledWith('v3:bad_token_call');
      expect(mockCallsService.createCall).not.toHaveBeenCalled();
      expect(mockProvider.dialBuyer).not.toHaveBeenCalled();
    });

    it('accepts call, creates DB call, binds call ID, and answers when valid lease exists', async () => {
      guardService.registerActiveTestRun('run_valid_ingress');
      guardService.openInboundTestLease({
        runId: 'run_valid_ingress',
        expectedCallerCli: QA_CALLER_CLI,
      });

      mockCallsService.createCall = vi.fn().mockResolvedValue({
        id: 'call_valid_qa_uuid',
        workspace_id: 'ws_1',
        provider_call_id: 'v3:valid_qa_call_leg',
        to_number: QA_TRACKING_DID,
        from_number: QA_CALLER_CLI,
      });

      mockPrisma.phoneNumber.findFirst.mockResolvedValueOnce({
        id: 'phone_num_1',
        phone_number: QA_TRACKING_DID,
        workspace_id: 'ws_1',
        campaign_id: 'camp_1',
        number_type: 'LOCAL',
        workspace: { status: 'ACTIVE' },
        campaign: { status: 'ACTIVE' },
      });
      mockPrisma.blockedCaller = { findUnique: vi.fn().mockResolvedValue(null) };

      await controller.handleEvent({
        type: CallEventType.CALL_INITIATED,
        callId: 'v3:valid_qa_call_leg',
        direction: 'incoming',
        to: QA_TRACKING_DID,
        from: QA_CALLER_CLI,
        timestamp: new Date().toISOString(),
      });

      // Did not hang up
      expect(mockProvider.hangupCall).not.toHaveBeenCalled();
      // Call created and answered
      expect(mockCallsService.createCall).toHaveBeenCalled();
      expect(mockProvider.answerCall).toHaveBeenCalledWith('v3:valid_qa_call_leg');
      // Both provider call ID and Prisma UUID are bound in registry
      expect(guardService.isCallBound('v3:valid_qa_call_leg')).toBe(true);
      expect(guardService.isCallBound('call_valid_qa_uuid')).toBe(true);
    });

    it('allows ordinary production ingress calls without QA lease checks', async () => {
      const prodDid = '+18883164519';
      mockCallsService.createCall = vi.fn().mockResolvedValue({
        id: 'call_prod_uuid_normal',
        workspace_id: 'ws_prod',
        provider_call_id: 'v3:prod_call_leg_normal',
        to_number: prodDid,
        from_number: '+15552220000',
      });

      mockPrisma.phoneNumber.findFirst.mockResolvedValueOnce({
        id: 'phone_num_prod',
        phone_number: prodDid,
        workspace_id: 'ws_prod',
        campaign_id: 'camp_prod',
        number_type: 'TOLL_FREE',
        workspace: { status: 'ACTIVE' },
        campaign: { status: 'ACTIVE' },
      });
      mockPrisma.blockedCaller = { findUnique: vi.fn().mockResolvedValue(null) };

      await controller.handleEvent({
        type: CallEventType.CALL_INITIATED,
        callId: 'v3:prod_call_leg_normal',
        direction: 'incoming',
        to: prodDid,
        from: '+15552220000',
        timestamp: new Date().toISOString(),
      });

      // Did not reject
      expect(mockProvider.hangupCall).not.toHaveBeenCalled();
      // Production call created and answered normally
      expect(mockCallsService.createCall).toHaveBeenCalled();
      expect(mockProvider.answerCall).toHaveBeenCalledWith('v3:prod_call_leg_normal');
      // Not registered as QA
      expect(guardService.isCallBound('call_prod_uuid_normal')).toBe(false);
    });
  });

});
