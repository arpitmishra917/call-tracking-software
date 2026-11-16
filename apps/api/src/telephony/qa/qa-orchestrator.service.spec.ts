import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { QaOrchestratorService } from './qa-orchestrator.service.js';
import { QaTelephonyGuardService } from './qa-telephony-guard.service.js';
import { QaSipUriAdapterService } from './qa-sip-uri-adapter.service.js';
import { AsteriskAriClientService, AsteriskAriError } from './asterisk-ari-client.service.js';
import { QaAudioAnalyzerService } from './qa-audio-analyzer.service.js';
import { AriWebSocketClientService, StasisStartEvent, RecordingStartedEvent, PlaybackFinishedEvent, RecordingFinishedEvent } from './ari-websocket-client.service.js';
import { TelephonyProviderError, TelephonyErrorType } from '../telephony.errors.js';

describe('QaOrchestratorService', () => {
  let orchestrator: QaOrchestratorService;
  let guardService: QaTelephonyGuardService;
  let sipAdapter: QaSipUriAdapterService;
  let ariClient: AsteriskAriClientService;
  let audioAnalyzer: QaAudioAnalyzerService;
  let mockWsClient: any;
  let mockWalletService: any;
  let mockProvider: any;

  const originalEnv = { ...process.env };

  const QA_DID = '+14845560110';
  const QA_WORKSPACE = '550e8400-e29b-41d4-a716-446655440000';
  const QA_SIP_URI = 'sip:arpitmishra9178@sip.telnyx.com';

  beforeEach(() => {
    guardService = new QaTelephonyGuardService();
    sipAdapter = new QaSipUriAdapterService(guardService);
    ariClient = new AsteriskAriClientService();
    audioAnalyzer = new QaAudioAnalyzerService();

    mockWsClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      waitForEvent: vi.fn(),
      isConnected: vi.fn().mockReturnValue(true),
      getWebSocketUrl: vi.fn().mockReturnValue('ws://127.0.0.1:8088/ari/events'),
      sanitize: vi.fn((s: string) => s),
      on: vi.fn().mockReturnValue(() => {}),
      handleRawMessage: vi.fn(),
      onModuleDestroy: vi.fn(),
      cancelPendingWaiters: vi.fn(),
      clearAllEventListeners: vi.fn(),
    };

    mockWalletService = {
      releaseReservation: vi.fn().mockResolvedValue({ success: true }),
    };

    mockProvider = {
      hangupCall: vi.fn().mockResolvedValue({}),
    };

    orchestrator = new QaOrchestratorService(
      guardService,
      sipAdapter,
      ariClient,
      audioAnalyzer,
      mockWsClient as any,
      undefined, // prisma
      mockWalletService,
      mockProvider,
    );

    process.env.TELEPHONY_QA_ENABLED = 'true';
    process.env.TELNYX_QA_TRACKING_DID = QA_DID;
    process.env.QA_WORKSPACE_ID = QA_WORKSPACE;
    process.env.TELEPHONY_QA_BUYER_SIP_URI = QA_SIP_URI;
    process.env.TELEPHONY_QA_ARI_URL = 'http://127.0.0.1:8088';
    process.env.TELEPHONY_QA_ARI_USERNAME = 'asterisk';
    process.env.TELEPHONY_QA_ARI_PASSWORD = 'password';
    process.env.TELEPHONY_QA_RECORDING_CAPTURE_INTERVAL_MS = '10';

    vi.spyOn(ariClient, 'snoopChannel').mockImplementation(async (channelId, options) => {
      const isCaller = options?.appArgs?.includes('caller');
      return {
        id: isCaller ? 'snoop_ch_caller' : 'snoop_ch_buyer',
        name: isCaller ? 'snoop_caller' : 'snoop_buyer',
        state: 'Up',
      };
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    guardService.clearActiveTestRuns();
    process.env = { ...originalEnv };
  });

  describe('Single-Concurrency Mutex Enforcement', () => {
    it('allows a single QA test run and rejects concurrent execution', async () => {
      vi.spyOn(ariClient, 'checkConnectivity').mockResolvedValue({
        connected: true,
        latencyMs: 5,
        version: 'Asterisk 20.21.0',
      });
      vi.spyOn(ariClient, 'originateChannel').mockResolvedValue({
        id: 'ari_ch_123',
        name: 'PJSIP/telnyx-0001',
        state: 'Up',
      });
      vi.spyOn(ariClient, 'hangupChannel').mockResolvedValue();

      // Mock WebSocket events for caller & buyer Stasis
      mockWsClient.waitForEvent.mockImplementation(async (eventType: string, predicate: (e: any) => boolean) => {
        if (eventType === 'StasisStart') {
          return {
            type: 'StasisStart',
            application: 'callflow-qa',
            timestamp: new Date().toISOString(),
            channel: { id: 'ch_test', name: 'PJSIP/test', state: 'Up' },
            args: ['caller', orchestrator.getActiveRunContext()?.runId || ''],
          };
        }
        return {};
      });

      expect(orchestrator.isRunActive()).toBe(false);

      // Create a delayed originate promise to test concurrent rejection
      let completeOriginate: (val: any) => void;
      const originatePromise = new Promise((resolve) => {
        completeOriginate = resolve;
      });
      vi.spyOn(ariClient, 'originateChannel').mockImplementationOnce(() => originatePromise as any);

      // Start run 1
      const run1Promise = orchestrator.executeTestRun({ skipMediaAnalysis: true });

      // Run 1 is now active
      expect(orchestrator.isRunActive()).toBe(true);

      // Attempt concurrent run 2 -> Must be rejected immediately
      await expect(orchestrator.executeTestRun({ skipMediaAnalysis: true })).rejects.toThrowError(
        TelephonyProviderError,
      );

      try {
        await orchestrator.executeTestRun();
      } catch (err: any) {
        expect(err.type).toBe(TelephonyErrorType.INVALID_CALL_STATE);
        expect(err.message).toContain('Concurrent QA run rejected');
      }

      // Complete run 1
      completeOriginate!({
        id: 'ari_ch_concurrent_done',
        name: 'PJSIP/telnyx-0002',
        state: 'Up',
      });
      const result1 = await run1Promise;
      expect(result1.success).toBe(true);

      // Mutex released
      expect(orchestrator.isRunActive()).toBe(false);
    });
  });

  describe('Pre-flight Validation & Fail-Closed Behavior', () => {
    it('fails closed when TELEPHONY_QA_ENABLED is false', async () => {
      process.env.TELEPHONY_QA_ENABLED = 'false';

      await expect(orchestrator.executeTestRun()).rejects.toThrowError(TelephonyProviderError);
      expect(orchestrator.isRunActive()).toBe(false);
    });

    it('fails closed when QA configuration is invalid', async () => {
      delete process.env.QA_WORKSPACE_ID; // Invalid config

      await expect(orchestrator.executeTestRun()).rejects.toThrowError(/QA configuration validation failed/);
      expect(orchestrator.isRunActive()).toBe(false);
    });

    it('fails closed and cleans up when Asterisk ARI connectivity fails', async () => {
      vi.spyOn(ariClient, 'checkConnectivity').mockResolvedValue({
        connected: false,
        error: 'Connection refused at 127.0.0.1:8088',
      });

      const result = await orchestrator.executeTestRun();
      expect(result.success).toBe(false);
      expect(result.error).toContain('Asterisk ARI connectivity check failed');
      expect(result.cleanupSummary.testRunUnregistered).toBe(true);
      expect(result.cleanupSummary.webSocketDisconnected).toBe(true);
      expect(orchestrator.isRunActive()).toBe(false);
    });

    it('fails closed and cleans up when ARI WebSocket connection fails', async () => {
      mockWsClient.connect.mockRejectedValueOnce(new Error('WebSocket handshake 401 Unauthorized'));

      const result = await orchestrator.executeTestRun();
      expect(result.success).toBe(false);
      expect(result.error).toContain('WebSocket handshake 401 Unauthorized');
      expect(result.cleanupSummary.testRunUnregistered).toBe(true);
      expect(orchestrator.isRunActive()).toBe(false);
    });
  });

  describe('Channel State Verification & Correlation', () => {
    it('fails closed when caller channel enters Stasis with non-Up state', async () => {
      vi.spyOn(ariClient, 'checkConnectivity').mockResolvedValue({ connected: true });
      vi.spyOn(ariClient, 'originateChannel').mockResolvedValue({
        id: 'ari_ch_ringing',
        name: 'PJSIP/telnyx-ring',
        state: 'Ringing',
      });
      vi.spyOn(ariClient, 'getChannel').mockResolvedValue({
        id: 'ari_ch_ringing',
        name: 'PJSIP/telnyx-ring',
        state: 'Ring',
      } as any);
      vi.spyOn(ariClient, 'hangupChannel').mockResolvedValue();

      mockWsClient.waitForEvent.mockImplementation(async (eventType: string) => {
        if (eventType === 'StasisStart') {
          return {
            type: 'StasisStart',
            channel: { id: 'ari_ch_ringing', state: 'Ring' },
            args: ['caller', orchestrator.getActiveRunContext()?.runId],
          };
        }
        return {};
      });

      const result = await orchestrator.executeTestRun({ skipMediaAnalysis: true });
      expect(result.success).toBe(false);
      expect(result.error).toContain('entered Stasis with non-Up state');
      expect(result.cleanupSummary.asteriskChannelHungUp).toBe(true);
      expect(orchestrator.isRunActive()).toBe(false);
    });

    it('rejects buyer leg if runId does not match active test run', async () => {
      vi.spyOn(ariClient, 'checkConnectivity').mockResolvedValue({ connected: true });
      vi.spyOn(ariClient, 'originateChannel').mockResolvedValue({
        id: 'ari_caller_good',
        name: 'PJSIP/caller',
        state: 'Up',
      });
      vi.spyOn(ariClient, 'hangupChannel').mockResolvedValue();

      let callCount = 0;
      mockWsClient.waitForEvent.mockImplementation(async (eventType: string) => {
        if (eventType === 'StasisStart') {
          callCount++;
          if (callCount === 1) {
            // Caller leg
            return {
              type: 'StasisStart',
              channel: { id: 'ari_caller_good', state: 'Up' },
              args: ['caller', orchestrator.getActiveRunContext()?.runId],
            };
          } else {
            // Buyer leg with incorrect runId
            return {
              type: 'StasisStart',
              channel: { id: 'ari_buyer_impostor', state: 'Up' },
              args: ['buyer', 'different_run_id_999'],
            };
          }
        }
        return {};
      });

      const result = await orchestrator.executeTestRun({ skipMediaAnalysis: true });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Buyer channel runId mismatch');
      expect(orchestrator.isRunActive()).toBe(false);
    });
  });

  describe('End-to-End Dual Recording & Audio Verification', () => {
    it('executes successful run with dual recording, marker playback, and FFT verification', async () => {
      vi.spyOn(ariClient, 'checkConnectivity').mockResolvedValue({
        connected: true,
        version: 'Asterisk 20.21.0',
      });
      vi.spyOn(ariClient, 'originateChannel').mockResolvedValue({
        id: 'ari_ch_caller_leg',
        name: 'PJSIP/caller',
        state: 'Up',
      });
      vi.spyOn(ariClient, 'recordChannel').mockResolvedValue({
        name: 'qa-caller-rec',
        format: 'wav',
        state: 'recording',
      });
      vi.spyOn(ariClient, 'playMedia').mockResolvedValue({
        id: 'play_1',
        mediaUri: 'sound:qa-marker',
        state: 'playing',
      });

      // Generate synthetic WAVs:
      // Caller leg receives 1500 Hz buyer marker
      const callerReceivedWav = audioAnalyzer.generateSyntheticWav({
        durationSeconds: 2.0,
        frequency: 1500,
        amplitude: 0.8,
      });
      // Buyer leg receives 1000 Hz caller marker
      const buyerReceivedWav = audioAnalyzer.generateSyntheticWav({
        durationSeconds: 2.0,
        frequency: 1000,
        amplitude: 0.8,
      });

      vi.spyOn(ariClient, 'getStoredRecordingFile').mockImplementation(async (name: string) => {
        if (name.includes('buyer')) return buyerReceivedWav;
        return callerReceivedWav;
      });

      vi.spyOn(ariClient, 'stopRecording').mockResolvedValue();
      vi.spyOn(ariClient, 'deleteStoredRecording').mockResolvedValue();
      vi.spyOn(ariClient, 'hangupChannel').mockResolvedValue();

      let stasisCount = 0;
      mockWsClient.waitForEvent.mockImplementation(async (eventType: string) => {
        if (eventType === 'StasisStart') {
          stasisCount++;
          if (stasisCount === 1) {
            return {
              type: 'StasisStart',
              channel: { id: 'ari_ch_caller_leg', state: 'Up' },
              args: ['caller', orchestrator.getActiveRunContext()?.runId],
            };
          } else {
            return {
              type: 'StasisStart',
              channel: { id: 'ari_ch_buyer_leg', state: 'Up' },
              args: ['buyer', orchestrator.getActiveRunContext()?.runId],
            };
          }
        }
        if (eventType === 'RecordingStarted') {
          return { type: 'RecordingStarted', recording: { state: 'recording' } };
        }
        if (eventType === 'PlaybackFinished') {
          return { type: 'PlaybackFinished', playback: { state: 'done' } };
        }
        if (eventType === 'RecordingFinished') {
          return { type: 'RecordingFinished', recording: { state: 'done' } };
        }
        return {};
      });

      const result = await orchestrator.executeTestRun({
        minDurationSecs: 1.5,
        minSnrDb: 12.0,
      });

      expect(result.success).toBe(true);
      expect(result.audioAnalysis).toBeDefined();
      expect(result.audioAnalysis!.passed).toBe(true);
      expect(result.audioAnalysis!.targetFrequency).toBe(1500);

      expect(result.buyerAudioAnalysis).toBeDefined();
      expect(result.buyerAudioAnalysis!.passed).toBe(true);
      expect(result.buyerAudioAnalysis!.targetFrequency).toBe(1000);

      // Verify full 10-target cleanup
      expect(result.cleanupSummary.asteriskChannelHungUp).toBe(true);
      expect(result.cleanupSummary.buyerChannelHungUp).toBe(true);
      expect(result.cleanupSummary.recordingStopped).toBe(true);
      expect(result.cleanupSummary.recordingDeleted).toBe(true);
      expect(result.cleanupSummary.testRunUnregistered).toBe(true);
      expect(result.cleanupSummary.leasesCleaned).toBe(true);
      expect(result.cleanupSummary.webSocketDisconnected).toBe(true);

      // Mutex released
      expect(orchestrator.isRunActive()).toBe(false);
    });
  });

  describe('10-Target Idempotent Cleanup', () => {
    it('executes all cleanup targets even if individual targets throw errors', async () => {
      vi.spyOn(ariClient, 'hangupChannel').mockRejectedValue(new Error('Channel already hung up'));
      vi.spyOn(ariClient, 'stopRecording').mockRejectedValue(new Error('Recording not found'));
      vi.spyOn(ariClient, 'deleteStoredRecording').mockRejectedValue(new Error('File already deleted'));
      mockProvider.hangupCall.mockRejectedValue(new Error('Telnyx call already completed'));

      const context = {
        runId: 'run_cleanup_resilience',
        secretToken: 'secret_123',
        expectedCallerCli: QA_DID,
        trackingDid: QA_DID,
        workspaceId: QA_WORKSPACE,
        asteriskChannelId: 'ari_dead_ch',
        buyerChannelId: 'ari_dead_buyer_ch',
        telnyxCallControlId: 'v3:dead_telnyx',
        telnyxBuyerCallControlId: 'v3:dead_buyer_telnyx',
        prismaCallId: 'call_db_123',
        recordingName: 'rec_dead',
        callerRecordingName: 'rec_dead_caller',
        buyerRecordingName: 'rec_dead_buyer',
        state: 'FAILED' as const,
        startedAt: Date.now(),
      };

      // Does not throw despite individual errors
      const summary = await orchestrator.cleanup(context);

      expect(summary.testRunUnregistered).toBe(true);
      expect(summary.leasesCleaned).toBe(true);
      expect(summary.callBindingReleased).toBe(true);
      expect(summary.walletReservationReleased).toBe(true);
      expect(summary.webSocketDisconnected).toBe(true);
    });
  });

  describe('Authoritative Server-Side 30-Second Hard Watchdog & Cancellation', () => {
    beforeEach(() => {
      vi.spyOn(ariClient, 'checkConnectivity').mockResolvedValue({
        connected: true,
        latencyMs: 5,
        version: 'Asterisk 20.21.0',
      });
      mockWsClient.cancelPendingWaiters = vi.fn();
      mockWsClient.clearAllEventListeners = vi.fn();
    });

    it('enforces total run timeout and marks state FAILED_TIMEOUT', async () => {
      vi.spyOn(ariClient, 'originateChannel').mockResolvedValue({
        id: 'ari_ch_timeout',
        name: 'PJSIP/telnyx-timeout',
        state: 'Up',
      });
      const hangupSpy = vi.spyOn(ariClient, 'hangupChannel').mockResolvedValue();

      // Mock waiter that never resolves (simulating stall)
      mockWsClient.waitForEvent.mockImplementation(() => new Promise(() => {}));

      const result = await orchestrator.executeTestRun({
        skipMediaAnalysis: true,
        maxDurationMs: 50, // Fast deadline for test
      });

      expect(result.success).toBe(false);
      expect(result.context.state).toBe('FAILED_TIMEOUT');
      expect(result.error).toContain('Hard watchdog limit of 50ms exceeded');
      expect(mockWsClient.cancelPendingWaiters).toHaveBeenCalled();
      expect(mockWsClient.clearAllEventListeners).toHaveBeenCalled();
      expect(hangupSpy).toHaveBeenCalledWith('ari_ch_timeout', 'normal');
      expect(result.cleanupSummary.testRunUnregistered).toBe(true);
      expect(orchestrator.isRunActive()).toBe(false);
    });

    it('fails closed when caller StasisStart times out', async () => {
      vi.spyOn(ariClient, 'originateChannel').mockResolvedValue({
        id: 'ari_caller_stasis_to',
        name: 'PJSIP/telnyx-001',
        state: 'Up',
      });
      const hangupSpy = vi.spyOn(ariClient, 'hangupChannel').mockResolvedValue();

      mockWsClient.waitForEvent.mockRejectedValueOnce(
        new Error('Timed out waiting for ARI event "StasisStart" after 15000ms'),
      );

      const result = await orchestrator.executeTestRun({ skipMediaAnalysis: true });

      expect(result.success).toBe(false);
      expect(result.context.state).toBe('FAILED');
      expect(result.error).toContain('Timed out waiting for ARI event "StasisStart"');
      expect(hangupSpy).toHaveBeenCalledWith('ari_caller_stasis_to', 'normal');
      expect(orchestrator.isRunActive()).toBe(false);
    });

    it('fails closed when buyer StasisStart times out', async () => {
      vi.spyOn(ariClient, 'originateChannel').mockResolvedValue({
        id: 'ari_buyer_stasis_to_caller',
        name: 'PJSIP/telnyx-001',
        state: 'Up',
      });
      const hangupSpy = vi.spyOn(ariClient, 'hangupChannel').mockResolvedValue();

      mockWsClient.waitForEvent
        .mockResolvedValueOnce({
          type: 'StasisStart',
          application: 'callflow-qa',
          timestamp: new Date().toISOString(),
          channel: { id: 'ari_buyer_stasis_to_caller', name: 'PJSIP/telnyx-001', state: 'Up' },
          args: ['caller', 'run_test_buyer_to'],
        })
        .mockRejectedValueOnce(
          new Error('Timed out waiting for ARI event "StasisStart" after 20000ms'),
        );

      const result = await orchestrator.executeTestRun({ skipMediaAnalysis: true });

      expect(result.success).toBe(false);
      expect(result.context.state).toBe('FAILED');
      expect(result.error).toContain('Timed out waiting for ARI event "StasisStart"');
      expect(hangupSpy).toHaveBeenCalledWith('ari_buyer_stasis_to_caller', 'normal');
      expect(orchestrator.isRunActive()).toBe(false);
    });

    it('cleans up caller-only channel correctly when buyer leg was never created', async () => {
      const hangupSpy = vi.spyOn(ariClient, 'hangupChannel').mockResolvedValue();

      const context = {
        runId: 'caller_only_run',
        secretToken: 'token_1',
        expectedCallerCli: QA_DID,
        trackingDid: QA_DID,
        asteriskChannelId: 'caller_only_ari_id',
        state: 'FAILED' as const,
        startedAt: Date.now(),
      };

      const summary = await orchestrator.cleanup(context);
      expect(summary.asteriskChannelHungUp).toBe(true);
      expect(summary.buyerChannelHungUp).toBe(false);
      expect(hangupSpy).toHaveBeenCalledWith('caller_only_ari_id', 'normal');
    });

    it('cleans up buyer-only channel correctly', async () => {
      const hangupSpy = vi.spyOn(ariClient, 'hangupChannel').mockResolvedValue();

      const context = {
        runId: 'buyer_only_run',
        secretToken: 'token_2',
        expectedCallerCli: QA_DID,
        trackingDid: QA_DID,
        buyerChannelId: 'buyer_only_ari_id',
        state: 'FAILED' as const,
        startedAt: Date.now(),
      };

      const summary = await orchestrator.cleanup(context);
      expect(summary.asteriskChannelHungUp).toBe(false);
      expect(summary.buyerChannelHungUp).toBe(true);
      expect(hangupSpy).toHaveBeenCalledWith('buyer_only_ari_id', 'normal');
    });

    it('cleans up both caller and buyer channels and Telnyx legs', async () => {
      const hangupAriSpy = vi.spyOn(ariClient, 'hangupChannel').mockResolvedValue();

      const context = {
        runId: 'both_channels_run',
        secretToken: 'token_3',
        expectedCallerCli: QA_DID,
        trackingDid: QA_DID,
        asteriskChannelId: 'ch_caller_1',
        buyerChannelId: 'ch_buyer_2',
        telnyxCallControlId: 'v3:inbound_leg',
        telnyxBuyerCallControlId: 'v3:buyer_leg',
        state: 'FAILED' as const,
        startedAt: Date.now(),
      };

      const summary = await orchestrator.cleanup(context);
      expect(summary.asteriskChannelHungUp).toBe(true);
      expect(summary.buyerChannelHungUp).toBe(true);
      expect(summary.telnyxLegHungUp).toBe(true);
      expect(hangupAriSpy).toHaveBeenCalledWith('ch_caller_1', 'normal');
      expect(hangupAriSpy).toHaveBeenCalledWith('ch_buyer_2', 'normal');
      expect(mockProvider.hangupCall).toHaveBeenCalledWith('v3:inbound_leg');
      expect(mockProvider.hangupCall).toHaveBeenCalledWith('v3:buyer_leg');
    });

    it('safely handles concurrent timeout and hangup events', async () => {
      const hangupSpy = vi.spyOn(ariClient, 'hangupChannel').mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });

      const context = {
        runId: 'concurrent_run',
        secretToken: 'token_4',
        expectedCallerCli: QA_DID,
        trackingDid: QA_DID,
        asteriskChannelId: 'ch_concurrent_ari',
        state: 'FAILED_TIMEOUT' as const,
        startedAt: Date.now(),
      };

      // Trigger cleanup concurrently
      const [summary1, summary2] = await Promise.all([
        orchestrator.cleanup(context),
        orchestrator.cleanup(context),
      ]);

      expect(summary1).toBeDefined();
      expect(summary2).toBeDefined();
      expect(summary1.asteriskChannelHungUp).toBe(true);
      // Ensure hangup was called only once due to idempotency
      expect(hangupSpy).toHaveBeenCalledTimes(1);
    });

    it('rejects late StasisStart and Telnyx correlation after timeout', async () => {
      vi.spyOn(ariClient, 'originateChannel').mockResolvedValue({
        id: 'ari_ch_late',
        name: 'PJSIP/telnyx-late',
        state: 'Up',
      });
      vi.spyOn(ariClient, 'hangupChannel').mockResolvedValue();

      mockWsClient.waitForEvent.mockImplementation(() => new Promise(() => {}));

      const runPromise = orchestrator.executeTestRun({
        skipMediaAnalysis: true,
        maxDurationMs: 40,
      });

      const result = await runPromise;
      expect(result.context.state).toBe('FAILED_TIMEOUT');

      // Attempt late Telnyx correlation on timed-out run
      expect(() =>
        orchestrator.correlateInboundCall('v3:late_call_id', result.runId),
      ).toThrowError(/is not active or has timed out/);

      // Attempt late buyer dialed notification on timed-out run
      orchestrator.notifyBuyerDialed('v3:late_buyer_id', result.runId);
      expect(orchestrator.getActiveRunContext()).toBeNull();
    });

    it('is strictly idempotent under repeated cleanup calls', async () => {
      const context = {
        runId: 'repeated_cleanup_run',
        secretToken: 'token_repeat',
        expectedCallerCli: QA_DID,
        trackingDid: QA_DID,
        asteriskChannelId: 'ch_repeat_1',
        state: 'FAILED' as const,
        startedAt: Date.now(),
      };

      const hangupSpy = vi.spyOn(ariClient, 'hangupChannel').mockResolvedValue();

      const summaryFirst = await orchestrator.cleanup(context);
      const summarySecond = await orchestrator.cleanup(context);
      const summaryThird = await orchestrator.cleanup(context);

      expect(summaryFirst).toEqual(summarySecond);
      expect(summarySecond).toEqual(summaryThird);
      expect(hangupSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('Recording Stop Lifecycle & Audio Forensics (Phase 7B-10K)', () => {
    it('finalizeAndRetrieveRecording - Case A: stops live recording and retrieves stored buffer', async () => {
      const stopSpy = vi.spyOn(ariClient, 'stopRecording').mockResolvedValue();
      const storedSpy = vi.spyOn(ariClient, 'getStoredRecordingFile').mockResolvedValue(Buffer.from('RIFF_WAV_A'));

      const buffer = await orchestrator.finalizeAndRetrieveRecording('rec_live_test', 3000);
      expect(buffer).toBeDefined();
      expect(buffer!.toString()).toBe('RIFF_WAV_A');
      expect(stopSpy).toHaveBeenCalledWith('rec_live_test', 3000);
      expect(storedSpy).toHaveBeenCalledWith('rec_live_test', 3000);
    });

    it('finalizeAndRetrieveRecording - Case B: handles HTTP 404 from stopRecording and retrieves stored buffer', async () => {
      const stopSpy = vi.spyOn(ariClient, 'stopRecording').mockRejectedValue(
        new AsteriskAriError('Recording not found', 404, false, false),
      );
      const storedSpy = vi.spyOn(ariClient, 'getStoredRecordingFile').mockResolvedValue(Buffer.from('RIFF_WAV_PRE_FINISHED'));

      const buffer = await orchestrator.finalizeAndRetrieveRecording('rec_already_finished', 3000);
      expect(buffer).toBeDefined();
      expect(buffer!.toString()).toBe('RIFF_WAV_PRE_FINISHED');
      expect(stopSpy).toHaveBeenCalledWith('rec_already_finished', 3000);
      expect(storedSpy).toHaveBeenCalledWith('rec_already_finished', 3000);
    });

    it('finalizeAndRetrieveRecording - Case C: returns null when recording does not exist live or stored', async () => {
      const stopSpy = vi.spyOn(ariClient, 'stopRecording').mockRejectedValue(
        new AsteriskAriError('Recording not found', 404, false, false),
      );
      const storedSpy = vi.spyOn(ariClient, 'getStoredRecordingFile').mockRejectedValue(
        new AsteriskAriError('Stored recording not found', 404, false, false),
      );

      const buffer = await orchestrator.finalizeAndRetrieveRecording('rec_missing', 3000);
      expect(buffer).toBeNull();
      expect(stopSpy).toHaveBeenCalledWith('rec_missing', 3000);
      expect(storedSpy).toHaveBeenCalledWith('rec_missing', 3000);
    });

    it('finalizeAndRetrieveRecording - Case D1: propagates unexpected ARI error from stopRecording', async () => {
      vi.spyOn(ariClient, 'stopRecording').mockRejectedValue(
        new AsteriskAriError('Internal Server Error', 500, false, false),
      );
      const storedSpy = vi.spyOn(ariClient, 'getStoredRecordingFile').mockResolvedValue(Buffer.from('RIFF_DATA'));

      await expect(orchestrator.finalizeAndRetrieveRecording('rec_err_500', 3000)).rejects.toThrow('Internal Server Error');
      expect(storedSpy).not.toHaveBeenCalled();
    });

    it('finalizeAndRetrieveRecording - Case D2: propagates unexpected ARI error from getStoredRecordingFile', async () => {
      vi.spyOn(ariClient, 'stopRecording').mockResolvedValue();
      vi.spyOn(ariClient, 'getStoredRecordingFile').mockRejectedValue(
        new AsteriskAriError('Disk read error', 500, false, false),
      );

      await expect(orchestrator.finalizeAndRetrieveRecording('rec_err_disk', 3000)).rejects.toThrow('Disk read error');
    });

    it('finalizeAndRetrieveRecording - Idempotence: subsequent call on already-stopped recording downloads stored file', async () => {
      let callCount = 0;
      vi.spyOn(ariClient, 'stopRecording').mockImplementation(async () => {
        callCount++;
        if (callCount > 1) {
          throw new AsteriskAriError('Recording not found', 404, false, false);
        }
      });
      vi.spyOn(ariClient, 'getStoredRecordingFile').mockResolvedValue(Buffer.from('RIFF_IDEMPOTENT_DATA'));

      const firstResult = await orchestrator.finalizeAndRetrieveRecording('rec_idempotent', 3000);
      const secondResult = await orchestrator.finalizeAndRetrieveRecording('rec_idempotent', 3000);

      expect(firstResult!.toString()).toBe('RIFF_IDEMPOTENT_DATA');
      expect(secondResult!.toString()).toBe('RIFF_IDEMPOTENT_DATA');
    });

    it('executeTestRun passes maxSilenceSeconds: 0 and unique names with ifExists: fail to recordChannel', async () => {
      vi.spyOn(ariClient, 'checkConnectivity').mockResolvedValue({ connected: true, latencyMs: 5, version: '20.21.0' });
      vi.spyOn(ariClient, 'originateChannel').mockResolvedValue({ id: 'ch_orig_caller', name: 'caller_pjsip', state: 'Up' });
      vi.spyOn(ariClient, 'hangupChannel').mockResolvedValue();
      vi.spyOn(ariClient, 'playMedia').mockResolvedValue({ id: 'pb_1', mediaUri: 'sound:qa', state: 'done' });
      vi.spyOn(ariClient, 'stopRecording').mockResolvedValue();
      const validWavSample = audioAnalyzer.generateSyntheticWav({
        durationSeconds: 2.0,
        sampleRate: 8000,
        frequency: 1500,
        amplitude: 0.8,
      });
      vi.spyOn(ariClient, 'getStoredRecordingFile').mockResolvedValue(validWavSample);
      vi.spyOn(ariClient, 'deleteStoredRecording').mockResolvedValue();

      vi.spyOn(audioAnalyzer, 'analyzeRecording').mockReturnValue({
        passed: true,
        metadata: { sampleRate: 8000, channels: 1, bitsPerSample: 16, durationSeconds: 2, sampleCount: 16000 },
        targetFrequency: 1500,
        snrDb: 25,
        minSnrMet: true,
        durationSeconds: 2,
        minDurationMet: true,
        isSilent: false,
        rmsDbfs: -12,
        clippingRatio: 0,
        isClipped: false,
        reasons: [],
      });

      const recordSpy = vi.spyOn(ariClient, 'recordChannel').mockResolvedValue({
        name: 'rec',
        format: 'wav',
        state: 'recording',
      });

      mockWsClient.waitForEvent.mockImplementation(async (eventType: string, predicate: (e: any) => boolean) => {
        if (eventType === 'StasisStart') {
          const isCaller = predicate({ args: ['caller'] });
          return {
            type: 'StasisStart',
            channel: { id: isCaller ? 'ch_orig_caller' : 'ch_buyer_stasis', state: 'Up' },
            args: isCaller ? ['caller'] : ['buyer'],
          };
        }
        if (eventType === 'RecordingStarted') return { type: 'RecordingStarted' };
        if (eventType === 'PlaybackFinished') return { type: 'PlaybackFinished' };
        return {};
      });

      const result = await orchestrator.executeTestRun({ minDurationSecs: 0.1 });
      expect(result.success).toBe(true);
      expect(result.context.state).toBe('COMPLETED');

      expect(recordSpy).toHaveBeenCalledTimes(2);

      // Caller record options
      const callerRecordCall = recordSpy.mock.calls[0];
      expect(['snoop_ch_caller', 'ch_orig_caller']).toContain(callerRecordCall[0]);
      expect(callerRecordCall[1]).toEqual(
        expect.objectContaining({
          name: `qa-caller-${result.runId}`,
          format: 'wav',
          maxDurationSeconds: 15,
          maxSilenceSeconds: 0,
          beep: false,
          ifExists: 'fail',
        }),
      );

      // Buyer record options
      const buyerRecordCall = recordSpy.mock.calls[1];
      expect(['snoop_ch_buyer', 'ch_buyer_stasis']).toContain(buyerRecordCall[0]);
      expect(buyerRecordCall[1]).toEqual(
        expect.objectContaining({
          name: `qa-buyer-${result.runId}`,
          format: 'wav',
          maxDurationSeconds: 15,
          maxSilenceSeconds: 0,
          beep: false,
          ifExists: 'fail',
        }),
      );
    });

    it('executeTestRun handles recording naturally finishing before stop (Case B) and completes successfully', async () => {
      vi.spyOn(ariClient, 'checkConnectivity').mockResolvedValue({ connected: true, latencyMs: 5, version: '20.21.0' });
      vi.spyOn(ariClient, 'originateChannel').mockResolvedValue({ id: 'ch_caller_b', name: 'caller', state: 'Up' });
      vi.spyOn(ariClient, 'recordChannel').mockResolvedValue({ name: 'rec', format: 'wav', state: 'recording' });
      vi.spyOn(ariClient, 'playMedia').mockResolvedValue({ id: 'pb_1', mediaUri: 'sound:qa', state: 'done' });
      vi.spyOn(ariClient, 'hangupChannel').mockResolvedValue();
      vi.spyOn(ariClient, 'deleteStoredRecording').mockResolvedValue();

      // stopRecording throws 404 as recording already completed
      vi.spyOn(ariClient, 'stopRecording').mockRejectedValue(
        new AsteriskAriError('Recording not found', 404, false, false),
      );

      // getStoredRecordingFile returns valid synthetic WAV buffer
      const validStoredWav = audioAnalyzer.generateSyntheticWav({
        durationSeconds: 2.0,
        sampleRate: 8000,
        frequency: 1500,
        amplitude: 0.8,
      });
      vi.spyOn(ariClient, 'getStoredRecordingFile').mockResolvedValue(validStoredWav);

      vi.spyOn(audioAnalyzer, 'analyzeRecording').mockReturnValue({
        passed: true,
        metadata: { sampleRate: 8000, channels: 1, bitsPerSample: 16, durationSeconds: 2, sampleCount: 16000 },
        targetFrequency: 1500,
        snrDb: 22,
        minSnrMet: true,
        durationSeconds: 2,
        minDurationMet: true,
        isSilent: false,
        rmsDbfs: -14,
        clippingRatio: 0,
        isClipped: false,
        reasons: [],
      });

      mockWsClient.waitForEvent.mockImplementation(async (eventType: string, predicate: (e: any) => boolean) => {
        if (eventType === 'StasisStart') {
          const isCaller = predicate({ args: ['caller'] });
          return {
            type: 'StasisStart',
            channel: { id: isCaller ? 'ch_caller_b' : 'ch_buyer_b', state: 'Up' },
            args: isCaller ? ['caller'] : ['buyer'],
          };
        }
        if (eventType === 'RecordingStarted') return { type: 'RecordingStarted' };
        if (eventType === 'PlaybackFinished') return { type: 'PlaybackFinished' };
        return {};
      });

      const result = await orchestrator.executeTestRun({ minDurationSecs: 0.1 });
      expect(result.success).toBe(true);
      expect(result.context.state).toBe('COMPLETED');
      expect(result.cleanupSummary.asteriskChannelHungUp).toBe(true);
    });

    it('executeTestRun handles missing caller recording (Case C) as controlled media failure without crashing cleanup', async () => {
      vi.spyOn(ariClient, 'checkConnectivity').mockResolvedValue({ connected: true, latencyMs: 5, version: '20.21.0' });
      vi.spyOn(ariClient, 'originateChannel').mockResolvedValue({ id: 'ch_caller_c1', name: 'caller', state: 'Up' });
      vi.spyOn(ariClient, 'recordChannel').mockResolvedValue({ name: 'rec', format: 'wav', state: 'recording' });
      vi.spyOn(ariClient, 'playMedia').mockResolvedValue({ id: 'pb_1', mediaUri: 'sound:qa', state: 'done' });
      vi.spyOn(ariClient, 'hangupChannel').mockResolvedValue();
      vi.spyOn(ariClient, 'deleteStoredRecording').mockResolvedValue();

      vi.spyOn(ariClient, 'stopRecording').mockResolvedValue();

      // Caller stored recording returns 404 (missing), buyer succeeds
      const validBuyerWav = audioAnalyzer.generateSyntheticWav({
        durationSeconds: 2.0,
        sampleRate: 8000,
        frequency: 1000,
        amplitude: 0.8,
      });
      vi.spyOn(ariClient, 'getStoredRecordingFile').mockImplementation(async (name: string) => {
        if (name.includes('qa-caller')) {
          throw new AsteriskAriError('Recording not found', 404, false, false);
        }
        return validBuyerWav;
      });

      vi.spyOn(audioAnalyzer, 'analyzeRecording').mockReturnValue({
        passed: true,
        metadata: { sampleRate: 8000, channels: 1, bitsPerSample: 16, durationSeconds: 2, sampleCount: 16000 },
        targetFrequency: 1000,
        snrDb: 20,
        minSnrMet: true,
        durationSeconds: 2,
        minDurationMet: true,
        isSilent: false,
        rmsDbfs: -15,
        clippingRatio: 0,
        isClipped: false,
        reasons: [],
      });

      mockWsClient.waitForEvent.mockImplementation(async (eventType: string, predicate: (e: any) => boolean) => {
        if (eventType === 'StasisStart') {
          const isCaller = predicate({ args: ['caller'] });
          return {
            type: 'StasisStart',
            channel: { id: isCaller ? 'ch_caller_c1' : 'ch_buyer_c1', state: 'Up' },
            args: isCaller ? ['caller'] : ['buyer'],
          };
        }
        if (eventType === 'RecordingStarted') return { type: 'RecordingStarted' };
        if (eventType === 'PlaybackFinished') return { type: 'PlaybackFinished' };
        return {};
      });

      const result = await orchestrator.executeTestRun({ minDurationSecs: 0.1 });
      expect(result.success).toBe(false);
      expect(result.context.state).toBe('FAILED');
      expect(result.audioAnalysis?.passed).toBe(false);
      expect(result.audioAnalysis?.reasons[0]).toContain('not found in live or stored state');
      expect(result.error).toContain('Caller recording');
      expect(result.cleanupSummary.asteriskChannelHungUp).toBe(true);
      expect(result.cleanupSummary.buyerChannelHungUp).toBe(true);
    });

    it('executeTestRun handles missing buyer recording (Case C) as controlled media failure', async () => {
      vi.spyOn(ariClient, 'checkConnectivity').mockResolvedValue({ connected: true, latencyMs: 5, version: '20.21.0' });
      vi.spyOn(ariClient, 'originateChannel').mockResolvedValue({ id: 'ch_caller_c2', name: 'caller', state: 'Up' });
      vi.spyOn(ariClient, 'recordChannel').mockResolvedValue({ name: 'rec', format: 'wav', state: 'recording' });
      vi.spyOn(ariClient, 'playMedia').mockResolvedValue({ id: 'pb_1', mediaUri: 'sound:qa', state: 'done' });
      vi.spyOn(ariClient, 'hangupChannel').mockResolvedValue();
      vi.spyOn(ariClient, 'deleteStoredRecording').mockResolvedValue();

      vi.spyOn(ariClient, 'stopRecording').mockResolvedValue();

      // Buyer stored recording returns 404 (missing), caller succeeds
      const validCallerWav = audioAnalyzer.generateSyntheticWav({
        durationSeconds: 2.0,
        sampleRate: 8000,
        frequency: 1500,
        amplitude: 0.8,
      });
      vi.spyOn(ariClient, 'getStoredRecordingFile').mockImplementation(async (name: string) => {
        if (name.includes('qa-buyer')) {
          throw new AsteriskAriError('Recording not found', 404, false, false);
        }
        return validCallerWav;
      });

      vi.spyOn(audioAnalyzer, 'analyzeRecording').mockReturnValue({
        passed: true,
        metadata: { sampleRate: 8000, channels: 1, bitsPerSample: 16, durationSeconds: 2, sampleCount: 16000 },
        targetFrequency: 1500,
        snrDb: 20,
        minSnrMet: true,
        durationSeconds: 2,
        minDurationMet: true,
        isSilent: false,
        rmsDbfs: -15,
        clippingRatio: 0,
        isClipped: false,
        reasons: [],
      });

      mockWsClient.waitForEvent.mockImplementation(async (eventType: string, predicate: (e: any) => boolean) => {
        if (eventType === 'StasisStart') {
          const isCaller = predicate({ args: ['caller'] });
          return {
            type: 'StasisStart',
            channel: { id: isCaller ? 'ch_caller_c2' : 'ch_buyer_c2', state: 'Up' },
            args: isCaller ? ['caller'] : ['buyer'],
          };
        }
        if (eventType === 'RecordingStarted') return { type: 'RecordingStarted' };
        if (eventType === 'PlaybackFinished') return { type: 'PlaybackFinished' };
        return {};
      });

      const result = await orchestrator.executeTestRun({ minDurationSecs: 0.1 });
      expect(result.success).toBe(false);
      expect(result.context.state).toBe('FAILED');
      expect(result.buyerAudioAnalysis?.passed).toBe(false);
      expect(result.buyerAudioAnalysis?.reasons[0]).toContain('not found in live or stored state');
      expect(result.error).toContain('Buyer recording');
    });

    it('executeTestRun handles both recordings missing (Case C) gracefully', async () => {
      vi.spyOn(ariClient, 'checkConnectivity').mockResolvedValue({ connected: true, latencyMs: 5, version: '20.21.0' });
      vi.spyOn(ariClient, 'originateChannel').mockResolvedValue({ id: 'ch_caller_both', name: 'caller', state: 'Up' });
      vi.spyOn(ariClient, 'recordChannel').mockResolvedValue({ name: 'rec', format: 'wav', state: 'recording' });
      vi.spyOn(ariClient, 'playMedia').mockResolvedValue({ id: 'pb_1', mediaUri: 'sound:qa', state: 'done' });
      vi.spyOn(ariClient, 'hangupChannel').mockResolvedValue();
      vi.spyOn(ariClient, 'deleteStoredRecording').mockResolvedValue();

      vi.spyOn(ariClient, 'stopRecording').mockResolvedValue();
      vi.spyOn(ariClient, 'getStoredRecordingFile').mockRejectedValue(
        new AsteriskAriError('Recording not found', 404, false, false),
      );

      mockWsClient.waitForEvent.mockImplementation(async (eventType: string, predicate: (e: any) => boolean) => {
        if (eventType === 'StasisStart') {
          const isCaller = predicate({ args: ['caller'] });
          return {
            type: 'StasisStart',
            channel: { id: isCaller ? 'ch_caller_both' : 'ch_buyer_both', state: 'Up' },
            args: isCaller ? ['caller'] : ['buyer'],
          };
        }
        if (eventType === 'RecordingStarted') return { type: 'RecordingStarted' };
        if (eventType === 'PlaybackFinished') return { type: 'PlaybackFinished' };
        return {};
      });

      const result = await orchestrator.executeTestRun({ minDurationSecs: 0.1 });
      expect(result.success).toBe(false);
      expect(result.context.state).toBe('FAILED');
      expect(result.error).toBe('Both caller and buyer recordings not found in live or stored state');
      expect(result.cleanupSummary.testRunUnregistered).toBe(true);
    });

    it('executeTestRun propagates unexpected non-404 ARI errors (Case D)', async () => {
      vi.spyOn(ariClient, 'checkConnectivity').mockResolvedValue({ connected: true, latencyMs: 5, version: '20.21.0' });
      vi.spyOn(ariClient, 'originateChannel').mockResolvedValue({ id: 'ch_caller_500', name: 'caller', state: 'Up' });
      vi.spyOn(ariClient, 'recordChannel').mockResolvedValue({ name: 'rec', format: 'wav', state: 'recording' });
      vi.spyOn(ariClient, 'playMedia').mockResolvedValue({ id: 'pb_1', mediaUri: 'sound:qa', state: 'done' });
      vi.spyOn(ariClient, 'hangupChannel').mockResolvedValue();
      vi.spyOn(ariClient, 'deleteStoredRecording').mockResolvedValue();

      // stopRecording throws unexpected 500 error
      vi.spyOn(ariClient, 'stopRecording').mockRejectedValue(
        new AsteriskAriError('ARI internal crash', 500, false, false),
      );

      mockWsClient.waitForEvent.mockImplementation(async (eventType: string, predicate: (e: any) => boolean) => {
        if (eventType === 'StasisStart') {
          const isCaller = predicate({ args: ['caller'] });
          return {
            type: 'StasisStart',
            channel: { id: isCaller ? 'ch_caller_500' : 'ch_buyer_500', state: 'Up' },
            args: isCaller ? ['caller'] : ['buyer'],
          };
        }
        if (eventType === 'RecordingStarted') return { type: 'RecordingStarted' };
        if (eventType === 'PlaybackFinished') return { type: 'PlaybackFinished' };
        return {};
      });

      const result = await orchestrator.executeTestRun({ minDurationSecs: 0.1 });
      expect(result.success).toBe(false);
      expect(result.context.state).toBe('FAILED');
      expect(result.error).toContain('ARI internal crash');
      expect(result.cleanupSummary.asteriskChannelHungUp).toBe(true);
    });

    it('verifies audio direction correctly: caller analyzes 1500Hz from buyer, buyer analyzes 1000Hz from caller', async () => {
      vi.spyOn(ariClient, 'checkConnectivity').mockResolvedValue({ connected: true, latencyMs: 5, version: '20.21.0' });
      vi.spyOn(ariClient, 'originateChannel').mockResolvedValue({ id: 'ch_caller_dir', name: 'caller', state: 'Up' });
      vi.spyOn(ariClient, 'recordChannel').mockResolvedValue({ name: 'rec', format: 'wav', state: 'recording' });
      vi.spyOn(ariClient, 'playMedia').mockResolvedValue({ id: 'pb_1', mediaUri: 'sound:qa', state: 'done' });
      vi.spyOn(ariClient, 'stopRecording').mockResolvedValue();
      const validCallerBuffer = audioAnalyzer.generateSyntheticWav({
        durationSeconds: 2.0,
        sampleRate: 8000,
        frequency: 1500,
        amplitude: 0.8,
      });
      const validBuyerBuffer = audioAnalyzer.generateSyntheticWav({
        durationSeconds: 2.0,
        sampleRate: 8000,
        frequency: 1000,
        amplitude: 0.8,
      });
      vi.spyOn(ariClient, 'getStoredRecordingFile').mockImplementation(async (name: string) => {
        if (name.includes('qa-caller')) return validCallerBuffer;
        return validBuyerBuffer;
      });
      vi.spyOn(ariClient, 'deleteStoredRecording').mockResolvedValue();
      vi.spyOn(ariClient, 'hangupChannel').mockResolvedValue();

      const analyzerSpy = vi.spyOn(audioAnalyzer, 'analyzeRecording').mockReturnValue({
        passed: true,
        metadata: { sampleRate: 8000, channels: 1, bitsPerSample: 16, durationSeconds: 2, sampleCount: 16000 },
        targetFrequency: 1500,
        snrDb: 25,
        minSnrMet: true,
        durationSeconds: 2,
        minDurationMet: true,
        isSilent: false,
        rmsDbfs: -12,
        clippingRatio: 0,
        isClipped: false,
        reasons: [],
      });

      mockWsClient.waitForEvent.mockImplementation(async (eventType: string, predicate: (e: any) => boolean) => {
        if (eventType === 'StasisStart') {
          const isCaller = predicate({ args: ['caller'] });
          return {
            type: 'StasisStart',
            channel: { id: isCaller ? 'ch_caller_dir' : 'ch_buyer_dir', state: 'Up' },
            args: isCaller ? ['caller'] : ['buyer'],
          };
        }
        if (eventType === 'RecordingStarted') return { type: 'RecordingStarted' };
        if (eventType === 'PlaybackFinished') return { type: 'PlaybackFinished' };
        return {};
      });

      const result = await orchestrator.executeTestRun({ minDurationSecs: 0.1 });
      expect(result.success).toBe(true);

      expect(analyzerSpy).toHaveBeenCalledTimes(2);

      // Call 1: Caller leg analyzing callerWav for 1500 Hz (buyer's injected tone)
      const callerAnalysisCall = analyzerSpy.mock.calls[0];
      expect(callerAnalysisCall[0]).toEqual(validCallerBuffer);
      expect(callerAnalysisCall[1]).toEqual(
        expect.objectContaining({
          targetFreq: 1500,
        }),
      );

      // Call 2: Buyer leg analyzing buyerWav for 1000 Hz (caller's injected tone)
      const buyerAnalysisCall = analyzerSpy.mock.calls[1];
      expect(buyerAnalysisCall[0]).toEqual(validBuyerBuffer);
      expect(buyerAnalysisCall[1]).toEqual(
        expect.objectContaining({
          targetFreq: 1000,
        }),
      );
    });
  });

  describe('Phase 7B-10Q: ARI Recording Lifecycle & Validation', () => {
    const EMPTY_44_BYTE_WAV = Buffer.from(
      '524946462400000057415645666d74201000000001000100401f0000803e0000020010006461746100000000',
      'hex',
    );

    describe('validateRecordingBuffer', () => {
      it('accepts valid PCM WAV buffer with non-zero samples and duration', () => {
        const validWav = audioAnalyzer.generateSyntheticWav({
          durationSeconds: 1.5,
          sampleRate: 8000,
          frequency: 1000,
          amplitude: 0.8,
        });
        const res = orchestrator.validateRecordingBuffer(validWav, 'test-rec');
        expect(res.valid).toBe(true);
        expect(res.reason).toBeUndefined();
      });

      it('strictly rejects empty null or 0-byte buffer', () => {
        expect(orchestrator.validateRecordingBuffer(null, 'null-rec')).toEqual({
          valid: false,
          reason: 'Recording "null-rec" is empty or not retrieved (0 bytes)',
        });
        expect(orchestrator.validateRecordingBuffer(Buffer.alloc(0), 'zero-rec')).toEqual({
          valid: false,
          reason: 'Recording "zero-rec" is empty or not retrieved (0 bytes)',
        });
      });

      it('strictly rejects truncated buffer shorter than 44 bytes', () => {
        const truncated = Buffer.from('RIFF_SHORT');
        const res = orchestrator.validateRecordingBuffer(truncated, 'trunc-rec');
        expect(res.valid).toBe(false);
        expect(res.reason).toContain('is truncated (10 bytes < 44-byte header)');
      });

      it('strictly rejects 44-byte empty header-only WAV file', () => {
        expect(EMPTY_44_BYTE_WAV.length).toBe(44);
        const res = orchestrator.validateRecordingBuffer(EMPTY_44_BYTE_WAV, 'empty-rec');
        expect(res.valid).toBe(false);
        expect(res.reason).toContain('is an empty 44-byte header-only WAV file with zero audio samples');
      });

      it('strictly rejects buffer with invalid RIFF/WAVE header magic', () => {
        const invalid = Buffer.alloc(60, 0);
        invalid.write('NOPE', 0);
        const res = orchestrator.validateRecordingBuffer(invalid, 'bad-magic');
        expect(res.valid).toBe(false);
        expect(res.reason).toContain('invalid header magic');
      });
    });

    describe('executeTestRun 44-byte rejection and event correlation', () => {
      it('strictly rejects 44-byte empty recording and reports descriptive failure reason', async () => {
        vi.spyOn(ariClient, 'checkConnectivity').mockResolvedValue({ connected: true, latencyMs: 5, version: '20.21.0' });
        vi.spyOn(ariClient, 'originateChannel').mockResolvedValue({ id: 'ch_caller_44', name: 'caller', state: 'Up' });
        vi.spyOn(ariClient, 'recordChannel').mockResolvedValue({ name: 'rec', format: 'wav', state: 'recording' });
        vi.spyOn(ariClient, 'playMedia').mockResolvedValue({ id: 'pb_1', mediaUri: 'sound:qa', state: 'done' });
        vi.spyOn(ariClient, 'stopRecording').mockResolvedValue();
        vi.spyOn(ariClient, 'hangupChannel').mockResolvedValue();
        vi.spyOn(ariClient, 'deleteStoredRecording').mockResolvedValue();

        // Asterisk returns 44-byte empty WAV header (the Phase 7B-10L/10P failure mode)
        vi.spyOn(ariClient, 'getStoredRecordingFile').mockResolvedValue(EMPTY_44_BYTE_WAV);

        mockWsClient.waitForEvent.mockImplementation(async (eventType: string, predicate: (e: any) => boolean) => {
          if (eventType === 'StasisStart') {
            const isCaller = predicate({ args: ['caller'] });
            return {
              type: 'StasisStart',
              channel: { id: isCaller ? 'ch_caller_44' : 'ch_buyer_44', state: 'Up' },
              args: isCaller ? ['caller'] : ['buyer'],
            };
          }
          if (eventType === 'RecordingStarted') return { type: 'RecordingStarted' };
          if (eventType === 'PlaybackFinished') return { type: 'PlaybackFinished' };
          if (eventType === 'RecordingFinished') return { type: 'RecordingFinished' };
          return {};
        });

        const result = await orchestrator.executeTestRun({ minDurationSecs: 0.1 });
        expect(result.success).toBe(false);
        expect(result.context.state).toBe('FAILED');
        expect(result.audioAnalysis?.passed).toBe(false);
        expect(result.audioAnalysis?.reasons[0]).toContain('empty 44-byte header-only WAV file');
        expect(result.buyerAudioAnalysis?.passed).toBe(false);
        expect(result.buyerAudioAnalysis?.reasons[0]).toContain('empty 44-byte header-only WAV file');
        expect(result.error).toContain('Both caller and buyer recordings failed validation');
        expect(result.cleanupSummary.asteriskChannelHungUp).toBe(true);
        expect(result.cleanupSummary.buyerChannelHungUp).toBe(true);
      });

      it('enforces multi-factor correlation for RecordingStarted, RecordingFinished, and PlaybackFinished', async () => {
        vi.spyOn(ariClient, 'checkConnectivity').mockResolvedValue({ connected: true, latencyMs: 5, version: '20.21.0' });
        vi.spyOn(ariClient, 'originateChannel').mockResolvedValue({ id: 'ch_caller_corr', name: 'caller', state: 'Up' });
        vi.spyOn(ariClient, 'recordChannel').mockResolvedValue({ name: 'rec', format: 'wav', state: 'recording' });
        vi.spyOn(ariClient, 'playMedia').mockResolvedValue({ id: 'pb_1', mediaUri: 'sound:qa', state: 'done' });
        vi.spyOn(ariClient, 'stopRecording').mockResolvedValue();
        vi.spyOn(ariClient, 'hangupChannel').mockResolvedValue();
        vi.spyOn(ariClient, 'deleteStoredRecording').mockResolvedValue();

        const validWav = audioAnalyzer.generateSyntheticWav({
          durationSeconds: 2.0,
          sampleRate: 8000,
          frequency: 1500,
          amplitude: 0.8,
        });
        vi.spyOn(ariClient, 'getStoredRecordingFile').mockResolvedValue(validWav);

        vi.spyOn(audioAnalyzer, 'analyzeRecording').mockReturnValue({
          passed: true,
          metadata: { sampleRate: 8000, channels: 1, bitsPerSample: 16, durationSeconds: 2, sampleCount: 16000 },
          targetFrequency: 1500,
          snrDb: 25,
          minSnrMet: true,
          durationSeconds: 2,
          minDurationMet: true,
          isSilent: false,
          rmsDbfs: -12,
          clippingRatio: 0,
          isClipped: false,
          reasons: [],
        });

        const registeredPredicates: Record<string, ((e: any) => boolean)[]> = {};
        mockWsClient.waitForEvent.mockImplementation(async (eventType: string, predicate: (e: any) => boolean) => {
          if (!registeredPredicates[eventType]) registeredPredicates[eventType] = [];
          registeredPredicates[eventType].push(predicate);

          if (eventType === 'StasisStart') {
            const isCaller = predicate({ args: ['caller'] });
            return {
              type: 'StasisStart',
              channel: { id: isCaller ? 'ch_caller_corr' : 'ch_buyer_corr', state: 'Up' },
              args: isCaller ? ['caller'] : ['buyer'],
            };
          }
          return {};
        });

        const result = await orchestrator.executeTestRun({ minDurationSecs: 0.1 });
        expect(result.success).toBe(true);

        // Verify RecordingStarted predicates exist and enforce channel correlation
        expect(registeredPredicates['RecordingStarted']).toBeDefined();
        expect(registeredPredicates['RecordingStarted'].length).toBe(2);
        const callerRecPred = registeredPredicates['RecordingStarted'][0];
        expect(callerRecPred({ recording: { name: `qa-caller-${result.runId}`, target_uri: 'channel:ch_caller_corr' } })).toBe(true);
        expect(callerRecPred({ recording: { name: `qa-caller-WRONG`, target_uri: 'channel:ch_caller_corr' } })).toBe(false);

        // Verify PlaybackFinished predicates exist and enforce target_uri
        expect(registeredPredicates['PlaybackFinished']).toBeDefined();
        const callerPbPred = registeredPredicates['PlaybackFinished'][0];
        expect(callerPbPred({ playback: { target_uri: 'channel:ch_caller_corr' } })).toBe(true);
        expect(callerPbPred({ playback: { target_uri: 'channel:wrong_ch' } })).toBe(false);

        // Verify RecordingFinished predicates exist and enforce channel correlation
        expect(registeredPredicates['RecordingFinished']).toBeDefined();
        const callerFinPred = registeredPredicates['RecordingFinished'][0];
        expect(callerFinPred({ recording: { name: `qa-caller-${result.runId}`, target_uri: 'channel:ch_caller_corr' } })).toBe(true);
        expect(callerFinPred({ recording: { name: `qa-caller-${result.runId}`, target_uri: 'channel:other_ch' } })).toBe(false);
      });

      it('safely aborts when remaining watchdog time is insufficient for requested capture interval', async () => {
        vi.spyOn(ariClient, 'checkConnectivity').mockResolvedValue({ connected: true, latencyMs: 5, version: '20.21.0' });
        vi.spyOn(ariClient, 'originateChannel').mockResolvedValue({ id: 'ch_caller_insuf', name: 'caller', state: 'Up' });
        vi.spyOn(ariClient, 'recordChannel').mockResolvedValue({ name: 'rec', format: 'wav', state: 'recording' });
        vi.spyOn(ariClient, 'playMedia').mockResolvedValue({ id: 'pb_1', mediaUri: 'sound:qa', state: 'done' });
        vi.spyOn(ariClient, 'hangupChannel').mockResolvedValue();

        mockWsClient.waitForEvent.mockImplementation(async (eventType: string, predicate: (e: any) => boolean) => {
          if (eventType === 'StasisStart') {
            const isCaller = predicate({ args: ['caller'] });
            return {
              type: 'StasisStart',
              channel: { id: isCaller ? 'ch_caller_insuf' : 'ch_buyer_insuf', state: 'Up' },
              args: isCaller ? ['caller'] : ['buyer'],
            };
          }
          if (eventType === 'RecordingStarted') return { type: 'RecordingStarted' };
          if (eventType === 'PlaybackFinished') return { type: 'PlaybackFinished' };
          return {};
        });

        // Request a capture interval (10000ms) with a maxDurationMs of 4000ms -> remaining watchdog will be < 10000ms
        const result = await orchestrator.executeTestRun({
          maxDurationMs: 4000,
          postPlaybackCaptureMs: 10000,
        });

        expect(result.success).toBe(false);
        expect(result.context.state).toBe('FAILED');
        expect(result.error).toContain('Insufficient remaining watchdog time');
        expect(result.cleanupSummary.asteriskChannelHungUp).toBe(true);
      });
    });
  });
});
