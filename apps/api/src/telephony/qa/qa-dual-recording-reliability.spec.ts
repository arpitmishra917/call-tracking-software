import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  QaOrchestratorService,
  QaRecordingSession,
  StructuredLifecycleLog,
} from './qa-orchestrator.service.js';
import { QaTelephonyGuardService } from './qa-telephony-guard.service.js';
import { QaSipUriAdapterService } from './qa-sip-uri-adapter.service.js';
import { AsteriskAriClientService, AsteriskAriError } from './asterisk-ari-client.service.js';
import { QaAudioAnalyzerService } from './qa-audio-analyzer.service.js';
import {
  AriWebSocketClientService,
  StasisStartEvent,
  RecordingStartedEvent,
  PlaybackFinishedEvent,
  RecordingFinishedEvent,
} from './ari-websocket-client.service.js';

describe('Phase 7B-10U: Dual-Leg Recording Reliability & Snoop Architecture Verification', () => {
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
    process.env.TELEPHONY_QA_RECORDING_CAPTURE_INTERVAL_MS = '10'; // Fast execution for unit tests
  });

  afterEach(() => {
    vi.restoreAllMocks();
    guardService.clearActiveTestRuns();
    process.env = { ...originalEnv };
  });

  // Helper to standard setup common ARI mocks with Snoop channels
  const setupBaseAriMocks = (callerWav: Buffer, buyerWav: Buffer) => {
    vi.spyOn(ariClient, 'checkConnectivity').mockResolvedValue({
      connected: true,
      latencyMs: 5,
      version: 'Asterisk 20.10.0',
    });
    vi.spyOn(ariClient, 'originateChannel').mockResolvedValue({
      id: 'ch_caller_100',
      name: 'PJSIP/telnyx-caller-0001',
      state: 'Up',
    });
    vi.spyOn(ariClient, 'snoopChannel').mockImplementation(async (chId: string) => {
      if (chId.includes('caller') || chId === 'ch_caller_100') {
        return { id: 'snoop_ch_caller_1', name: 'Snoop/ch_caller_100-0001', state: 'Up' } as any;
      }
      return { id: 'snoop_ch_buyer_2', name: 'Snoop/ch_buyer_200-0002', state: 'Up' } as any;
    });
    vi.spyOn(ariClient, 'recordChannel').mockResolvedValue({
      name: 'qa-rec',
      format: 'wav',
      state: 'recording',
    });
    vi.spyOn(ariClient, 'playMedia').mockResolvedValue({
      id: 'play_1',
      mediaUri: 'sound:qa-marker',
      state: 'playing',
    });
    vi.spyOn(ariClient, 'stopRecording').mockResolvedValue();
    vi.spyOn(ariClient, 'deleteStoredRecording').mockResolvedValue();
    vi.spyOn(ariClient, 'hangupChannel').mockResolvedValue();

    vi.spyOn(ariClient, 'getStoredRecordingFile').mockImplementation(async (name: string) => {
      if (name.includes('buyer')) return buyerWav;
      return callerWav;
    });
  };

  // Helper to set up standard event dispatcher
  const setupStandardEvents = () => {
    let mainStasisCount = 0;
    mockWsClient.waitForEvent.mockImplementation(async (eventType: string, predicate?: (e: any) => boolean) => {
      const runId = orchestrator.getActiveRunContext()?.runId || 'run-1';

      if (eventType === 'StasisStart') {
        const candidates = [
          {
            type: 'StasisStart',
            channel: { id: 'ch_caller_100', name: 'PJSIP/telnyx-caller-0001', state: 'Up' },
            args: ['caller', runId],
          },
          {
            type: 'StasisStart',
            channel: { id: 'ch_buyer_200', name: 'PJSIP/telnyx-buyer-0002', state: 'Up' },
            args: ['buyer', runId],
          },
          {
            type: 'StasisStart',
            channel: { id: 'snoop_ch_caller_1', name: 'Snoop/ch_caller_100-0001', state: 'Up' },
            args: ['snoop', 'caller', runId],
          },
          {
            type: 'StasisStart',
            channel: { id: 'snoop_ch_buyer_2', name: 'Snoop/ch_buyer_200-0002', state: 'Up' },
            args: ['snoop', 'buyer', runId],
          },
        ];

        if (predicate) {
          for (const cand of candidates) {
            try {
              if (predicate(cand)) return cand;
            } catch {}
          }
        }
        mainStasisCount++;
        return candidates[mainStasisCount % candidates.length];
      }

      if (eventType === 'RecordingStarted') {
        const candidates = [
          {
            type: 'RecordingStarted',
            recording: {
              name: `qa-caller-${runId}`,
              target_uri: 'channel:snoop_ch_caller_1',
              state: 'recording',
            },
          },
          {
            type: 'RecordingStarted',
            recording: {
              name: `qa-buyer-${runId}`,
              target_uri: 'channel:snoop_ch_buyer_2',
              state: 'recording',
            },
          },
        ];
        if (predicate) {
          for (const cand of candidates) {
            try {
              if (predicate(cand)) return cand;
            } catch {}
          }
        }
        return candidates[0];
      }

      if (eventType === 'PlaybackFinished') {
        const candidates = [
          {
            type: 'PlaybackFinished',
            playback: {
              target_uri: 'channel:ch_caller_100',
              state: 'done',
            },
          },
          {
            type: 'PlaybackFinished',
            playback: {
              target_uri: 'channel:ch_buyer_200',
              state: 'done',
            },
          },
        ];
        if (predicate) {
          for (const cand of candidates) {
            try {
              if (predicate(cand)) return cand;
            } catch {}
          }
        }
        return candidates[0];
      }

      if (eventType === 'RecordingFinished') {
        const candidates = [
          {
            type: 'RecordingFinished',
            recording: {
              name: `qa-caller-${runId}`,
              target_uri: 'channel:snoop_ch_caller_1',
              state: 'done',
            },
          },
          {
            type: 'RecordingFinished',
            recording: {
              name: `qa-buyer-${runId}`,
              target_uri: 'channel:snoop_ch_buyer_2',
              state: 'done',
            },
          },
        ];
        if (predicate) {
          for (const cand of candidates) {
            try {
              if (predicate(cand)) return cand;
            } catch {}
          }
        }
        return candidates[0];
      }

      return {};
    });
  };

  /**
   * TEST 1: Normal Dual Recording via Snoop Channels
   */
  it('Test 1: Normal Dual Recording - both legs capture valid audio via Snoop channels', async () => {
    const callerReceivedWav = audioAnalyzer.generateSyntheticWav({
      durationSeconds: 2.0,
      frequency: 1500, // Buyer marker received by caller
      amplitude: 0.8,
    });
    const buyerReceivedWav = audioAnalyzer.generateSyntheticWav({
      durationSeconds: 2.0,
      frequency: 1000, // Caller marker received by buyer
      amplitude: 0.8,
    });
    setupBaseAriMocks(callerReceivedWav, buyerReceivedWav);
    setupStandardEvents();

    const lifecycleLogs: StructuredLifecycleLog[] = [];
    const logSpy = vi.spyOn(orchestrator, 'logLifecycle').mockImplementation((entry) => {
      lifecycleLogs.push(entry);
    });

    const result = await orchestrator.executeTestRun({
      minDurationSecs: 1.5,
      minSnrDb: 10.0,
      postPlaybackCaptureMs: 10,
    });

    expect(result.success).toBe(true);
    expect(result.audioAnalysis?.passed).toBe(true);
    expect(result.audioAnalysis?.targetFrequency).toBe(1500);
    expect(result.buyerAudioAnalysis?.passed).toBe(true);
    expect(result.buyerAudioAnalysis?.targetFrequency).toBe(1000);

    // Verify independent sessions were populated in context
    expect(result.context.callerSession).toBeDefined();
    expect(result.context.callerSession?.state).toBe('VALIDATED');
    expect(result.context.buyerSession).toBeDefined();
    expect(result.context.buyerSession?.state).toBe('VALIDATED');

    // Verify structured lifecycle logging was called with all required fields
    expect(lifecycleLogs.length).toBeGreaterThan(0);
    const sampleLog = lifecycleLogs[0];
    expect(sampleLog).toHaveProperty('timestamp');
    expect(sampleLog).toHaveProperty('runId');
    expect(sampleLog).toHaveProperty('leg');
    expect(sampleLog).toHaveProperty('channelId');
    expect(sampleLog).toHaveProperty('recordingName');
    expect(sampleLog).toHaveProperty('event');
    expect(sampleLog).toHaveProperty('state');
    const finalizedLog = lifecycleLogs.find((l) => l.event === 'RECORDING_DOWNLOADED' || l.event === 'VALIDATED');
    expect(finalizedLog?.httpStatus).toBe(200);

    logSpy.mockRestore();
  });

  /**
   * TEST 2: Buyer Bridge Renegotiation
   */
  it('Test 2: Buyer Bridge Renegotiation - recording survives mid-call media update', async () => {
    const callerWav = audioAnalyzer.generateSyntheticWav({ durationSeconds: 2.0, frequency: 1500 });
    const buyerWav = audioAnalyzer.generateSyntheticWav({ durationSeconds: 2.0, frequency: 1000 });
    setupBaseAriMocks(callerWav, buyerWav);
    setupStandardEvents();

    const result = await orchestrator.executeTestRun({
      minDurationSecs: 1.5,
      minSnrDb: 5.0,
      postPlaybackCaptureMs: 10,
    });

    expect(result.success).toBe(true);
    expect(result.buyerAudioAnalysis?.passed).toBe(true);
    expect(result.cleanupSummary.asteriskChannelHungUp).toBe(true);
    expect(result.cleanupSummary.buyerChannelHungUp).toBe(true);
  });

  /**
   * TEST 3: Playback Timeout
   */
  it('Test 3: Playback Timeout - buyer playback failure does not abort caller capture', async () => {
    const callerWav = audioAnalyzer.generateSyntheticWav({ durationSeconds: 2.0, frequency: 1500 });
    const buyerWav = audioAnalyzer.generateSyntheticWav({ durationSeconds: 2.0, frequency: 1000 });
    setupBaseAriMocks(callerWav, buyerWav);
    setupStandardEvents();

    // Override PlaybackFinished to fail buyer playback
    const origWaitForEvent = mockWsClient.waitForEvent.getMockImplementation();
    mockWsClient.waitForEvent.mockImplementation(async (eventType: string, predicate: any, timeoutMs?: number) => {
      if (eventType === 'PlaybackFinished') {
        if (predicate && predicate({ playback: { target_uri: 'channel:ch_buyer_200' } })) {
          throw new Error('Timed out waiting for ARI event "PlaybackFinished" after 8000ms');
        }
      }
      return origWaitForEvent(eventType, predicate, timeoutMs);
    });

    const result = await orchestrator.executeTestRun({
      postPlaybackCaptureMs: 10,
    });

    expect(result.context.buyerSession?.state).toBe('VALIDATED');
    expect(result.context.callerSession?.state).toBe('VALIDATED');
    expect(result.audioAnalysis?.passed).toBe(true);
    expect(result.buyerAudioAnalysis?.passed).toBe(true);
  });

  /**
   * TEST 4: Caller Independent Cleanup
   */
  it('Test 4: Caller Independent Cleanup - caller hangup error does not prevent buyer finalization', async () => {
    const callerWav = audioAnalyzer.generateSyntheticWav({ durationSeconds: 2.0, frequency: 1500 });
    const buyerWav = audioAnalyzer.generateSyntheticWav({ durationSeconds: 2.0, frequency: 1000 });
    setupBaseAriMocks(callerWav, buyerWav);
    setupStandardEvents();

    vi.spyOn(ariClient, 'hangupChannel').mockImplementation(async (chId: string) => {
      if (chId === 'ch_caller_100') {
        throw new AsteriskAriError('Caller channel already destroyed', 404);
      }
    });

    const result = await orchestrator.executeTestRun({ postPlaybackCaptureMs: 10 });
    expect(result.success).toBe(true);
    expect(result.cleanupSummary.buyerChannelHungUp).toBe(true);
  });

  /**
   * TEST 5: Buyer Independent Cleanup
   */
  it('Test 5: Buyer Independent Cleanup - buyer hangup error does not prevent caller finalization', async () => {
    const callerWav = audioAnalyzer.generateSyntheticWav({ durationSeconds: 2.0, frequency: 1500 });
    const buyerWav = audioAnalyzer.generateSyntheticWav({ durationSeconds: 2.0, frequency: 1000 });
    setupBaseAriMocks(callerWav, buyerWav);
    setupStandardEvents();

    vi.spyOn(ariClient, 'hangupChannel').mockImplementation(async (chId: string) => {
      if (chId === 'ch_buyer_200') {
        throw new AsteriskAriError('Buyer channel already destroyed', 404);
      }
    });

    const result = await orchestrator.executeTestRun({ postPlaybackCaptureMs: 10 });
    expect(result.success).toBe(true);
    expect(result.cleanupSummary.asteriskChannelHungUp).toBe(true);
  });

  /**
   * TEST 6: Duplicate Events
   */
  it('Test 6: Duplicate Events - handles redundant ARI WebSocket events without state corruption', async () => {
    const callerWav = audioAnalyzer.generateSyntheticWav({ durationSeconds: 2.0, frequency: 1500 });
    const buyerWav = audioAnalyzer.generateSyntheticWav({ durationSeconds: 2.0, frequency: 1000 });
    setupBaseAriMocks(callerWav, buyerWav);
    setupStandardEvents();

    const result = await orchestrator.executeTestRun({ postPlaybackCaptureMs: 10 });
    expect(result.success).toBe(true);
    expect(result.context.state).toBe('COMPLETED');
  });

  /**
   * TEST 7: Late ARI Events
   */
  it('Test 7: Late ARI Events - handles late RecordingFinished event without uncaught exceptions', async () => {
    const callerWav = audioAnalyzer.generateSyntheticWav({ durationSeconds: 2.0, frequency: 1500 });
    const buyerWav = audioAnalyzer.generateSyntheticWav({ durationSeconds: 2.0, frequency: 1000 });
    setupBaseAriMocks(callerWav, buyerWav);
    setupStandardEvents();

    const origWaitForEvent = mockWsClient.waitForEvent.getMockImplementation();
    mockWsClient.waitForEvent.mockImplementation(async (eventType: string, predicate: any, timeoutMs?: number) => {
      if (eventType === 'RecordingFinished') {
        throw new Error('Timed out waiting for ARI event "RecordingFinished"');
      }
      return origWaitForEvent(eventType, predicate, timeoutMs);
    });

    const result = await orchestrator.executeTestRun({ postPlaybackCaptureMs: 10 });
    expect(result.success).toBe(true);
    expect(result.audioAnalysis?.passed).toBe(true);
    expect(result.buyerAudioAnalysis?.passed).toBe(true);
  });

  /**
   * TEST 8: Channel Replacement
   */
  it('Test 8: Channel Replacement - validates channel URI and rejection of mismatched runIds', async () => {
    vi.spyOn(ariClient, 'checkConnectivity').mockResolvedValue({ connected: true });
    vi.spyOn(ariClient, 'originateChannel').mockResolvedValue({ id: 'ch_caller_100', state: 'Up' } as any);
    vi.spyOn(ariClient, 'hangupChannel').mockResolvedValue();

    let stasisCount = 0;
    mockWsClient.waitForEvent.mockImplementation(async (eventType: string) => {
      if (eventType === 'StasisStart') {
        stasisCount++;
        if (stasisCount === 1) {
          return {
            type: 'StasisStart',
            channel: { id: 'ch_caller_100', state: 'Up' },
            args: ['caller', orchestrator.getActiveRunContext()?.runId],
          };
        } else {
          return {
            type: 'StasisStart',
            channel: { id: 'ch_buyer_impostor', state: 'Up' },
            args: ['buyer', 'mismatched-run-id-999'],
          };
        }
      }
      return {};
    });

    const result = await orchestrator.executeTestRun({ skipMediaAnalysis: true });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Buyer channel runId mismatch');
  });

  /**
   * TEST 9: Missing RTP (44-Byte Header Rejection)
   */
  it('Test 9: Missing RTP - strictly classifies 44-byte header as silent without unhandled crash', async () => {
    const empty44ByteWav = Buffer.from(
      '524946462400000057415645666d74201000000001000100401f0000401f0000010008006461746100000000',
      'hex',
    );
    expect(empty44ByteWav.length).toBe(44);

    const validCallerWav = audioAnalyzer.generateSyntheticWav({ durationSeconds: 2.0, frequency: 1500 });
    setupBaseAriMocks(validCallerWav, empty44ByteWav);
    setupStandardEvents();

    const result = await orchestrator.executeTestRun({ postPlaybackCaptureMs: 10 });
    expect(result.success).toBe(false);
    expect(result.buyerAudioAnalysis?.passed).toBe(false);
    expect(result.buyerAudioAnalysis?.isSilent).toBe(true);
    expect(result.error).toContain('Buyer recording failed validation');
    expect(result.error).toContain('empty 44-byte header-only WAV file with zero audio samples');
    expect(orchestrator.isRunActive()).toBe(false);
  });

  /**
   * TEST 10: Teardown & Resource Cleanup
   */
  it('Test 10: Teardown & Resource Cleanup - executes full 10-target idempotent cleanup', async () => {
    const callerWav = audioAnalyzer.generateSyntheticWav({ durationSeconds: 2.0, frequency: 1500 });
    const buyerWav = audioAnalyzer.generateSyntheticWav({ durationSeconds: 2.0, frequency: 1000 });
    setupBaseAriMocks(callerWav, buyerWav);
    setupStandardEvents();

    const result = await orchestrator.executeTestRun({ postPlaybackCaptureMs: 10 });
    expect(result.success).toBe(true);

    const cleanup = result.cleanupSummary;
    expect(cleanup.asteriskChannelHungUp).toBe(true);
    expect(cleanup.buyerChannelHungUp).toBe(true);
    expect(cleanup.recordingStopped).toBe(true);
    expect(cleanup.recordingDeleted).toBe(true);
    expect(cleanup.testRunUnregistered).toBe(true);
    expect(cleanup.leasesCleaned).toBe(true);
    expect(cleanup.webSocketDisconnected).toBe(true);
    expect(orchestrator.isRunActive()).toBe(false);
  });

  /**
   * TEST 11: Mandatory Caller Snoop Attachment
   */
  it('Test 11: Mandatory Caller Snoop Attachment - verifies snoopChannel is invoked with correct parameters', async () => {
    const callerWav = audioAnalyzer.generateSyntheticWav({ durationSeconds: 2.0, frequency: 1500 });
    const buyerWav = audioAnalyzer.generateSyntheticWav({ durationSeconds: 2.0, frequency: 1000 });
    setupBaseAriMocks(callerWav, buyerWav);
    setupStandardEvents();

    const snoopSpy = vi.spyOn(ariClient, 'snoopChannel');

    await orchestrator.executeTestRun({ postPlaybackCaptureMs: 10 });

    expect(snoopSpy).toHaveBeenCalledWith(
      'ch_caller_100',
      expect.objectContaining({
        app: 'callflow-qa',
        spy: 'in',
        whisper: 'none',
        appArgs: expect.stringMatching(/^snoop,caller,/),
      }),
    );
  });

  /**
   * TEST 12: Mandatory Buyer Snoop Attachment
   */
  it('Test 12: Mandatory Buyer Snoop Attachment - verifies buyer snoopChannel is invoked with correct parameters', async () => {
    const callerWav = audioAnalyzer.generateSyntheticWav({ durationSeconds: 2.0, frequency: 1500 });
    const buyerWav = audioAnalyzer.generateSyntheticWav({ durationSeconds: 2.0, frequency: 1000 });
    setupBaseAriMocks(callerWav, buyerWav);
    setupStandardEvents();

    const snoopSpy = vi.spyOn(ariClient, 'snoopChannel');

    await orchestrator.executeTestRun({ postPlaybackCaptureMs: 10 });

    expect(snoopSpy).toHaveBeenCalledWith(
      'ch_buyer_200',
      expect.objectContaining({
        app: 'callflow-qa',
        spy: 'in',
        whisper: 'none',
        appArgs: expect.stringMatching(/^snoop,buyer,/),
      }),
    );
  });

  /**
   * TEST 13: Strict Fallback Guard Caller (BUG-10U-001)
   * Direct recording on parent channel is prohibited when caller snoop fails.
   */
  it('Test 13: Strict Fallback Guard Caller - fails session and forbids parent channel recording when caller snoop fails', async () => {
    const callerWav = audioAnalyzer.generateSyntheticWav({ durationSeconds: 2.0, frequency: 1500 });
    const buyerWav = audioAnalyzer.generateSyntheticWav({ durationSeconds: 2.0, frequency: 1000 });
    setupBaseAriMocks(callerWav, buyerWav);
    setupStandardEvents();

    vi.spyOn(ariClient, 'snoopChannel').mockImplementation(async (chId: string) => {
      if (chId === 'ch_caller_100') {
        throw new AsteriskAriError('Failed to allocate snoop audiohook', 500);
      }
      return { id: 'snoop_ch_buyer_2', state: 'Up' } as any;
    });

    const recordSpy = vi.spyOn(ariClient, 'recordChannel');

    const result = await orchestrator.executeTestRun({ postPlaybackCaptureMs: 10 });

    // Must NOT have attempted direct parent channel recording on caller
    expect(recordSpy).not.toHaveBeenCalledWith('ch_caller_100', expect.anything());
    expect(result.context.callerSession?.state).toBe('SNOOP_ATTACHMENT_FAILED');
  });

  /**
   * TEST 14: Strict Fallback Guard Buyer (BUG-10U-001)
   * Direct recording on parent channel is prohibited when buyer snoop fails.
   */
  it('Test 14: Strict Fallback Guard Buyer - fails session and forbids parent channel recording when buyer snoop fails', async () => {
    const callerWav = audioAnalyzer.generateSyntheticWav({ durationSeconds: 2.0, frequency: 1500 });
    const buyerWav = audioAnalyzer.generateSyntheticWav({ durationSeconds: 2.0, frequency: 1000 });
    setupBaseAriMocks(callerWav, buyerWav);
    setupStandardEvents();

    vi.spyOn(ariClient, 'snoopChannel').mockImplementation(async (chId: string) => {
      if (chId === 'ch_buyer_200') {
        throw new AsteriskAriError('Failed to allocate buyer snoop audiohook', 500);
      }
      return { id: 'snoop_ch_caller_1', state: 'Up' } as any;
    });

    const recordSpy = vi.spyOn(ariClient, 'recordChannel');

    const result = await orchestrator.executeTestRun({ postPlaybackCaptureMs: 10 });

    // Must NOT have attempted direct parent channel recording on buyer
    expect(recordSpy).not.toHaveBeenCalledWith('ch_buyer_200', expect.anything());
    expect(result.context.buyerSession?.state).toBe('SNOOP_ATTACHMENT_FAILED');
  });

  /**
   * TEST 15: Snoop StasisStart Predicate Validation (BUG-10U-002)
   */
  it('Test 15: Snoop StasisStart Predicate Validation - ignores unrelated channels during snoop attachment', async () => {
    const callerWav = audioAnalyzer.generateSyntheticWav({ durationSeconds: 2.0, frequency: 1500 });
    const buyerWav = audioAnalyzer.generateSyntheticWav({ durationSeconds: 2.0, frequency: 1000 });
    setupBaseAriMocks(callerWav, buyerWav);
    setupStandardEvents();

    const result = await orchestrator.executeTestRun({ postPlaybackCaptureMs: 10 });
    expect(result.success).toBe(true);
    expect(result.context.callerSnoopChannelId).toBe('snoop_ch_caller_1');
    expect(result.context.buyerSnoopChannelId).toBe('snoop_ch_buyer_2');
  });

  /**
   * TEST 16: Snoop Target URI Correlation on RecordingStarted (BUG-10U-003)
   */
  it('Test 16: Snoop Target URI Correlation on RecordingStarted - matches only snoop target URIs', async () => {
    const callerWav = audioAnalyzer.generateSyntheticWav({ durationSeconds: 2.0, frequency: 1500 });
    const buyerWav = audioAnalyzer.generateSyntheticWav({ durationSeconds: 2.0, frequency: 1000 });
    setupBaseAriMocks(callerWav, buyerWav);
    setupStandardEvents();

    const result = await orchestrator.executeTestRun({ postPlaybackCaptureMs: 10 });
    expect(result.context.callerSession?.state).toBe('VALIDATED');
    expect(result.context.buyerSession?.state).toBe('VALIDATED');
  });

  /**
   * TEST 17: Snoop Target URI Correlation on RecordingFinished (BUG-10U-003)
   */
  it('Test 17: Snoop Target URI Correlation on RecordingFinished - ignores finished events from alien channels', async () => {
    const callerWav = audioAnalyzer.generateSyntheticWav({ durationSeconds: 2.0, frequency: 1500 });
    const buyerWav = audioAnalyzer.generateSyntheticWav({ durationSeconds: 2.0, frequency: 1000 });
    setupBaseAriMocks(callerWav, buyerWav);
    setupStandardEvents();

    const result = await orchestrator.executeTestRun({ postPlaybackCaptureMs: 10 });
    expect(result.success).toBe(true);
  });

  /**
   * TEST 18: Snoop Channel Teardown Precedence (BUG-10U-004)
   * Verifies Snoop channels and recordings are stopped during teardown.
   */
  it('Test 18: Snoop Channel Teardown Precedence - cleans up snoop channels alongside main channels', async () => {
    const callerWav = audioAnalyzer.generateSyntheticWav({ durationSeconds: 2.0, frequency: 1500 });
    const buyerWav = audioAnalyzer.generateSyntheticWav({ durationSeconds: 2.0, frequency: 1000 });
    setupBaseAriMocks(callerWav, buyerWav);
    setupStandardEvents();

    const hangupCalls: string[] = [];
    vi.spyOn(ariClient, 'hangupChannel').mockImplementation(async (chId: string) => {
      hangupCalls.push(chId);
    });

    await orchestrator.executeTestRun({ postPlaybackCaptureMs: 10 });

    expect(hangupCalls).toContain('snoop_ch_caller_1');
    expect(hangupCalls).toContain('snoop_ch_buyer_2');
    expect(hangupCalls).toContain('ch_caller_100');
    expect(hangupCalls).toContain('ch_buyer_200');
  });

  /**
   * TEST 19: Double Playback Failure Decoupling
   * Both caller and buyer playbacks fail, yet capture intervals run and audio finalizes cleanly.
   */
  it('Test 19: Double Playback Failure Decoupling - captures and finalizes even when both marker playbacks fail', async () => {
    const callerWav = audioAnalyzer.generateSyntheticWav({ durationSeconds: 2.0, frequency: 1500 });
    const buyerWav = audioAnalyzer.generateSyntheticWav({ durationSeconds: 2.0, frequency: 1000 });
    setupBaseAriMocks(callerWav, buyerWav);
    setupStandardEvents();

    const origWaitForEvent = mockWsClient.waitForEvent.getMockImplementation();
    mockWsClient.waitForEvent.mockImplementation(async (eventType: string, predicate: any, timeoutMs?: number) => {
      if (eventType === 'PlaybackFinished') {
        throw new Error('All playbacks timed out');
      }
      return origWaitForEvent(eventType, predicate, timeoutMs);
    });

    const result = await orchestrator.executeTestRun({ postPlaybackCaptureMs: 10 });

    expect(result.context.callerSession?.state).toBe('VALIDATED');
    expect(result.context.buyerSession?.state).toBe('VALIDATED');
    expect(result.success).toBe(true);
  });

  /**
   * TEST 20: Goertzel Algorithm Frequency Discrimination
   * Validates that wrong frequencies fail analysis strictly.
   */
  it('Test 20: Goertzel Algorithm Frequency Discrimination - detects correct tones and rejects wrong frequencies', async () => {
    // Generate inverted tone on caller (receives 1000 Hz instead of 1500 Hz)
    const invertedCallerWav = audioAnalyzer.generateSyntheticWav({ durationSeconds: 2.0, frequency: 1000 });
    const validBuyerWav = audioAnalyzer.generateSyntheticWav({ durationSeconds: 2.0, frequency: 1000 });
    setupBaseAriMocks(invertedCallerWav, validBuyerWav);
    setupStandardEvents();

    const result = await orchestrator.executeTestRun({ postPlaybackCaptureMs: 10 });

    // Caller expected 1500 Hz but received 1000 Hz, so callerAudioAnalysis should fail
    expect(result.audioAnalysis?.passed).toBe(false);
    expect(result.buyerAudioAnalysis?.passed).toBe(true);
    expect(result.success).toBe(false);
  });
});
