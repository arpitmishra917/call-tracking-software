import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TelnyxWebhookController } from '../telnyx/telnyx.webhook.controller.js';
import { CallController } from '../call-controller.js';
import { QaTelephonyGuardService } from './qa-telephony-guard.service.js';
import { QaSipUriAdapterService } from './qa-sip-uri-adapter.service.js';
import { QaOrchestratorService } from './qa-orchestrator.service.js';
import { TelephonyProviderError, TelephonyErrorType } from '../telephony.errors.js';
import { CallEventType } from '../telephony.events.js';
import { BadRequestException } from '@nestjs/common';

describe('Phase 7B-10D: Live Integration Readiness & Regression Verification', () => {
  let webhookController: TelnyxWebhookController;
  let callController: CallController;
  let qaGuardService: QaTelephonyGuardService;
  let qaSipAdapter: QaSipUriAdapterService;
  let orchestrator: QaOrchestratorService;

  let mockProvider: any;
  let mockPrisma: any;
  let mockCallsService: any;
  let mockAriClient: any;
  let mockWsClient: any;
  let mockAudioAnalyzer: any;
  let mockIdempotency: any;
  let mockWalletService: any;

  const originalEnv = { ...process.env };

  const QA_DID = '+17252574041';
  const QA_CALLER_CLI = 'arpitmishra9178@sip.telnyx.com';
  const QA_WORKSPACE_ID = '5e20bafe-7306-4da7-9944-62c4c5575a5a';
  const QA_CONNECTION_ID = '3090207513618941231';
  const QA_BUYER_SIP = 'sip:arpitmishra9178@sip.telnyx.com';

  beforeEach(() => {
    qaGuardService = new QaTelephonyGuardService();
    qaSipAdapter = new QaSipUriAdapterService(qaGuardService);

    mockProvider = {
      answerCall: vi.fn().mockResolvedValue({}),
      hangupCall: vi.fn().mockResolvedValue({}),
      dialBuyer: vi.fn().mockResolvedValue('mock_buyer_call_id'),
      bridgeCalls: vi.fn().mockResolvedValue({}),
      getCallStatus: vi.fn().mockResolvedValue('TERMINAL'),
    };

    mockPrisma = {
      call: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'prisma_call_123', workspace_id: QA_WORKSPACE_ID }),
        update: vi.fn().mockResolvedValue({}),
      },
      callAttempt: {
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn().mockResolvedValue({}),
      },
      phoneNumber: {
        findFirst: vi.fn().mockImplementation(({ where }: any) => {
          if (where?.phone_number === QA_DID) {
            return Promise.resolve({
              id: 'pn_qa_1',
              phone_number: QA_DID,
              workspace_id: QA_WORKSPACE_ID,
              status: 'ACTIVE',
              workspace: { id: QA_WORKSPACE_ID, status: 'ACTIVE' },
              campaign: { id: 'camp_qa_1', status: 'ACTIVE' },
            });
          }
          return Promise.resolve(null);
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

    mockCallsService = {
      createCall: vi.fn().mockResolvedValue({ id: 'prisma_call_123', workspace_id: QA_WORKSPACE_ID }),
      handleCallerHangup: vi.fn(),
      handleBuyerHangup: vi.fn(),
      prepareNextBuyer: vi.fn(),
      commitBuyerDial: vi.fn().mockResolvedValue(false),
      transitionAttempt: vi.fn().mockResolvedValue({}),
      releaseBuyerReservation: vi.fn().mockResolvedValue({}),
    };

    mockWalletService = {
      reserveForCall: vi.fn().mockResolvedValue({ reserved: true }),
      releaseReservation: vi.fn().mockResolvedValue({ released: true }),
      settleReservation: vi.fn().mockResolvedValue({ settled: true }),
    };

    const mockUsageBillingService = {
      calculateInitialReservation: vi.fn().mockReturnValue(1000000n),
      billCallUsage: vi.fn().mockResolvedValue({ billed: false }),
    };

    callController = new CallController(
      mockProvider,
      mockPrisma,
      mockCallsService,
      { recordUsage: vi.fn() } as any,
      mockUsageBillingService as any,
      { dispatchWebhook: vi.fn() } as any,
      mockWalletService,
      { evaluateCall: vi.fn() } as any,
      qaGuardService,
      qaSipAdapter,
    );

    mockIdempotency = {
      acquireLock: vi.fn().mockResolvedValue({ canProcess: true, id: 'lock_1' }),
      markProcessed: vi.fn().mockResolvedValue(undefined),
      markFailed: vi.fn().mockResolvedValue(undefined),
      markIgnored: vi.fn().mockResolvedValue(undefined),
    };

    webhookController = new TelnyxWebhookController(callController, mockIdempotency);

    mockAriClient = {
      checkConnectivity: vi.fn().mockResolvedValue({ connected: true }),
      originateChannel: vi.fn().mockResolvedValue({ id: 'ari_caller_channel_1' }),
      getChannel: vi.fn().mockResolvedValue({ id: 'ari_caller_channel_1', state: 'Up' }),
      recordChannel: vi.fn().mockResolvedValue({}),
      playMedia: vi.fn().mockResolvedValue({}),
      stopRecording: vi.fn().mockResolvedValue({}),
      deleteStoredRecording: vi.fn().mockResolvedValue({}),
      hangupChannel: vi.fn().mockResolvedValue({}),
    };

    mockWsClient = {
      waitForEvent: vi.fn(),
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn(),
    };

    mockAudioAnalyzer = {
      analyzeMarkerRecording: vi.fn().mockResolvedValue({ detected: true, markerFrequencyHz: 1000 }),
    };

    orchestrator = new QaOrchestratorService(
      qaGuardService,
      qaSipAdapter,
      mockAriClient,
      mockAudioAnalyzer,
      mockWsClient as any,
      undefined,
      undefined,
      mockProvider,
    );
  });

  afterEach(() => {
    qaGuardService.clearActiveTestRuns();
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  describe('1. Webhook Signature & Ingress Gateway Authentication', () => {
    it('rejects unverified webhooks when TELNYX_PUBLIC_KEY is missing in QA environment', async () => {
      process.env.APP_ENV = 'qa';
      delete process.env.TELNYX_PUBLIC_KEY;

      const mockReq = {
        rawBody: Buffer.from(JSON.stringify({ event: 'test' })),
        body: { event: 'test' },
        headers: {
          'telnyx-signature-ed25519': 'fake-sig',
          'telnyx-timestamp': '123456789',
        },
      } as any;
      const mockRes = {
        status: vi.fn().mockReturnThis(),
        send: vi.fn(),
      } as any;

      await webhookController.handleWebhook(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.send).toHaveBeenCalledWith(
        expect.stringContaining('TELNYX_PUBLIC_KEY is required'),
      );
      // Prove it never reaches CallController or QaTelephonyGuardService
      expect(mockIdempotency.acquireLock).not.toHaveBeenCalled();
    });

    it('rejects webhooks with missing signature headers', async () => {
      const mockReq = {
        rawBody: Buffer.from('{}'),
        headers: {},
      } as any;
      const mockRes = { status: vi.fn().mockReturnThis(), send: vi.fn() } as any;

      await expect(webhookController.handleWebhook(mockReq, mockRes)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects forged cryptographic signatures with 400 Bad Request', async () => {
      process.env.TELNYX_PUBLIC_KEY = 'invalid_key';

      const mockReq = {
        rawBody: Buffer.from('{"data":{"event_type":"call.initiated"}}'),
        body: { data: { event_type: 'call.initiated' } },
        headers: {
          'telnyx-signature-ed25519': 'forged_signature',
          'telnyx-timestamp': '1700000000',
        },
      } as any;
      const mockRes = { status: vi.fn().mockReturnThis(), send: vi.fn() } as any;

      await webhookController.handleWebhook(mockReq, mockRes);
      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.send).toHaveBeenCalledWith(expect.stringContaining('Webhook Error:'));
      expect(mockIdempotency.acquireLock).not.toHaveBeenCalled();
    });
  });

  describe('2. Multi-Factor Correlation & Connection ID Gate', () => {
    it('verifies connection_id from payload against dedicated QA App ID', () => {
      process.env.TELEPHONY_QA_ENABLED = 'true';
      process.env.TELNYX_QA_TRACKING_DID = QA_DID;
      process.env.TELNYX_QA_CONNECTION_ID = QA_CONNECTION_ID;

      qaGuardService.registerActiveTestRun('run_conn_test');
      qaGuardService.openInboundTestLease({
        runId: 'run_conn_test',
        expectedCallerSipUri: QA_CALLER_CLI,
        expectedConnectionId: QA_CONNECTION_ID,
      });

      // Valid connection_id matches
      const match = qaGuardService.consumeInboundLease('call_conn_1', {
        to: QA_DID,
        from: QA_CALLER_CLI,
        connectionId: QA_CONNECTION_ID,
      });
      expect(match).not.toBeNull();
      expect(match?.runId).toBe('run_conn_test');
    });

    it('rejects lease consumption if connection_id is mismatched or forged', () => {
      process.env.TELEPHONY_QA_ENABLED = 'true';
      process.env.TELNYX_QA_TRACKING_DID = QA_DID;
      process.env.TELNYX_QA_CONNECTION_ID = QA_CONNECTION_ID;

      qaGuardService.registerActiveTestRun('run_conn_mismatch');
      qaGuardService.openInboundTestLease({
        runId: 'run_conn_mismatch',
        expectedCallerSipUri: QA_CALLER_CLI,
        expectedConnectionId: QA_CONNECTION_ID,
      });

      // Mismatched connection_id
      const match = qaGuardService.consumeInboundLease('call_conn_bad', {
        to: QA_DID,
        from: QA_CALLER_CLI,
        connectionId: 'unauthorized_connection_9999',
      });
      expect(match).toBeNull();
    });
  });

  describe('3. QA DID & Workspace Containment', () => {
    it('hangs up immediately when QA is disabled even if call targets QA DID', async () => {
      process.env.TELEPHONY_QA_ENABLED = 'false';
      process.env.TELNYX_QA_TRACKING_DID = QA_DID;

      await callController.handleEvent({
        type: CallEventType.CALL_INITIATED,
        callId: 'call_qa_disabled',
        direction: 'incoming',
        to: QA_DID,
        from: QA_CALLER_CLI,
        connectionId: QA_CONNECTION_ID,
        timestamp: new Date().toISOString(),
      });

      expect(mockProvider.hangupCall).toHaveBeenCalledWith('call_qa_disabled');
      expect(mockCallsService.createCall).not.toHaveBeenCalled();
      expect(mockWalletService.reserveForCall).not.toHaveBeenCalled();
    });

    it('hangs up immediately when QA DID call has no active lease', async () => {
      process.env.TELEPHONY_QA_ENABLED = 'true';
      process.env.TELNYX_QA_TRACKING_DID = QA_DID;
      process.env.TELNYX_QA_CALLER_ID = QA_CALLER_CLI;
      process.env.TELEPHONY_QA_ALLOWED_DESTINATIONS = '+12025550199';

      // No lease registered in qaGuardService
      await callController.handleEvent({
        type: CallEventType.CALL_INITIATED,
        callId: 'call_no_lease',
        direction: 'incoming',
        to: QA_DID,
        from: QA_CALLER_CLI,
        connectionId: QA_CONNECTION_ID,
        timestamp: new Date().toISOString(),
      });

      expect(mockProvider.hangupCall).toHaveBeenCalledWith('call_no_lease');
      expect(mockCallsService.createCall).not.toHaveBeenCalled();
    });

    it('hangs up immediately when QA workspace call has no verified QA binding', async () => {
      process.env.TELEPHONY_QA_ENABLED = 'true';
      process.env.TELNYX_QA_TRACKING_DID = QA_DID;
      process.env.TELNYX_QA_CALLER_ID = QA_CALLER_CLI;
      process.env.TELEPHONY_QA_ALLOWED_DESTINATIONS = '+12025550199';
      process.env.QA_WORKSPACE_ID = QA_WORKSPACE_ID;

      // Mock a non-QA DID that maps to the QA workspace
      mockPrisma.phoneNumber.findFirst.mockResolvedValueOnce({
        id: 'pn_other_ws',
        phone_number: '+15559991111',
        workspace_id: QA_WORKSPACE_ID,
        status: 'ACTIVE',
        workspace: { id: QA_WORKSPACE_ID, status: 'ACTIVE' },
        campaign: { id: 'camp_qa_1', status: 'ACTIVE' },
      });

      await callController.handleEvent({
        type: CallEventType.CALL_INITIATED,
        callId: 'call_unbound_workspace',
        direction: 'incoming',
        to: '+15559991111',
        from: QA_CALLER_CLI,
        connectionId: QA_CONNECTION_ID,
        timestamp: new Date().toISOString(),
      });

      expect(mockProvider.hangupCall).toHaveBeenCalledWith('call_unbound_workspace');
      expect(mockCallsService.createCall).not.toHaveBeenCalled();
    });
  });

  describe('4. Single-Use Lease Consumption & Replay Prevention', () => {
    it('prevents lease replay: consumed lease cannot be reused by another call', () => {
      process.env.TELEPHONY_QA_ENABLED = 'true';
      process.env.TELNYX_QA_TRACKING_DID = QA_DID;
      process.env.TELNYX_QA_CONNECTION_ID = QA_CONNECTION_ID;

      qaGuardService.registerActiveTestRun('run_replay_test');
      qaGuardService.openInboundTestLease({
        runId: 'run_replay_test',
        expectedCallerSipUri: QA_CALLER_CLI,
        expectedConnectionId: QA_CONNECTION_ID,
      });

      // First call consumes lease
      const match1 = qaGuardService.consumeInboundLease('call_1', {
        to: QA_DID,
        from: QA_CALLER_CLI,
        connectionId: QA_CONNECTION_ID,
      });
      expect(match1).not.toBeNull();
      expect(match1?.runId).toBe('run_replay_test');

      // Second identical call fails because lease is single-use
      const match2 = qaGuardService.consumeInboundLease('call_2_replay', {
        to: QA_DID,
        from: QA_CALLER_CLI,
        connectionId: QA_CONNECTION_ID,
      });
      expect(match2).toBeNull();
    });

    it('rejects expired lease', async () => {
      process.env.TELEPHONY_QA_ENABLED = 'true';
      process.env.TELNYX_QA_TRACKING_DID = QA_DID;
      process.env.TELNYX_QA_CONNECTION_ID = QA_CONNECTION_ID;

      qaGuardService.registerActiveTestRun('run_expired_test');
      qaGuardService.openInboundTestLease({
        runId: 'run_expired_test',
        expectedCallerSipUri: QA_CALLER_CLI,
        expectedConnectionId: QA_CONNECTION_ID,
        ttlMs: 50, // 50ms TTL
      });

      await new Promise((r) => setTimeout(r, 60));

      const match = qaGuardService.consumeInboundLease('call_expired', {
        to: QA_DID,
        from: QA_CALLER_CLI,
        connectionId: QA_CONNECTION_ID,
      });
      expect(match).toBeNull();
    });
  });

  describe('5. Buyer Routing & Zero PSTN Fallback', () => {
    beforeEach(() => {
      process.env.TELEPHONY_QA_ENABLED = 'true';
      process.env.TELEPHONY_QA_ALLOWED_DESTINATIONS = '+12025550199';
      process.env.TELEPHONY_QA_BUYER_SIP_URI = QA_BUYER_SIP;
      process.env.TELNYX_QA_TRACKING_DID = QA_DID;
      process.env.TELNYX_QA_CALLER_ID = QA_CALLER_CLI;

      qaGuardService.registerActiveTestRun('run_sip_routing');
      qaGuardService.bindCallToTestRun('call_qa_bound_sip', 'run_sip_routing');
    });

    it('resolves logical buyer destination exclusively to configured Telnyx SIP URI', () => {
      const resolved = qaSipAdapter.resolveBuyerDestination('+12025550199', { id: 'call_qa_bound_sip' });
      expect(resolved).toBe(QA_BUYER_SIP);
    });

    it('throws TelephonyProviderError without PSTN fallback when SIP URI is unset', () => {
      delete process.env.TELEPHONY_QA_BUYER_SIP_URI;

      expect(() => {
        qaSipAdapter.resolveBuyerDestination('+12025550199', { id: 'call_qa_bound_sip' });
      }).toThrowError(TelephonyProviderError);

      try {
        qaSipAdapter.resolveBuyerDestination('+12025550199', { id: 'call_qa_bound_sip' });
      } catch (err: any) {
        expect(err.type).toBe(TelephonyErrorType.ROUTING_FAILED);
        expect(err.message).toContain('not configured');
      }
    });

    it('throws TelephonyProviderError without PSTN fallback when SIP URI is malformed', () => {
      process.env.TELEPHONY_QA_BUYER_SIP_URI = 'not_a_sip_uri';

      expect(() => {
        qaSipAdapter.resolveBuyerDestination('+12025550199', { id: 'call_qa_bound_sip' });
      }).toThrowError(TelephonyProviderError);
    });

    it('passes X-QA-Run-Id SIP header when dialing buyer leg', async () => {
      mockCallsService.prepareNextBuyer.mockResolvedValueOnce({
        action: 'DIAL',
        call: {
          id: 'call_qa_bound_sip',
          provider_call_id: 'v3:caller_leg_1',
          workspace_id: QA_WORKSPACE_ID,
          to_number: QA_DID,
          from_number: QA_CALLER_CLI,
        },
        attempt: { id: 'att_qa_1' },
        buyer: { id: 'buyer_qa', destination_number: '+12025550199' },
      });

      await callController.dialNextBuyer(
        {
          id: 'call_qa_bound_sip',
          provider_call_id: 'v3:caller_leg_1',
          workspace_id: QA_WORKSPACE_ID,
          to_number: QA_DID,
          from_number: QA_CALLER_CLI,
        } as any,
        QA_CONNECTION_ID,
      );

      expect(mockProvider.dialBuyer).toHaveBeenCalledWith(
        QA_BUYER_SIP,
        QA_DID,
        QA_CONNECTION_ID,
        30,
        expect.any(String),
        expect.arrayContaining([
          expect.objectContaining({ name: 'X-QA-Run-Id', value: 'run_sip_routing' }),
        ]),
      );
    });
  });

  describe('6. ARI Recording Isolation & Cleanup Containment', () => {
    it('ensures caller and buyer recordings use disjoint runId-scoped names', async () => {
      process.env.TELEPHONY_QA_ENABLED = 'true';
      process.env.TELNYX_QA_TRACKING_DID = QA_DID;
      process.env.TELNYX_QA_CALLER_ID = '+17252574041';
      process.env.TELEPHONY_QA_ALLOWED_DESTINATIONS = '+12025550199';
      process.env.QA_WORKSPACE_ID = QA_WORKSPACE_ID;
      process.env.QA_CAMPAIGN_ID = '6af31407-3f46-4f1d-90d0-bf08af2e9600';
      process.env.TELEPHONY_QA_BUYER_SIP_URI = QA_BUYER_SIP;
      process.env.TELEPHONY_QA_RECORDING_CAPTURE_INTERVAL_MS = '10';

      let stasisCount = 0;
      mockWsClient.waitForEvent.mockImplementation(async (eventType: string, predicate: (e: any) => boolean) => {
        const activeRun = orchestrator.getActiveRunContext();
        const currentRunId = activeRun?.runId;
        if (eventType === 'StasisStart') {
          stasisCount++;
          if (stasisCount === 1) {
            return {
              type: 'StasisStart',
              channel: { id: 'ari_caller_channel_1', state: 'Up' },
              args: ['caller', currentRunId],
            };
          } else {
            return {
              type: 'StasisStart',
              channel: { id: 'ari_buyer_ch', state: 'Up' },
              args: ['buyer', currentRunId],
            };
          }
        }
        if (eventType === 'RecordingStarted') {
          const callerEvent = { recording: { name: `qa-caller-${currentRunId}`, target_uri: 'channel:ari_caller_channel_1' } };
          const buyerEvent = { recording: { name: `qa-buyer-${currentRunId}`, target_uri: 'channel:ari_buyer_ch' } };
          return predicate && predicate(callerEvent) ? callerEvent : buyerEvent;
        }
        if (eventType === 'PlaybackFinished') {
          const callerPb = { playback: { target_uri: 'channel:ari_caller_channel_1' } };
          const buyerPb = { playback: { target_uri: 'channel:ari_buyer_ch' } };
          return predicate && predicate(callerPb) ? callerPb : buyerPb;
        }
        if (eventType === 'RecordingFinished') {
          const callerFin = { recording: { name: `qa-caller-${currentRunId}`, target_uri: 'channel:ari_caller_channel_1' } };
          const buyerFin = { recording: { name: `qa-buyer-${currentRunId}`, target_uri: 'channel:ari_buyer_ch' } };
          return predicate && predicate(callerFin) ? callerFin : buyerFin;
        }
        return {};
      });

      const syntheticWav = Buffer.from(
        '524946462c00000057415645666d74201000000001000100401f0000803e00000200100064617461080000000100020003000400',
        'hex',
      );
      mockAriClient.getStoredRecordingFile = vi.fn().mockResolvedValue(syntheticWav);

      const result = await orchestrator.executeTestRun({
        trackingDid: QA_DID,
        callerCli: '+17252574041',
        postPlaybackCaptureMs: 50,
      });

      expect(result.context.callerRecordingName).toBe(`qa-caller-${result.runId}`);
      expect(result.context.buyerRecordingName).toBe(`qa-buyer-${result.runId}`);
      expect(result.context.callerRecordingName).not.toBe(result.context.buyerRecordingName);

      // Verify cleanup targets only the run's recordings and channels
      expect(mockAriClient.stopRecording).toHaveBeenCalledWith(`qa-caller-${result.runId}`);
      expect(mockAriClient.stopRecording).toHaveBeenCalledWith(`qa-buyer-${result.runId}`);
      expect(mockAriClient.deleteStoredRecording).toHaveBeenCalledWith(`qa-caller-${result.runId}`);
      expect(mockAriClient.deleteStoredRecording).toHaveBeenCalledWith(`qa-buyer-${result.runId}`);
      expect(mockAriClient.hangupChannel).toHaveBeenCalledWith('ari_caller_channel_1', 'normal');
      expect(mockAriClient.hangupChannel).toHaveBeenCalledWith('ari_buyer_ch', 'normal');
    });
  });

  describe('7. Durable Financial Isolation', () => {
    it('proves zero wallet reservation, zero debit, and zero commercial settlement on QA calls', async () => {
      process.env.TELEPHONY_QA_ENABLED = 'true';
      process.env.TELNYX_QA_TRACKING_DID = QA_DID;
      process.env.TELNYX_QA_CALLER_ID = QA_CALLER_CLI;
      process.env.TELEPHONY_QA_ALLOWED_DESTINATIONS = '+12025550199';
      process.env.QA_WORKSPACE_ID = QA_WORKSPACE_ID;
      process.env.QA_CAMPAIGN_ID = '6af31407-3f46-4f1d-90d0-bf08af2e9600';
      process.env.TELEPHONY_QA_BUYER_SIP_URI = QA_BUYER_SIP;

      qaGuardService.registerActiveTestRun('run_fin_iso');
      qaGuardService.openInboundTestLease({
        runId: 'run_fin_iso',
        expectedCallerSipUri: QA_CALLER_CLI,
        expectedConnectionId: QA_CONNECTION_ID,
      });

      // 1. Ingress CALL_INITIATED
      await callController.handleEvent({
        type: CallEventType.CALL_INITIATED,
        callId: 'call_fin_1',
        direction: 'incoming',
        to: QA_DID,
        from: QA_CALLER_CLI,
        connectionId: QA_CONNECTION_ID,
        timestamp: new Date().toISOString(),
      });

      // 2. Caller answered
      mockPrisma.call.findUnique.mockResolvedValueOnce({
        id: 'prisma_call_123',
        provider_call_id: 'call_fin_1',
        workspace_id: QA_WORKSPACE_ID,
      });

      await callController.handleEvent({
        type: CallEventType.CALL_ANSWERED,
        callId: 'call_fin_1',
        direction: 'incoming',
        timestamp: new Date().toISOString(),
      });

      // 3. Buyer answered
      mockPrisma.callAttempt.findUnique.mockResolvedValueOnce({
        id: 'att_fin_1',
        call_id: 'prisma_call_123',
        call: {
          id: 'prisma_call_123',
          provider_call_id: 'call_fin_1',
          workspace_id: QA_WORKSPACE_ID,
        },
      });

      await callController.handleEvent({
        type: CallEventType.CALL_ANSWERED,
        callId: 'buyer_leg_fin_1',
        direction: 'outgoing',
        timestamp: new Date().toISOString(),
      });

      // 4. Hangup
      mockPrisma.call.findUnique.mockResolvedValueOnce({
        id: 'prisma_call_123',
        provider_call_id: 'call_fin_1',
        workspace_id: QA_WORKSPACE_ID,
      });

      await callController.handleEvent({
        type: CallEventType.CALL_HANGUP,
        callId: 'call_fin_1',
        timestamp: new Date().toISOString(),
      });

      // Strict Financial Invariants:
      expect(mockWalletService.reserveForCall).not.toHaveBeenCalled();
      expect(mockWalletService.settleReservation).not.toHaveBeenCalled();
    });
  });
});
