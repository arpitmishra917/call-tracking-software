import { Injectable, Logger, Inject, forwardRef, Optional } from '@nestjs/common';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { QaTelephonyGuardService } from './qa-telephony-guard.service.js';
import { QaSipUriAdapterService } from './qa-sip-uri-adapter.service.js';
import { AsteriskAriClientService, AsteriskChannel, AsteriskAriError } from './asterisk-ari-client.service.js';
import {
  AriWebSocketClientService,
  AriWebSocketError,
  StasisStartEvent,
  RecordingStartedEvent,
  RecordingFinishedEvent,
  PlaybackFinishedEvent,
} from './ari-websocket-client.service.js';
import { QaAudioAnalyzerService, QaAudioAnalysisResult } from './qa-audio-analyzer.service.js';
import { WalletService } from '../../billing/wallet.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { TELEPHONY_PROVIDER } from '../call-controller.js';
import type { TelephonyProvider } from '../telephony.provider.js';
import { TelephonyProviderError, TelephonyErrorType } from '../telephony.errors.js';

export interface QaRunOptions {
  callerCli?: string;
  callerSipUri?: string;
  expectedConnectionId?: string;
  trackingDid?: string;
  targetToneFreq?: number;
  minDurationSecs?: number;
  minSnrDb?: number;
  skipMediaAnalysis?: boolean;
  maxDurationMs?: number;
  preserveRecordings?: boolean;
  postPlaybackCaptureMs?: number;
}

export type LegType = 'caller' | 'buyer';

export type RecordingLifecycleState =
  | 'UNINITIALIZED'
  | 'STASIS_UP'
  | 'ATTACHING'
  | 'SNOOP_ATTACHED'
  | 'SNOOP_ATTACHMENT_FAILED'
  | 'RECORDING_ACTIVE'
  | 'RECORDING_START_FAILED'
  | 'PLAYBACK_ACTIVE'
  | 'PLAYBACK_COMPLETED'
  | 'PLAYBACK_ERROR'
  | 'CAPTURING'
  | 'STOP_REQUESTED'
  | 'FINALIZED'
  | 'RECORDING_FINALIZATION_FAILED'
  | 'VALIDATED'
  | 'AUDIO_VALIDATION_FAILED'
  | 'FAILED';

export interface StructuredLifecycleLog {
  timestamp: string;
  runId: string;
  leg: LegType;
  channelId: string;
  recordingName: string;
  event: string;
  durationMs?: number;
  state: string;
  httpStatus?: number;
  pcapPacketsSeen?: number;
  audioBytesWritten?: number;
  sampleCount?: number;
  errorReason?: string;
}

export interface QaRecordingSession {
  leg: LegType;
  channelId: string;
  snoopChannelId?: string;
  recordingName: string;
  state: RecordingLifecycleState;
  startedAt?: number;
  stoppedAt?: number;
  durationMs?: number;
  audioBuffer?: Buffer | null;
  sampleCount?: number;
  audioBytesWritten?: number;
  httpStatus?: number;
  pcapPacketsSeen?: number;
  errorReason?: string;
  analysis?: QaAudioAnalysisResult;
  validationReason?: string;
}

export interface QaRunContext {
  runId: string;
  secretToken: string;
  expectedCallerCli: string;
  trackingDid: string;
  workspaceId?: string;
  asteriskChannelId?: string;
  buyerChannelId?: string;
  callerSnoopChannelId?: string;
  buyerSnoopChannelId?: string;
  telnyxCallControlId?: string;
  telnyxBuyerCallControlId?: string;
  prismaCallId?: string;
  recordingName?: string;
  callerRecordingName?: string;
  buyerRecordingName?: string;
  callerSession?: QaRecordingSession;
  buyerSession?: QaRecordingSession;
  preserveRecordings?: boolean;
  state:
    | 'IDLE'
    | 'MUTEX_ACQUIRED'
    | 'WS_CONNECTED'
    | 'LEASE_OPENED'
    | 'CHANNEL_ORIGINATED'
    | 'CALLER_STASIS_UP'
    | 'BUYER_STASIS_UP'
    | 'RECORDINGS_STARTED'
    | 'PLAYBACK_FINISHED'
    | 'RECORDINGS_FINISHED'
    | 'RECORDINGS_DOWNLOADED'
    | 'CORRELATED'
    | 'BRIDGED'
    | 'ANALYZED'
    | 'COMPLETED'
    | 'FAILED'
    | 'FAILED_TIMEOUT';
  startedAt: number;
}

export interface QaCleanupSummary {
  asteriskChannelHungUp: boolean;
  buyerChannelHungUp: boolean;
  callerSnoopHungUp?: boolean;
  buyerSnoopHungUp?: boolean;
  telnyxLegHungUp: boolean;
  recordingStopped: boolean;
  recordingDeleted: boolean;
  testRunUnregistered: boolean;
  callBindingReleased: boolean;
  leasesCleaned: boolean;
  walletReservationReleased: boolean;
  webSocketDisconnected: boolean;
}

export interface QaRunResult {
  success: boolean;
  runId: string;
  context: QaRunContext;
  audioAnalysis?: QaAudioAnalysisResult;
  buyerAudioAnalysis?: QaAudioAnalysisResult;
  cleanupSummary: QaCleanupSummary;
  error?: string;
  callerAudioBase64?: string;
  buyerAudioBase64?: string;
  callerWavPath?: string;
  buyerWavPath?: string;
}

@Injectable()
export class QaOrchestratorService {
  private readonly logger = new Logger(QaOrchestratorService.name);
  private activeRun: QaRunContext | null = null;
  private readonly wsClient: AriWebSocketClientService;
  private readonly cleanedRuns = new Map<string, QaCleanupSummary>();
  private readonly inFlightCleanups = new Map<string, Promise<QaCleanupSummary>>();

  constructor(
    private readonly qaGuardService: QaTelephonyGuardService,
    private readonly qaSipAdapter: QaSipUriAdapterService,
    private readonly ariClient: AsteriskAriClientService,
    private readonly audioAnalyzer: QaAudioAnalyzerService,
    @Optional()
    ariWsClient?: AriWebSocketClientService,
    @Optional()
    private readonly prisma?: PrismaService,
    @Optional()
    private readonly walletService?: WalletService,
    @Optional()
    @Inject(forwardRef(() => TELEPHONY_PROVIDER))
    private readonly provider?: TelephonyProvider,
  ) {
    this.wsClient = ariWsClient || new AriWebSocketClientService();
  }

  /**
   * Checks whether a QA test run is currently active (mutex check).
   */
  public isRunActive(): boolean {
    return this.activeRun !== null;
  }

  /**
   * Retrieves the current active QA test run context, if any.
   */
  public getActiveRunContext(): QaRunContext | null {
    return this.activeRun ? { ...this.activeRun } : null;
  }

  /**
   * Correlates an incoming Telnyx webhook call to the active QA run.
   */
  public correlateInboundCall(telnyxCallControlId: string, runId: string, prismaCallId?: string): void {
    if (
      !this.activeRun ||
      this.activeRun.runId !== runId ||
      this.activeRun.state === 'FAILED_TIMEOUT' ||
      this.activeRun.state === 'FAILED'
    ) {
      throw new Error(`Cannot correlate call: runId "${runId}" is not active or has timed out`);
    }

    this.activeRun.telnyxCallControlId = telnyxCallControlId;
    if (prismaCallId) {
      this.activeRun.prismaCallId = prismaCallId;
    }
    this.activeRun.state = 'CORRELATED';
    this.logger.log(
      `QA run ${runId} correlated: TelnyxCall ${telnyxCallControlId}, PrismaCall ${prismaCallId || 'pending'}`,
    );
  }

  /**
   * Notifies the active QA run that Telnyx has dialed the buyer leg.
   */
  public notifyBuyerDialed(telnyxBuyerCallControlId: string, runId: string): void {
    if (
      this.activeRun &&
      this.activeRun.runId === runId &&
      this.activeRun.state !== 'FAILED_TIMEOUT' &&
      this.activeRun.state !== 'FAILED'
    ) {
      this.activeRun.telnyxBuyerCallControlId = telnyxBuyerCallControlId;
      this.logger.log(`QA run ${runId}: Telnyx buyer leg registered: ${telnyxBuyerCallControlId}`);
    }
  }

  public getActiveRun(): QaRunContext | null {
    return this.activeRun;
  }

  /**
   * Executes a full, event-driven telephony QA test run using the native ARI WebSocket.
   */
  public async executeTestRun(options: QaRunOptions = {}): Promise<QaRunResult> {
    // 1. Single-concurrency mutex check
    if (this.activeRun !== null) {
      this.logger.warn(
        `qa.mutex.rejected: Cannot start QA run. Run ${this.activeRun.runId} is currently active.`,
      );
      throw new TelephonyProviderError(
        TelephonyErrorType.INVALID_CALL_STATE,
        `Concurrent QA run rejected: run "${this.activeRun.runId}" is currently in progress`,
      );
    }

    // 2. Telephony QA enablement check
    if (!this.qaGuardService.isQaEnabled()) {
      throw new TelephonyProviderError(
        TelephonyErrorType.ROUTING_FAILED,
        'Cannot execute QA test run: TELEPHONY_QA_ENABLED is false',
      );
    }

    // 3. Strict configuration validation
    const configCheck = this.qaGuardService.validateConfiguration();
    if (!configCheck.valid) {
      const msg = `QA configuration validation failed: ${configCheck.errors.join('; ')}`;
      this.logger.error(msg);
      throw new TelephonyProviderError(TelephonyErrorType.ROUTING_FAILED, msg);
    }

    const runId = crypto.randomUUID();
    const secretToken = crypto.randomBytes(32).toString('hex');
    const trackingDid = options.trackingDid || process.env.TELNYX_QA_TRACKING_DID || '+14845560110';
    const callerCli = options.callerCli || trackingDid;
    const workspaceId = process.env.QA_WORKSPACE_ID;

    const context: QaRunContext = {
      runId,
      secretToken,
      expectedCallerCli: callerCli,
      trackingDid,
      workspaceId,
      preserveRecordings: options.preserveRecordings ?? false,
      state: 'MUTEX_ACQUIRED',
      startedAt: Date.now(),
    };

    // Lock mutex
    this.activeRun = context;
    this.logger.log(`qa.orchestrator.started: Acquired mutex for QA test run ${runId}`);

    let audioAnalysis: QaAudioAnalysisResult | undefined;
    let buyerAudioAnalysis: QaAudioAnalysisResult | undefined;
    let callerWav: Buffer | null = null;
    let buyerWav: Buffer | null = null;
    let callerWavPath: string | undefined;
    let buyerWavPath: string | undefined;
    let runError: string | undefined;
    let watchdogTimer: NodeJS.Timeout | null = null;
    const hardDeadlineMs = Math.min(30000, options.maxDurationMs ?? 30000);
    let watchdogFired = false;

    try {
      // 4. Register active test run in server-side registry
      this.qaGuardService.registerActiveTestRun(runId, { secretToken, ttlMs: 120000 });

      // 5. Connect Native ARI WebSocket listener BEFORE originating
      await this.wsClient.connect('callflow-qa', 5000);
      context.state = 'WS_CONNECTED';

      // 6. Open explicit single-use inbound lease on QA guard with multi-factor correlation
      this.qaGuardService.openInboundTestLease({
        runId,
        secretToken,
        expectedCallerCli: callerCli,
        expectedCallerSipUri:
          options.callerSipUri ||
          process.env.TELEPHONY_QA_CALLER_SIP_URI ||
          'sip:arpitmishra917@sip.telnyx.com',
        expectedConnectionId:
          options.expectedConnectionId ||
          process.env.TELNYX_QA_CALL_CONTROL_APP_ID?.trim() ||
          '3090207513618941231',
        ttlMs: 60000,
      });
      context.state = 'LEASE_OPENED';

      // 7. Check Asterisk ARI HTTP connectivity
      const ariHealth = await this.ariClient.checkConnectivity(3000);
      if (!ariHealth.connected) {
        throw new Error(`Asterisk ARI connectivity check failed: ${ariHealth.error || 'unreachable'}`);
      }

      // 8.5. Start Authoritative Server-Side Hard Watchdog Deadline (30,000ms max)
      const watchdogPromise = new Promise<never>((_, reject) => {
        watchdogTimer = setTimeout(async () => {
          watchdogFired = true;
          context.state = 'FAILED_TIMEOUT';
          this.logger.error(
            `qa.orchestrator.watchdog: Hard ${hardDeadlineMs}ms watchdog deadline reached for run ${runId}! Forcibly terminating both legs.`,
          );

          // 1. Immediately unregister run from server registry to reject late inbound webhooks
          try {
            this.qaGuardService.unregisterActiveTestRun(runId);
          } catch {}

          // 2. Clear all pending waiters & event listeners on WS client
          try {
            this.wsClient.cancelPendingWaiters(
              new AriWebSocketError(`QA test run timed out after ${hardDeadlineMs}ms`),
            );
            this.wsClient.clearAllEventListeners();
          } catch {}

          // 3. Eagerly initiate channel hangups on Asterisk & Telnyx
          if (context.asteriskChannelId) {
            this.ariClient.hangupChannel(context.asteriskChannelId, 'normal').catch(() => {});
          }
          if (context.buyerChannelId) {
            this.ariClient.hangupChannel(context.buyerChannelId, 'normal').catch(() => {});
          }
          if (context.telnyxCallControlId && this.provider) {
            this.provider.hangupCall(context.telnyxCallControlId).catch(() => {});
          }
          if (context.telnyxBuyerCallControlId && this.provider) {
            this.provider.hangupCall(context.telnyxBuyerCallControlId).catch(() => {});
          }

          reject(new Error(`QA test run exceeded hard watchdog limit of ${hardDeadlineMs}ms`));
        }, hardDeadlineMs);
      });

      const runExecution = async () => {
        const getRemainingMs = () => Math.max(500, hardDeadlineMs - (Date.now() - context.startedAt));

        // 8. Pre-register event waiter for caller StasisStart
        const callerWaitLimit = Math.min(15000, getRemainingMs());
        const callerStasisPromise = this.wsClient.waitForEvent<StasisStartEvent>(
          'StasisStart',
          (e) => Array.isArray(e.args) && e.args[0] === 'caller' && e.args[1] === runId,
          callerWaitLimit,
        );
        callerStasisPromise.catch(() => {});

        // 9. Originate caller leg via Asterisk ARI
        const endpoint = `PJSIP/${trackingDid.replace(/\D/g, '')}@telnyx-caller`;
        this.logger.log(`qa.orchestrator.originate: Originating caller channel to ${endpoint}`);
        const channel = await this.ariClient.originateChannel({
          endpoint,
          callerId: callerCli,
          app: 'callflow-qa',
          appArgs: `caller,${runId}`,
          timeoutMs: Math.min(8000, getRemainingMs()),
        });

        context.asteriskChannelId = channel.id;
        context.state = 'CHANNEL_ORIGINATED';

        if (watchdogFired || (context.state as string) === 'FAILED_TIMEOUT') throw new Error('Run timed out');

        // 10. Await caller Stasis entry and verify channel state 'Up'
        this.logger.log(`qa.orchestrator.caller_stasis: Awaiting StasisStart for caller channel ${channel.id}`);
        const callerStasisEvent = await callerStasisPromise;

        let callerState = callerStasisEvent.channel?.state;
        if (callerState !== 'Up') {
          const liveCh = await this.ariClient.getChannel(channel.id, 3000).catch(() => null);
          callerState = liveCh?.state || callerState;
        }

        if (callerState !== 'Up') {
          throw new Error(`Caller channel ${channel.id} entered Stasis with non-Up state "${callerState}"`);
        }
        context.state = 'CALLER_STASIS_UP';
        this.logger.log(`qa.orchestrator.caller_up: Caller channel ${channel.id} is confirmed Up in Stasis`);

        if (watchdogFired || (context.state as string) === 'FAILED_TIMEOUT') throw new Error('Run timed out');

        // 11. Pre-register event waiter for buyer StasisStart
        const buyerWaitLimit = Math.min(20000, getRemainingMs());
        const buyerStasisPromise = this.wsClient.waitForEvent<StasisStartEvent>(
          'StasisStart',
          (e) => Array.isArray(e.args) && e.args[0] === 'buyer',
          buyerWaitLimit,
        );
        buyerStasisPromise.catch(() => {});

        // 12. Await buyer channel Stasis entry
        this.logger.log('qa.orchestrator.buyer_stasis: Awaiting StasisStart for buyer leg from Telnyx');
        const buyerStasisEvent = await buyerStasisPromise;
        const buyerChannelId = buyerStasisEvent.channel?.id;
        if (!buyerChannelId) {
          throw new Error('Buyer StasisStart event received without channel ID');
        }

        // 13. Multi-factor server-side buyer correlation validation
        // Check 1: If runId is present in args, it MUST match
        if (buyerStasisEvent.args && buyerStasisEvent.args[1] && buyerStasisEvent.args[1] !== runId) {
          throw new Error(`Buyer channel runId mismatch: expected "${runId}", got "${buyerStasisEvent.args[1]}"`);
        }

        // Check 2: Verify channel state 'Up' via ARI REST
        let buyerState = buyerStasisEvent.channel?.state;
        if (buyerState !== 'Up') {
          const liveBuyerCh = await this.ariClient.getChannel(buyerChannelId, 3000).catch(() => null);
          buyerState = liveBuyerCh?.state || buyerState;
        }

        if (buyerState !== 'Up') {
          throw new Error(`Buyer channel ${buyerChannelId} entered Stasis with non-Up state "${buyerState}"`);
        }

        context.buyerChannelId = buyerChannelId;
        context.state = 'BUYER_STASIS_UP';
        this.logger.log(`qa.orchestrator.buyer_up: Buyer channel ${buyerChannelId} correlated and verified Up`);

        if (watchdogFired || (context.state as string) === 'FAILED_TIMEOUT') throw new Error('Run timed out');

        // 14. Dual-Channel Recording and Marker Playback
        let callerPassed = false;
        let buyerPassed = false;
        let callerRecName = '';
        let buyerRecName = '';
        let callerValidationReason: string | undefined;
        let buyerValidationReason: string | undefined;

        if (!options.skipMediaAnalysis) {
          callerRecName = `qa-caller-${runId}`;
          buyerRecName = `qa-buyer-${runId}`;
          context.callerRecordingName = callerRecName;
          context.buyerRecordingName = buyerRecName;
          context.recordingName = callerRecName; // backwards compatibility

          const callerSession: QaRecordingSession = {
            leg: 'caller',
            channelId: context.asteriskChannelId!,
            recordingName: callerRecName,
            state: 'STASIS_UP',
            startedAt: Date.now(),
          };
          const buyerSession: QaRecordingSession = {
            leg: 'buyer',
            channelId: context.buyerChannelId!,
            recordingName: buyerRecName,
            state: 'STASIS_UP',
            startedAt: Date.now(),
          };
          context.callerSession = callerSession;
          context.buyerSession = buyerSession;

          // Pre-register Snoop StasisStart waiters before issuing snoopChannel
          const callerSnoopStasis = this.wsClient.waitForEvent<StasisStartEvent>(
            'StasisStart',
            (e) =>
              Array.isArray(e.args) &&
              e.args[0] === 'snoop' &&
              e.args[1] === 'caller' &&
              (!e.args[2] || e.args[2] === runId),
            Math.min(5000, getRemainingMs()),
          );
          callerSnoopStasis.catch(() => {});

          const buyerSnoopStasis = this.wsClient.waitForEvent<StasisStartEvent>(
            'StasisStart',
            (e) =>
              Array.isArray(e.args) &&
              e.args[0] === 'snoop' &&
              e.args[1] === 'buyer' &&
              (!e.args[2] || e.args[2] === runId),
            Math.min(5000, getRemainingMs()),
          );
          buyerSnoopStasis.catch(() => {});

          callerSession.state = 'ATTACHING';
          buyerSession.state = 'ATTACHING';
          this.logLifecycle({
            timestamp: new Date().toISOString(),
            runId,
            leg: 'caller',
            channelId: context.asteriskChannelId!,
            recordingName: callerRecName,
            event: 'SNOOP_ATTACH_REQUESTED',
            state: callerSession.state,
          });
          this.logLifecycle({
            timestamp: new Date().toISOString(),
            runId,
            leg: 'buyer',
            channelId: context.buyerChannelId!,
            recordingName: buyerRecName,
            event: 'SNOOP_ATTACH_REQUESTED',
            state: buyerSession.state,
          });

          // Mandatory Snoop channel attachment (zero silent direct-channel fallback)
          const [callerSnoopRes, buyerSnoopRes] = await Promise.allSettled([
            this.ariClient.snoopChannel(context.asteriskChannelId!, {
              app: 'callflow-qa',
              spy: 'in',
              whisper: 'none',
              appArgs: `snoop,caller,${runId}`,
              timeoutMs: Math.min(3000, getRemainingMs()),
            }),
            this.ariClient.snoopChannel(context.buyerChannelId!, {
              app: 'callflow-qa',
              spy: 'in',
              whisper: 'none',
              appArgs: `snoop,buyer,${runId}`,
              timeoutMs: Math.min(3000, getRemainingMs()),
            }),
          ]);

          if (callerSnoopRes.status === 'fulfilled' && callerSnoopRes.value?.id) {
            context.callerSnoopChannelId = callerSnoopRes.value.id;
            callerSession.snoopChannelId = callerSnoopRes.value.id;
            callerSession.channelId = callerSnoopRes.value.id;
            try {
              await Promise.race([
                callerSnoopStasis,
                new Promise((resolve) => setTimeout(resolve, 500)),
              ]);
            } catch {}
            callerSession.state = 'SNOOP_ATTACHED';
            this.logger.log(`qa.orchestrator: Caller Snoop channel confirmed attached: ${callerSession.snoopChannelId}`);
            this.logLifecycle({
              timestamp: new Date().toISOString(),
              runId,
              leg: 'caller',
              channelId: callerSession.snoopChannelId,
              recordingName: callerRecName,
              event: 'SNOOP_ATTACHED',
              state: callerSession.state,
            });
          } else {
            callerSession.state = 'SNOOP_ATTACHMENT_FAILED';
            callerSession.errorReason = callerSnoopRes.status === 'rejected'
              ? (callerSnoopRes as PromiseRejectedResult).reason?.message || 'Snoop request rejected'
              : 'Snoop channel returned without ID';
            this.logger.error(`qa.orchestrator: Caller Snoop attachment failed: ${callerSession.errorReason}. Silent fallback prohibited.`);
            this.logLifecycle({
              timestamp: new Date().toISOString(),
              runId,
              leg: 'caller',
              channelId: context.asteriskChannelId!,
              recordingName: callerRecName,
              event: 'SNOOP_ATTACHMENT_FAILED',
              state: callerSession.state,
              errorReason: callerSession.errorReason,
            });
          }

          if (buyerSnoopRes.status === 'fulfilled' && buyerSnoopRes.value?.id) {
            context.buyerSnoopChannelId = buyerSnoopRes.value.id;
            buyerSession.snoopChannelId = buyerSnoopRes.value.id;
            buyerSession.channelId = buyerSnoopRes.value.id;
            try {
              await Promise.race([
                buyerSnoopStasis,
                new Promise((resolve) => setTimeout(resolve, 500)),
              ]);
            } catch {}
            buyerSession.state = 'SNOOP_ATTACHED';
            this.logger.log(`qa.orchestrator: Buyer Snoop channel confirmed attached: ${buyerSession.snoopChannelId}`);
            this.logLifecycle({
              timestamp: new Date().toISOString(),
              runId,
              leg: 'buyer',
              channelId: buyerSession.snoopChannelId,
              recordingName: buyerRecName,
              event: 'SNOOP_ATTACHED',
              state: buyerSession.state,
            });
          } else {
            buyerSession.state = 'SNOOP_ATTACHMENT_FAILED';
            buyerSession.errorReason = buyerSnoopRes.status === 'rejected'
              ? (buyerSnoopRes as PromiseRejectedResult).reason?.message || 'Snoop request rejected'
              : 'Snoop channel returned without ID';
            this.logger.error(`qa.orchestrator: Buyer Snoop attachment failed: ${buyerSession.errorReason}. Silent fallback prohibited.`);
            this.logLifecycle({
              timestamp: new Date().toISOString(),
              runId,
              leg: 'buyer',
              channelId: context.buyerChannelId!,
              recordingName: buyerRecName,
              event: 'SNOOP_ATTACHMENT_FAILED',
              state: buyerSession.state,
              errorReason: buyerSession.errorReason,
            });
          }

          // Pre-register recording started waiters with strict Snoop target correlation
          const callerCanRecord = callerSession.state === 'SNOOP_ATTACHED' && !!callerSession.snoopChannelId;
          const buyerCanRecord = buyerSession.state === 'SNOOP_ATTACHED' && !!buyerSession.snoopChannelId;

          let callerRecStarted: Promise<RecordingStartedEvent> | null = null;
          let buyerRecStarted: Promise<RecordingStartedEvent> | null = null;
          const recWaitLimit = Math.min(5000, getRemainingMs());

          if (callerCanRecord) {
            callerRecStarted = this.wsClient.waitForEvent<RecordingStartedEvent>(
              'RecordingStarted',
              (e) =>
                e.recording?.name === callerRecName &&
                (!e.recording?.target_uri ||
                  e.recording?.target_uri === `channel:${callerSession.snoopChannelId}` ||
                  e.recording?.target_uri === `channel:${context.asteriskChannelId}`),
              recWaitLimit,
            );
            callerRecStarted.catch(() => {});
          }

          if (buyerCanRecord) {
            buyerRecStarted = this.wsClient.waitForEvent<RecordingStartedEvent>(
              'RecordingStarted',
              (e) =>
                e.recording?.name === buyerRecName &&
                (!e.recording?.target_uri ||
                  e.recording?.target_uri === `channel:${buyerSession.snoopChannelId}` ||
                  e.recording?.target_uri === `channel:${context.buyerChannelId}`),
              recWaitLimit,
            );
            buyerRecStarted.catch(() => {});
          }

          if (callerCanRecord) {
            this.logLifecycle({
              timestamp: new Date().toISOString(),
              runId,
              leg: 'caller',
              channelId: callerSession.snoopChannelId!,
              recordingName: callerRecName,
              event: 'RECORDING_START_REQUESTED',
              state: callerSession.state,
            });
          }
          if (buyerCanRecord) {
            this.logLifecycle({
              timestamp: new Date().toISOString(),
              runId,
              leg: 'buyer',
              channelId: buyerSession.snoopChannelId!,
              recordingName: buyerRecName,
              event: 'RECORDING_START_REQUESTED',
              state: buyerSession.state,
            });
          }

          // Issue recordChannel requests ONLY to verified Snoop channels
          const recordPromises: Promise<any>[] = [];
          if (callerCanRecord) {
            recordPromises.push(
              this.ariClient.recordChannel(callerSession.snoopChannelId!, {
                name: callerRecName,
                format: 'wav',
                maxDurationSeconds: 15,
                maxSilenceSeconds: 0,
                beep: false,
                ifExists: 'fail',
              }),
            );
          }
          if (buyerCanRecord) {
            recordPromises.push(
              this.ariClient.recordChannel(buyerSession.snoopChannelId!, {
                name: buyerRecName,
                format: 'wav',
                maxDurationSeconds: 15,
                maxSilenceSeconds: 0,
                beep: false,
                ifExists: 'fail',
              }),
            );
          }

          await Promise.allSettled(recordPromises);

          // Confirm recordings started independently
          if (callerCanRecord && callerRecStarted) {
            try {
              await callerRecStarted;
              callerSession.state = 'RECORDING_ACTIVE';
              this.logLifecycle({
                timestamp: new Date().toISOString(),
                runId,
                leg: 'caller',
                channelId: callerSession.snoopChannelId!,
                recordingName: callerRecName,
                event: 'RECORDING_STARTED',
                state: callerSession.state,
              });
            } catch (err: any) {
              callerSession.state = 'RECORDING_START_FAILED';
              callerSession.errorReason = err.message || 'RecordingStarted waiter timed out';
              this.logger.warn(`qa.orchestrator: Caller recording start failed: ${callerSession.errorReason}`);
              this.logLifecycle({
                timestamp: new Date().toISOString(),
                runId,
                leg: 'caller',
                channelId: callerSession.snoopChannelId!,
                recordingName: callerRecName,
                event: 'RECORDING_START_FAILED',
                state: callerSession.state,
                errorReason: callerSession.errorReason,
              });
            }
          }

          if (buyerCanRecord && buyerRecStarted) {
            try {
              await buyerRecStarted;
              buyerSession.state = 'RECORDING_ACTIVE';
              this.logLifecycle({
                timestamp: new Date().toISOString(),
                runId,
                leg: 'buyer',
                channelId: buyerSession.snoopChannelId!,
                recordingName: buyerRecName,
                event: 'RECORDING_STARTED',
                state: buyerSession.state,
              });
            } catch (err: any) {
              buyerSession.state = 'RECORDING_START_FAILED';
              buyerSession.errorReason = err.message || 'RecordingStarted waiter timed out';
              this.logger.warn(`qa.orchestrator: Buyer recording start failed: ${buyerSession.errorReason}`);
              this.logLifecycle({
                timestamp: new Date().toISOString(),
                runId,
                leg: 'buyer',
                channelId: buyerSession.snoopChannelId!,
                recordingName: buyerRecName,
                event: 'RECORDING_START_FAILED',
                state: buyerSession.state,
                errorReason: buyerSession.errorReason,
              });
            }
          }

          context.state = 'RECORDINGS_STARTED';
          this.logger.log('qa.orchestrator.recordings_started: Dual ARI Snoop recordings initialized');

          // 4. Pre-register playback finished waiters on main channels
          const playWaitLimit = Math.min(8000, getRemainingMs());
          const callerPlayDone = this.wsClient.waitForEvent<PlaybackFinishedEvent>(
            'PlaybackFinished',
            (e) => e.playback?.target_uri === `channel:${context.asteriskChannelId}`,
            playWaitLimit,
          );
          callerPlayDone.catch(() => {});
          const buyerPlayDone = this.wsClient.waitForEvent<PlaybackFinishedEvent>(
            'PlaybackFinished',
            (e) => e.playback?.target_uri === `channel:${context.buyerChannelId}`,
            playWaitLimit,
          );
          buyerPlayDone.catch(() => {});

          if (callerSession.state === 'RECORDING_ACTIVE') {
            callerSession.state = 'PLAYBACK_ACTIVE';
            this.logLifecycle({
              timestamp: new Date().toISOString(),
              runId,
              leg: 'caller',
              channelId: context.asteriskChannelId!,
              recordingName: callerRecName,
              event: 'PLAYBACK_REQUESTED',
              state: callerSession.state,
            });
          }

          if (buyerSession.state === 'RECORDING_ACTIVE') {
            buyerSession.state = 'PLAYBACK_ACTIVE';
            this.logLifecycle({
              timestamp: new Date().toISOString(),
              runId,
              leg: 'buyer',
              channelId: context.buyerChannelId!,
              recordingName: buyerRecName,
              event: 'PLAYBACK_REQUESTED',
              state: buyerSession.state,
            });
          }

          // 5. Trigger marker playbacks (caller transmits 1000 Hz, buyer transmits 1500 Hz)
          await Promise.allSettled([
            this.ariClient.playMedia(context.asteriskChannelId!, 'sound:/var/lib/asterisk/sounds/qa/qa-caller-marker'),
            this.ariClient.playMedia(context.buyerChannelId!, 'sound:/var/lib/asterisk/sounds/qa/qa-buyer-marker'),
          ]);

          // 6. Decoupled Playback Completion (Promise.allSettled ensures neither leg aborts the other)
          const [callerPlayRes, buyerPlayRes] = await Promise.allSettled([callerPlayDone, buyerPlayDone]);
          if (callerSession.state !== 'SNOOP_ATTACHMENT_FAILED' && callerSession.state !== 'RECORDING_START_FAILED') {
            if (callerPlayRes.status === 'fulfilled') {
              callerSession.state = 'PLAYBACK_COMPLETED';
              this.logLifecycle({
                timestamp: new Date().toISOString(),
                runId,
                leg: 'caller',
                channelId: context.asteriskChannelId!,
                recordingName: callerRecName,
                event: 'PLAYBACK_FINISHED',
                state: callerSession.state,
              });
            } else {
              callerSession.state = 'PLAYBACK_ERROR';
              callerSession.errorReason = (callerPlayRes as PromiseRejectedResult).reason?.message || 'Caller playback timed out';
              this.logger.warn(`qa.orchestrator: Caller playback did not complete: ${callerSession.errorReason}`);
              this.logLifecycle({
                timestamp: new Date().toISOString(),
                runId,
                leg: 'caller',
                channelId: context.asteriskChannelId!,
                recordingName: callerRecName,
                event: 'PLAYBACK_TIMEOUT',
                state: callerSession.state,
                errorReason: callerSession.errorReason,
              });
            }
          }

          if (buyerSession.state !== 'SNOOP_ATTACHMENT_FAILED' && buyerSession.state !== 'RECORDING_START_FAILED') {
            if (buyerPlayRes.status === 'fulfilled') {
              buyerSession.state = 'PLAYBACK_COMPLETED';
              this.logLifecycle({
                timestamp: new Date().toISOString(),
                runId,
                leg: 'buyer',
                channelId: context.buyerChannelId!,
                recordingName: buyerRecName,
                event: 'PLAYBACK_FINISHED',
                state: buyerSession.state,
              });
            } else {
              buyerSession.state = 'PLAYBACK_ERROR';
              buyerSession.errorReason = (buyerPlayRes as PromiseRejectedResult).reason?.message || 'Buyer playback timed out';
              this.logger.warn(`qa.orchestrator: Buyer playback did not complete: ${buyerSession.errorReason}`);
              this.logLifecycle({
                timestamp: new Date().toISOString(),
                runId,
                leg: 'buyer',
                channelId: context.buyerChannelId!,
                recordingName: buyerRecName,
                event: 'PLAYBACK_TIMEOUT',
                state: buyerSession.state,
                errorReason: buyerSession.errorReason,
              });
            }
          }

          context.state = 'PLAYBACK_FINISHED';
          this.logger.log('qa.orchestrator.playback_finished: Marker playback phase concluded');

          // Configurable post-playback capture interval (default 7000ms, clamped 1000ms - 15000ms, or positive in tests)
          if (callerSession.state !== 'SNOOP_ATTACHMENT_FAILED' && callerSession.state !== 'RECORDING_START_FAILED') {
            callerSession.state = 'CAPTURING';
            this.logLifecycle({
              timestamp: new Date().toISOString(),
              runId,
              leg: 'caller',
              channelId: callerSession.snoopChannelId || context.asteriskChannelId!,
              recordingName: callerRecName,
              event: 'CAPTURE_INTERVAL_STARTED',
              state: callerSession.state,
            });
          }
          if (buyerSession.state !== 'SNOOP_ATTACHMENT_FAILED' && buyerSession.state !== 'RECORDING_START_FAILED') {
            buyerSession.state = 'CAPTURING';
            this.logLifecycle({
              timestamp: new Date().toISOString(),
              runId,
              leg: 'buyer',
              channelId: buyerSession.snoopChannelId || context.buyerChannelId!,
              recordingName: buyerRecName,
              event: 'CAPTURE_INTERVAL_STARTED',
              state: buyerSession.state,
            });
          }

          const envCaptureMs = process.env.TELEPHONY_QA_RECORDING_CAPTURE_INTERVAL_MS
            ? parseInt(process.env.TELEPHONY_QA_RECORDING_CAPTURE_INTERVAL_MS, 10)
            : 7000;
          const rawCaptureMs = options.postPlaybackCaptureMs ?? envCaptureMs;
          const minAllowedCaptureMs = options.postPlaybackCaptureMs !== undefined ? 1 : 1000;
          const boundedCaptureMs = Math.max(minAllowedCaptureMs, Math.min(15000, isNaN(rawCaptureMs) ? 7000 : rawCaptureMs));

          const remainingWatchdog = getRemainingMs();
          if (remainingWatchdog < boundedCaptureMs) {
            throw new Error(`Insufficient remaining watchdog time (${remainingWatchdog}ms) for requested capture interval (${boundedCaptureMs}ms)`);
          }
          const actualCaptureDelayMs = Math.min(boundedCaptureMs, Math.max(100, remainingWatchdog - 1000));
          this.logger.log(
            `qa.orchestrator.capture: Capturing post-playback media for ${actualCaptureDelayMs}ms (requested: ${boundedCaptureMs}ms, remaining: ${remainingWatchdog}ms)`,
          );
          await new Promise((resolve) => setTimeout(resolve, actualCaptureDelayMs));

          if (watchdogFired || (context.state as string) === 'FAILED_TIMEOUT') throw new Error('Run timed out');

          // 7. Pre-register recording finished waiters before initiating stop
          const recFinishWaitLimit = Math.min(5000, getRemainingMs());
          const callerRecFinished = this.wsClient.waitForEvent<RecordingFinishedEvent>(
            'RecordingFinished',
            (e) =>
              e.recording?.name === callerRecName &&
              (!e.recording?.target_uri ||
                e.recording?.target_uri === `channel:${callerSession.snoopChannelId}` ||
                e.recording?.target_uri === `channel:${context.asteriskChannelId}`),
            recFinishWaitLimit,
          );
          callerRecFinished.catch(() => {});
          const buyerRecFinished = this.wsClient.waitForEvent<RecordingFinishedEvent>(
            'RecordingFinished',
            (e) =>
              e.recording?.name === buyerRecName &&
              (!e.recording?.target_uri ||
                e.recording?.target_uri === `channel:${buyerSession.snoopChannelId}` ||
                e.recording?.target_uri === `channel:${context.buyerChannelId}`),
            recFinishWaitLimit,
          );
          buyerRecFinished.catch(() => {});

          // Independent finalization: finalizeLegRecording runs concurrently on both sessions
          const [callerWavRes, buyerWavRes] = await Promise.allSettled([
            this.finalizeLegRecording(callerSession, context, Math.min(5000, getRemainingMs()), callerRecFinished),
            this.finalizeLegRecording(buyerSession, context, Math.min(5000, getRemainingMs()), buyerRecFinished),
          ]);

          if (callerWavRes.status === 'rejected') {
            throw callerWavRes.reason;
          }
          if (buyerWavRes.status === 'rejected') {
            throw buyerWavRes.reason;
          }

          callerWav = callerWavRes.value;
          buyerWav = buyerWavRes.value;

          context.state = 'RECORDINGS_FINISHED';
          this.logger.log('qa.orchestrator.recordings_finished: Both recordings finalized independently');

          if (callerWav && buyerWav) {
            context.state = 'RECORDINGS_DOWNLOADED';
          }

          // Persist WAV buffers to disk for historical audit and forensic report
          try {
            const recDir = path.resolve(process.cwd(), 'qa/recordings');
            if (!fs.existsSync(recDir)) {
              fs.mkdirSync(recDir, { recursive: true });
            }
            if (callerWav) {
              callerWavPath = path.join(recDir, `${callerRecName}.wav`);
              fs.writeFileSync(callerWavPath, callerWav);
              this.logger.log(`qa.orchestrator: Preserved caller WAV at ${callerWavPath} (${callerWav.length} bytes)`);
            }
            if (buyerWav) {
              buyerWavPath = path.join(recDir, `${buyerRecName}.wav`);
              fs.writeFileSync(buyerWavPath, buyerWav);
              this.logger.log(`qa.orchestrator: Preserved buyer WAV at ${buyerWavPath} (${buyerWav.length} bytes)`);
            }
          } catch (fileErr: any) {
            this.logger.warn(`qa.orchestrator: Failed to persist WAV buffers to disk: ${fileErr.message}`);
          }

          // Strict Recording Buffer Validation & Mathematical Audio Verification
          callerValidationReason = undefined;
          if (!callerWav) {
            this.logger.warn(`qa.orchestrator.recording_missing: Caller recording ${callerRecName} not found in live or stored state`);
            callerValidationReason = `Caller recording "${callerRecName}" not found in live or stored state`;
            audioAnalysis = {
              passed: false,
              metadata: { sampleRate: 0, channels: 0, bitsPerSample: 0, durationSeconds: 0, sampleCount: 0 },
              targetFrequency: 1500,
              snrDb: 0,
              minSnrMet: false,
              durationSeconds: 0,
              minDurationMet: false,
              isSilent: true,
              rmsDbfs: -100,
              clippingRatio: 0,
              isClipped: false,
              reasons: [callerValidationReason],
            };
            callerPassed = false;
          } else {
            const validation = this.validateRecordingBuffer(callerWav, callerRecName);
            if (!validation.valid) {
              this.logger.warn(
                `qa.orchestrator.recording_invalid: Caller recording "${callerRecName}" failed validation: ${validation.reason}`,
              );
              callerValidationReason = validation.reason;
              audioAnalysis = {
                passed: false,
                metadata: { sampleRate: 0, channels: 0, bitsPerSample: 0, durationSeconds: 0, sampleCount: 0 },
                targetFrequency: 1500,
                snrDb: 0,
                minSnrMet: false,
                durationSeconds: 0,
                minDurationMet: false,
                isSilent: true,
                rmsDbfs: -100,
                clippingRatio: 0,
                isClipped: false,
                reasons: [validation.reason!],
              };
              callerPassed = false;
            } else {
              audioAnalysis = this.audioAnalyzer.analyzeRecording(callerWav, {
                targetFreq: 1500,
                minSnrDb: options.minSnrDb ?? 5.0,
                minDurationSecs: options.minDurationSecs ?? 1.5,
              });
              callerPassed = audioAnalysis.passed;
              if (!callerPassed) {
                callerValidationReason = audioAnalysis.reasons.join('; ');
              }
            }
          }

          buyerValidationReason = undefined;
          if (!buyerWav) {
            this.logger.warn(`qa.orchestrator.recording_missing: Buyer recording ${buyerRecName} not found in live or stored state`);
            buyerValidationReason = `Buyer recording "${buyerRecName}" not found in live or stored state`;
            buyerAudioAnalysis = {
              passed: false,
              metadata: { sampleRate: 0, channels: 0, bitsPerSample: 0, durationSeconds: 0, sampleCount: 0 },
              targetFrequency: 1000,
              snrDb: 0,
              minSnrMet: false,
              durationSeconds: 0,
              minDurationMet: false,
              isSilent: true,
              rmsDbfs: -100,
              clippingRatio: 0,
              isClipped: false,
              reasons: [buyerValidationReason],
            };
            buyerPassed = false;
          } else {
            const validation = this.validateRecordingBuffer(buyerWav, buyerRecName);
            if (!validation.valid) {
              this.logger.warn(
                `qa.orchestrator.recording_invalid: Buyer recording "${buyerRecName}" failed validation: ${validation.reason}`,
              );
              buyerValidationReason = validation.reason;
              buyerAudioAnalysis = {
                passed: false,
                metadata: { sampleRate: 0, channels: 0, bitsPerSample: 0, durationSeconds: 0, sampleCount: 0 },
                targetFrequency: 1000,
                snrDb: 0,
                minSnrMet: false,
                durationSeconds: 0,
                minDurationMet: false,
                isSilent: true,
                rmsDbfs: -100,
                clippingRatio: 0,
                isClipped: false,
                reasons: [validation.reason!],
              };
              buyerPassed = false;
            } else {
              buyerAudioAnalysis = this.audioAnalyzer.analyzeRecording(buyerWav, {
                targetFreq: 1000,
                minSnrDb: options.minSnrDb ?? 5.0,
                minDurationSecs: options.minDurationSecs ?? 1.5,
              });
              buyerPassed = buyerAudioAnalysis.passed;
              if (!buyerPassed) {
                buyerValidationReason = buyerAudioAnalysis.reasons.join('; ');
              }
            }
          }

          if (context.callerSession) {
            context.callerSession.analysis = audioAnalysis;
            context.callerSession.validationReason = callerValidationReason;
            if (context.callerSession.state !== 'SNOOP_ATTACHMENT_FAILED' && context.callerSession.state !== 'RECORDING_START_FAILED') {
              context.callerSession.state = callerPassed ? 'VALIDATED' : 'AUDIO_VALIDATION_FAILED';
            }
            this.logLifecycle({
              timestamp: new Date().toISOString(),
              runId,
              leg: 'caller',
              channelId: context.callerSession.channelId,
              recordingName: callerRecName,
              event: callerPassed ? 'VALIDATED' : 'VALIDATION_FAILED',
              durationMs: context.callerSession.durationMs,
              state: context.callerSession.state,
              audioBytesWritten: context.callerSession.audioBytesWritten ?? 0,
              sampleCount: context.callerSession.sampleCount ?? 0,
              errorReason: callerValidationReason,
            });
          }

          if (context.buyerSession) {
            context.buyerSession.analysis = buyerAudioAnalysis;
            context.buyerSession.validationReason = buyerValidationReason;
            if (context.buyerSession.state !== 'SNOOP_ATTACHMENT_FAILED' && context.buyerSession.state !== 'RECORDING_START_FAILED') {
              context.buyerSession.state = buyerPassed ? 'VALIDATED' : 'AUDIO_VALIDATION_FAILED';
            }
            this.logLifecycle({
              timestamp: new Date().toISOString(),
              runId,
              leg: 'buyer',
              channelId: context.buyerSession.channelId,
              recordingName: buyerRecName,
              event: buyerPassed ? 'VALIDATED' : 'VALIDATION_FAILED',
              durationMs: context.buyerSession.durationMs,
              state: context.buyerSession.state,
              audioBytesWritten: context.buyerSession.audioBytesWritten ?? 0,
              sampleCount: context.buyerSession.sampleCount ?? 0,
              errorReason: buyerValidationReason,
            });
          }

          if (audioAnalysis && buyerAudioAnalysis) {
            context.state = 'ANALYZED';
            this.logger.log(
              `qa.orchestrator.analyzed: Caller(1500Hz)=${audioAnalysis.passed} (SNR ${audioAnalysis.snrDb.toFixed(1)}dB), Buyer(1000Hz)=${buyerAudioAnalysis.passed} (SNR ${buyerAudioAnalysis.snrDb.toFixed(1)}dB)`,
            );
          }
        }

        const allPassed = options.skipMediaAnalysis
          ? true
          : Boolean(callerPassed && buyerPassed);

        context.state = allPassed ? 'COMPLETED' : 'FAILED';

        if (!allPassed) {
          if (!callerWav && !buyerWav) {
            runError = 'Both caller and buyer recordings not found in live or stored state';
          } else if (!callerWav) {
            runError = `Caller recording "${callerRecName}" not found in live or stored state`;
          } else if (!buyerWav) {
            runError = `Buyer recording "${buyerRecName}" not found in live or stored state`;
          } else if (!callerPassed && !buyerPassed) {
            runError = `Both caller and buyer recordings failed validation: Caller: ${callerValidationReason}; Buyer: ${buyerValidationReason}`;
          } else if (!callerPassed) {
            runError = `Caller recording failed validation: ${callerValidationReason}`;
          } else if (!buyerPassed) {
            runError = `Buyer recording failed validation: ${buyerValidationReason}`;
          } else {
            runError = 'Audio frequency analysis verification failed';
          }
        }
      };

      await Promise.race([runExecution(), watchdogPromise]);

      return {
        success: (context.state as string) === 'COMPLETED',
        runId,
        context: { ...context },
        audioAnalysis,
        buyerAudioAnalysis,
        cleanupSummary: await this.cleanup(context),
        ...(runError ? { error: runError } : {}),
        callerAudioBase64: (callerWav as Buffer | null)?.toString('base64'),
        buyerAudioBase64: (buyerWav as Buffer | null)?.toString('base64'),
        callerWavPath,
        buyerWavPath,
      };
    } catch (err: any) {
      if (watchdogFired || (context.state as string) === 'FAILED_TIMEOUT') {
        context.state = 'FAILED_TIMEOUT';
        runError = `Hard watchdog limit of ${hardDeadlineMs}ms exceeded: ${err.message}`;
      } else {
        context.state = 'FAILED';
        runError = err.message || String(err);
      }
      this.logger.error(`qa.orchestrator.failed: Run ${runId} failed: ${runError}`);

      const cleanupSummary = await this.cleanup(context);

      return {
        success: false,
        runId,
        context: { ...context },
        audioAnalysis,
        buyerAudioAnalysis,
        cleanupSummary,
        error: runError,
        callerAudioBase64: (callerWav as Buffer | null)?.toString('base64'),
        buyerAudioBase64: (buyerWav as Buffer | null)?.toString('base64'),
        callerWavPath,
        buyerWavPath,
      };
    } finally {
      if (watchdogTimer) {
        clearTimeout(watchdogTimer);
        watchdogTimer = null;
      }
      // Always release mutex
      this.activeRun = null;
      this.logger.log(`qa.orchestrator.mutex_released: Mutex released for run ${runId}`);
    }
  }

  /**
   * Strictly validates an Asterisk ARI recording buffer.
   * Rejects empty buffers, sub-44-byte fragments, 44-byte header-only files (0 audio samples),
   * invalid RIFF/WAVE headers, and non-positive sample count / duration.
   */
  public validateRecordingBuffer(
    buffer: Buffer | null,
    name: string,
  ): { valid: boolean; reason?: string } {
    if (!buffer || buffer.length === 0) {
      return { valid: false, reason: `Recording "${name}" is empty or not retrieved (0 bytes)` };
    }
    if (buffer.length < 44) {
      return { valid: false, reason: `Recording "${name}" is truncated (${buffer.length} bytes < 44-byte header)` };
    }
    if (buffer.length === 44) {
      return {
        valid: false,
        reason: `Recording "${name}" is an empty 44-byte header-only WAV file with zero audio samples`,
      };
    }
    const riff = buffer.toString('ascii', 0, 4);
    const wave = buffer.toString('ascii', 8, 12);
    if (riff !== 'RIFF' || wave !== 'WAVE') {
      return {
        valid: false,
        reason: `Recording "${name}" has invalid header magic ("${riff}"/"${wave}" != RIFF/WAVE)`,
      };
    }
    if (this.audioAnalyzer && typeof this.audioAnalyzer.parseWav === 'function') {
      try {
        const parsed = this.audioAnalyzer.parseWav(buffer);
        if (parsed.metadata.sampleCount <= 0) {
          return {
            valid: false,
            reason: `Recording "${name}" contains zero audio samples (sampleCount=0)`,
          };
        }
        if (parsed.metadata.durationSeconds <= 0) {
          return {
            valid: false,
            reason: `Recording "${name}" has non-positive duration (${parsed.metadata.durationSeconds}s)`,
          };
        }
      } catch (err: any) {
        return {
          valid: false,
          reason: `Recording "${name}" failed WAV parse: ${err.message}`,
        };
      }
    }
    return { valid: true };
  }

  /**
   * Emits structured JSON lifecycle event log containing all 13 required forensic fields.
   */
  public logLifecycle(entry: StructuredLifecycleLog): void {
    const payload = {
      timestamp: entry.timestamp || new Date().toISOString(),
      runId: entry.runId,
      leg: entry.leg,
      channelId: entry.channelId,
      recordingName: entry.recordingName,
      event: entry.event,
      durationMs: entry.durationMs ?? 0,
      state: entry.state,
      httpStatus: entry.httpStatus ?? 200,
      pcapPacketsSeen: entry.pcapPacketsSeen ?? 0,
      audioBytesWritten: entry.audioBytesWritten ?? 0,
      sampleCount: entry.sampleCount ?? 0,
      errorReason: entry.errorReason || '',
    };
    this.logger.log(`qa.lifecycle: ${JSON.stringify(payload)}`);
  }

  /**
   * Finalizes an individual leg's recording session independently.
   * Ensures that caller and buyer recording finalizations cannot block, corrupt, or abort each other.
   */
  public async finalizeLegRecording(
    session: QaRecordingSession,
    context: QaRunContext,
    timeoutMs: number,
    finishedPromise?: Promise<RecordingFinishedEvent>,
  ): Promise<Buffer | null> {
    if (session.state === 'SNOOP_ATTACHMENT_FAILED' || session.state === 'RECORDING_START_FAILED') {
      this.logger.warn(
        `qa.orchestrator: Skipping finalization for leg ${session.leg} because recording was not active (state: ${session.state})`,
      );
      return null;
    }

    const startTime = Date.now();
    session.state = 'STOP_REQUESTED';
    this.logLifecycle({
      timestamp: new Date().toISOString(),
      runId: context.runId,
      leg: session.leg,
      channelId: session.channelId,
      recordingName: session.recordingName,
      event: 'RECORDING_STOP_REQUESTED',
      durationMs: 0,
      state: session.state,
      httpStatus: 200,
    });

    let buffer: Buffer | null = null;
    let httpStatus = 200;
    let errorReason: string | undefined;

    try {
      buffer = await this.finalizeAndRetrieveRecording(
        session.recordingName,
        timeoutMs,
        finishedPromise,
      );
      if (buffer && buffer.length > 0) {
        session.audioBuffer = buffer;
        session.audioBytesWritten = buffer.length;
        httpStatus = 200;

        if (this.audioAnalyzer && typeof this.audioAnalyzer.parseWav === 'function') {
          try {
            const parsed = this.audioAnalyzer.parseWav(buffer);
            session.sampleCount = parsed.metadata.sampleCount;
          } catch {
            session.sampleCount = 0;
          }
        }
      } else {
        httpStatus = 404;
        errorReason = `Recording buffer for "${session.recordingName}" was null or empty`;
      }
    } catch (err: any) {
      httpStatus = err instanceof AsteriskAriError && err.statusCode ? err.statusCode : 500;
      errorReason = err.message || String(err);
      this.logger.warn(`qa.orchestrator: Leg ${session.leg} recording retrieval error: ${errorReason}`);
      if (err instanceof AsteriskAriError && err.statusCode && err.statusCode !== 404) {
        throw err;
      }
    }

    session.stoppedAt = Date.now();
    session.durationMs = session.stoppedAt - (session.startedAt || startTime);
    session.httpStatus = httpStatus;
    session.errorReason = errorReason;
    session.state = buffer && buffer.length > 44 ? 'FINALIZED' : 'RECORDING_FINALIZATION_FAILED';

    this.logLifecycle({
      timestamp: new Date().toISOString(),
      runId: context.runId,
      leg: session.leg,
      channelId: session.channelId,
      recordingName: session.recordingName,
      event: buffer ? 'RECORDING_DOWNLOADED' : 'RECORDING_FAILED',
      durationMs: session.durationMs,
      state: session.state,
      httpStatus,
      audioBytesWritten: session.audioBytesWritten ?? 0,
      sampleCount: session.sampleCount ?? 0,
      errorReason,
    });

    return buffer;
  }

  /**
   * Safely finalizes a recording and retrieves the stored audio buffer.
   * Handles:
   * Case A: Recording still live -> stops it, awaits RecordingFinished, retrieves stored file.
   * Case B: Recording already finished -> handles HTTP 404 on stop, retrieves stored file.
   * Case C: Recording missing in both live and stored state -> returns null (controlled media failure).
   * Case D: Unexpected ARI error (non-404) -> rethrows.
   */
  public async finalizeAndRetrieveRecording(
    recordingName: string,
    timeoutMs: number,
    finishedPromise?: Promise<RecordingFinishedEvent>,
  ): Promise<Buffer | null> {
    // 1. Attempt to stop live recording
    try {
      this.logger.log(`qa.orchestrator.recording: Stopping live recording "${recordingName}"`);
      await this.ariClient.stopRecording(recordingName, Math.min(3000, timeoutMs));
      this.logger.log(`qa.orchestrator.recording: Live recording "${recordingName}" stop request accepted`);
    } catch (err: any) {
      if (err instanceof AsteriskAriError && err.statusCode === 404) {
        // Case B: Recording is no longer live (has already finished)
        this.logger.log(
          `qa.orchestrator.recording: Recording "${recordingName}" is no longer live (already finished or not live). Checking stored state.`,
        );
      } else {
        // Case D: Unexpected ARI error on stop - preserve and rethrow
        this.logger.error(`qa.orchestrator.recording: Unexpected error stopping "${recordingName}": ${err.message}`);
        throw err;
      }
    }

    // 2. Await RecordingFinished event if waiter was provided (with grace timeout)
    if (finishedPromise) {
      try {
        await Promise.race([
          finishedPromise,
          new Promise((resolve) => setTimeout(resolve, Math.min(2000, timeoutMs))),
        ]);
      } catch (e: any) {
        this.logger.debug(`qa.orchestrator.recording: RecordingFinished waiter resolved/timed out: ${e?.message}`);
      }
    }

    // Brief flush grace to allow Asterisk to finish writing the WAV container to disk
    await new Promise((resolve) => setTimeout(resolve, 150));

    // 3. Retrieve stored recording file
    try {
      this.logger.log(`qa.orchestrator.recording: Downloading stored recording buffer for "${recordingName}"`);
      const buffer = await this.ariClient.getStoredRecordingFile(recordingName, timeoutMs);
      if (!buffer || buffer.length === 0) {
        this.logger.warn(`qa.orchestrator.recording: Stored recording "${recordingName}" returned empty buffer`);
        return null;
      }
      return buffer;
    } catch (err: any) {
      if (err instanceof AsteriskAriError && err.statusCode === 404) {
        // Case C: Recording does not exist in live or stored state
        this.logger.warn(
          `qa.orchestrator.recording_missing: Recording "${recordingName}" does not exist in live or stored state`,
        );
        return null;
      }
      // Case D: Unexpected ARI error on download - preserve and rethrow
      this.logger.error(
        `qa.orchestrator.recording: Unexpected error downloading stored recording "${recordingName}": ${err.message}`,
      );
      throw err;
    }
  }

  /**
   * Performs idempotent 10-target cleanup across Asterisk, Telnyx, registry, and wallet.
   * Safe against concurrent invocations (in-flight deduplication and post-cleanup caching).
   */
  public cleanup(context: QaRunContext): Promise<QaCleanupSummary> {
    if (this.cleanedRuns.has(context.runId)) {
      return Promise.resolve(this.cleanedRuns.get(context.runId)!);
    }
    if (this.inFlightCleanups.has(context.runId)) {
      return this.inFlightCleanups.get(context.runId)!;
    }

    const cleanupPromise = this.executeCleanup(context).finally(() => {
      this.inFlightCleanups.delete(context.runId);
    });

    this.inFlightCleanups.set(context.runId, cleanupPromise);
    return cleanupPromise;
  }

  private async executeCleanup(context: QaRunContext): Promise<QaCleanupSummary> {
    const summary: QaCleanupSummary = {
      asteriskChannelHungUp: false,
      buyerChannelHungUp: false,
      telnyxLegHungUp: false,
      recordingStopped: false,
      recordingDeleted: false,
      testRunUnregistered: false,
      callBindingReleased: false,
      leasesCleaned: false,
      walletReservationReleased: false,
      webSocketDisconnected: false,
    };

    // Target 1: Stop Asterisk recordings first to flush WAV buffers safely
    const recordingsToStop = [
      context.callerRecordingName,
      context.buyerRecordingName,
      context.recordingName,
    ].filter(Boolean) as string[];

    for (const rec of recordingsToStop) {
      try {
        await this.ariClient.stopRecording(rec);
        summary.recordingStopped = true;
      } catch (err: any) {
        this.logger.debug(`Cleanup Target 1 (Stop recording ${rec}): ${err.message}`);
      }
    }

    // Target 2: Hang up Snoop channels before parent channels
    if (context.callerSnoopChannelId) {
      try {
        await this.ariClient.hangupChannel(context.callerSnoopChannelId, 'normal');
        summary.callerSnoopHungUp = true;
      } catch (err: any) {
        this.logger.debug(`Cleanup Target 2 (Caller snoop channel): ${err.message}`);
      }
    }
    if (context.buyerSnoopChannelId) {
      try {
        await this.ariClient.hangupChannel(context.buyerSnoopChannelId, 'normal');
        summary.buyerSnoopHungUp = true;
      } catch (err: any) {
        this.logger.debug(`Cleanup Target 2 (Buyer snoop channel): ${err.message}`);
      }
    }

    // Target 3: Hang up Asterisk main ARI channels
    if (context.asteriskChannelId) {
      try {
        await this.ariClient.hangupChannel(context.asteriskChannelId, 'normal');
        summary.asteriskChannelHungUp = true;
      } catch (err: any) {
        this.logger.warn(`Cleanup Target 3 (Caller main channel): ${err.message}`);
      }
    }
    if (context.buyerChannelId) {
      try {
        await this.ariClient.hangupChannel(context.buyerChannelId, 'normal');
        summary.buyerChannelHungUp = true;
      } catch (err: any) {
        this.logger.warn(`Cleanup Target 3 (Buyer main channel): ${err.message}`);
      }
    }

    // Target 4: Hang up Telnyx legs
    if (context.telnyxCallControlId && this.provider) {
      try {
        await this.provider.hangupCall(context.telnyxCallControlId);
        summary.telnyxLegHungUp = true;
      } catch (err: any) {
        this.logger.warn(`Cleanup Target 4 (Telnyx inbound leg): ${err.message}`);
      }
    }
    if (context.telnyxBuyerCallControlId && this.provider) {
      try {
        await this.provider.hangupCall(context.telnyxBuyerCallControlId);
        summary.telnyxLegHungUp = true;
      } catch (err: any) {
        this.logger.warn(`Cleanup Target 4 (Telnyx buyer leg): ${err.message}`);
      }
    }

    // Target 5: Delete Asterisk stored recordings (skipped if preserveRecordings is true)
    if (!context.preserveRecordings) {
      for (const rec of recordingsToStop) {
        try {
          await this.ariClient.deleteStoredRecording(rec);
          summary.recordingDeleted = true;
        } catch (err: any) {
          this.logger.debug(`Cleanup Target 5 (Delete recording ${rec}): ${err.message}`);
        }
      }
    } else {
      this.logger.log(`qa.cleanup: Preserved stored recordings on Asterisk disk for forensics [${recordingsToStop.join(', ')}]`);
    }

    // Target 6: Unregister test run from server registry
    try {
      this.qaGuardService.unregisterActiveTestRun(context.runId);
      summary.testRunUnregistered = true;
    } catch (err: any) {
      this.logger.warn(`Cleanup Target 6 (Unregister run): ${err.message}`);
    }

    // Target 7: Release call bindings
    if (context.prismaCallId || context.telnyxCallControlId || context.telnyxBuyerCallControlId) {
      try {
        if (context.prismaCallId) {
          this.qaGuardService.releaseCallBinding(context.prismaCallId);
        }
        if (context.telnyxCallControlId) {
          this.qaGuardService.releaseCallBinding(context.telnyxCallControlId);
        }
        if (context.telnyxBuyerCallControlId) {
          this.qaGuardService.releaseCallBinding(context.telnyxBuyerCallControlId);
        }
        summary.callBindingReleased = true;
      } catch (err: any) {
        this.logger.warn(`Cleanup Target 7 (Release bindings): ${err.message}`);
      }
    }

    // Target 8: Expire and clean inbound leases
    try {
      this.qaGuardService.expireStaleBindings();
      summary.leasesCleaned = true;
    } catch (err: any) {
      this.logger.warn(`Cleanup Target 8 (Clean leases): ${err.message}`);
    }

    // Target 9: Release wallet reservation (if any was reserved)
    if (context.workspaceId && (context.prismaCallId || context.telnyxCallControlId) && this.walletService) {
      const callRef = context.prismaCallId || context.telnyxCallControlId!;
      try {
        await this.walletService.releaseReservation(context.workspaceId, callRef);
        summary.walletReservationReleased = true;
      } catch (err: any) {
        this.logger.debug(`Cleanup Target 9 (Release wallet reservation): ${err.message}`);
      }
    }

    // Target 10: Disconnect ARI WebSocket
    try {
      await this.wsClient.disconnect();
      summary.webSocketDisconnected = true;
    } catch (err: any) {
      this.logger.warn(`Cleanup Target 10 (Disconnect WebSocket): ${err.message}`);
    }

    this.logger.log(
      `qa.cleanup.completed: Run ${context.runId} cleaned up [ChCaller:${summary.asteriskChannelHungUp}, ChBuyer:${summary.buyerChannelHungUp}, Telnyx:${summary.telnyxLegHungUp}, RecStop:${summary.recordingStopped}, RecDel:${summary.recordingDeleted}, Reg:${summary.testRunUnregistered}, Bind:${summary.callBindingReleased}, Leases:${summary.leasesCleaned}, Wallet:${summary.walletReservationReleased}, WS:${summary.webSocketDisconnected}]`,
    );

    this.cleanedRuns.set(context.runId, summary);
    return summary;
  }
}
