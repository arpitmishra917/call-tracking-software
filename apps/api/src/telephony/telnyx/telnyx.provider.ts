import { Injectable, Logger } from '@nestjs/common';
import { TelephonyProvider } from '../telephony.provider.js';
import {
  TelephonyProviderError,
  TelephonyErrorType,
} from '../telephony.errors.js';
import Telnyx from 'telnyx';

@Injectable()
export class TelnyxProvider implements TelephonyProvider {
  private readonly logger = new Logger(TelnyxProvider.name);
  private telnyxClient: any;
  private activePlaybacks = new Set<string>();

  constructor() {
    const configuredProvider = (
      process.env.TELEPHONY_PROVIDER ||
      process.env.ACTIVE_TELEPHONY_PROVIDER ||
      'telnyx'
    ).trim().toLowerCase();

    const apiKey = process.env.TELNYX_API_KEY;
    const isExplicitMock = configuredProvider === 'fake' || configuredProvider === 'mock';

    if (isExplicitMock) {
      this.logger.warn(
        `TelnyxProvider initialized in EXPLICIT MOCK mode (provider: ${configuredProvider}). Real carrier calls will NOT be dispatched.`,
      );
      this.telnyxClient = undefined;
      return;
    }

    if (!apiKey || !apiKey.trim()) {
      const errorMsg =
        'FATAL: TELNYX_API_KEY is missing but telephony provider is configured as "telnyx". Telnyx mode fails closed to prevent silent mock fallback.';
      this.logger.error(errorMsg);
      throw new Error(errorMsg);
    }

    const telnyxFactory = Telnyx as any;
    this.telnyxClient = new telnyxFactory({ apiKey });
    this.logger.log(
      `TelnyxProvider initialized: providerMode=LIVE, credentialPresent=${Boolean(apiKey)}`,
    );
  }

  public isSyntheticCallId(callId?: string): boolean {
    return this.isMockCallId(callId);
  }

  public isMockCallId(callId?: string): boolean {
    if (!callId) return false;
    return (
      callId.startsWith('mock_') ||
      callId.startsWith('fake_') ||
      callId.startsWith('recovery-mock-') ||
      callId.startsWith('test_')
    );
  }

  async answerCall(callId: string): Promise<void> {
    if (!this.telnyxClient || this.isMockCallId(callId)) {
      this.logger.debug(`[MOCK] Answering call ${callId}`);
      return;
    }
    try {
      await this.telnyxClient.calls.actions.answer(callId, {});
    } catch (error: any) {
      this.logger.error(`Failed to answer call ${callId}`, error);
      throw new TelephonyProviderError(
        TelephonyErrorType.ROUTING_FAILED,
        'Failed to answer call',
        error,
      );
    }
  }

  async dialBuyer(
    to: string,
    from: string,
    connectionId: string,
    timeoutSecs: number,
    clientState?: string,
    customHeaders?: Array<{ name: string; value: string }>,
  ): Promise<string> {
    if (!this.telnyxClient) {
      this.logger.debug(`[MOCK] Dialing buyer to ${to} from ${from}`);
      return 'mock_buyer_leg_id_' + Date.now();
    }
    try {
      const dialParams: any = {
        to,
        from,
        connection_id: connectionId,
        timeout_secs: timeoutSecs,
      };
      if (clientState) {
        dialParams.client_state = clientState;
      }
      if (customHeaders && Array.isArray(customHeaders) && customHeaders.length > 0) {
        dialParams.custom_headers = customHeaders;
      }
      const res = await this.telnyxClient.calls.dial(dialParams);
      const callControlId = res?.data?.call_control_id || res?.data?.call_leg_id;
      if (!callControlId) {
        throw new Error('Telnyx dial response missing call_control_id');
      }
      return callControlId;
    } catch (error: any) {
      this.logger.error(`Failed to dial buyer ${to}`, error);
      throw new TelephonyProviderError(
        TelephonyErrorType.ROUTING_FAILED,
        'Failed to dial buyer',
        error,
      );
    }
  }

  async bridgeCalls(callId: string, buyerCallId: string): Promise<void> {
    if (!this.telnyxClient) {
      this.logger.debug(`[MOCK] Bridging calls ${callId} and ${buyerCallId}`);
      return;
    }
    if (this.isMockCallId(callId) || this.isMockCallId(buyerCallId)) {
      this.logger.warn(
        `Mock call ID rejected for live bridging: ${callId} <-> ${buyerCallId}`,
      );
      throw new TelephonyProviderError(
        TelephonyErrorType.ROUTING_FAILED,
        `Cannot bridge mock call ID with live provider: ${callId} <-> ${buyerCallId}`,
      );
    }
    try {
      await this.telnyxClient.calls.actions.bridge(callId, {
        call_control_id_to_bridge_with: buyerCallId,
      });
    } catch (error: any) {
      this.logger.error(
        `Failed to bridge calls ${callId} <-> ${buyerCallId}: ${error.message}`,
        error,
      );
      throw new TelephonyProviderError(
        TelephonyErrorType.ROUTING_FAILED,
        'Failed to bridge calls',
        error,
      );
    }
  }

  async hangupCall(callId: string, reason?: 'BUSY' | 'NORMAL'): Promise<void> {
    if (!this.telnyxClient || this.isMockCallId(callId)) {
      this.logger.debug(`[MOCK] Hanging up call ${callId} (reason: ${reason || 'NORMAL'})`);
      return;
    }
    try {
      const params: any = {};
      if (reason === 'BUSY') {
        params.cause = 'USER_BUSY';
      }
      await this.telnyxClient.calls.actions.hangup(callId, params);
    } catch (error: any) {
      const msg = (error?.message || error?.raw?.message || '').toLowerCase();
      const status = error?.status || error?.statusCode || error?.raw?.status || error?.raw?.statusCode || error?.response?.status;
      if (
        msg.includes('already') ||
        msg.includes('not found') ||
        status === 404
      ) {
        this.logger.debug(
          `Hangup safely completed (call ${callId} already terminal/not found): ${msg}`,
        );
        return;
      }
      this.logger.error(
        `Hangup failed for call ${callId}: ${error.message}`,
        error,
      );
      throw new TelephonyProviderError(
        TelephonyErrorType.ROUTING_FAILED,
        `Failed to hangup call ${callId}: ${error.message}`,
        error,
      );
    }
  }

  async startRingback(callId: string, ringbackUrl?: string): Promise<void> {
    if (!this.telnyxClient || this.isMockCallId(callId)) {
      this.logger.debug(`[MOCK] Starting ringback on call ${callId}`);
      return;
    }
    if (this.activePlaybacks.has(callId)) {
      this.logger.debug(`Ringback playback already active on call ${callId}`);
      return;
    }
    this.activePlaybacks.add(callId);

    const defaultUrl = process.env.BASE_URL
      ? `${process.env.BASE_URL.replace(/\/$/, '')}/telephony/ringback.wav`
      : 'http://localhost:3000/telephony/ringback.wav';
    const audioUrl =
      ringbackUrl ||
      process.env.RINGBACK_AUDIO_URL ||
      defaultUrl;

    if (this.telnyxClient && (audioUrl.includes('localhost') || audioUrl.includes('127.0.0.1'))) {
      this.logger.warn(
        `ringback.invalid_audio_url: audioUrl resolves to localhost (${audioUrl}) in live carrier mode. Remote Telnyx carrier cannot fetch localhost. Configure BASE_URL or RINGBACK_AUDIO_URL with a public HTTPS URL.`,
      );
    }
    try {
      await this.telnyxClient.calls.actions.startPlayback(callId, {
        audio_url: audioUrl,
        loop: 'infinity',
        overlay: false,
        target_legs: 'self',
      });
      this.logger.log(`ringback.started: Playing ringback tone on call ${callId} (${audioUrl})`);
    } catch (error: any) {
      this.activePlaybacks.delete(callId);
      this.logger.warn(`Failed to start ringback on call ${callId}: ${error.message}`);
    }
  }

  async stopRingback(callId: string): Promise<void> {
    this.activePlaybacks.delete(callId);
    if (!this.telnyxClient || this.isMockCallId(callId)) {
      this.logger.debug(`[MOCK] Stopping ringback on call ${callId}`);
      return;
    }
    try {
      await this.telnyxClient.calls.actions.stopPlayback(callId, {
        stop: 'all',
      });
      this.logger.log(`ringback.stopped: Stopped ringback on call ${callId}`);
    } catch (error: any) {
      const isEndedError =
        error?.raw?.errors?.[0]?.code === '90018' ||
        error?.message?.includes('90018') ||
        error?.message?.includes('already ended') ||
        error?.status === 404 ||
        error?.status === 422;
      if (isEndedError) {
        this.logger.debug(`Stop ringback on ended/inactive call ${callId} suppressed`);
        return;
      }
      this.logger.debug(`Stop ringback ignored/failed on call ${callId}: ${error.message}`);
    }
  }

  async startRecording(callId: string): Promise<void> {
    if (!this.telnyxClient || this.isMockCallId(callId)) {
      this.logger.debug(`[MOCK] Starting recording for call ${callId}`);
      return;
    }
    try {
      await this.telnyxClient.calls.actions.startRecording(callId, {
        channels: 'dual',
        format: 'mp3',
      });
    } catch (error: any) {
      this.logger.error(
        `Start recording failed for call ${callId}: ${error.message}`,
        error,
      );
      throw new Error(`Telnyx startRecording failed: ${error.message}`);
    }
  }

  async getRecordingUrl(recordingId: string): Promise<string> {
    if (!this.telnyxClient || this.isMockCallId(recordingId)) {
      return `https://mock.recording.url/${recordingId}.mp3`;
    }
    try {
      const recording = (await this.telnyxClient.recordings.retrieve(
        recordingId,
      )) as any;
      const url = recording.data?.download_urls?.mp3 || recording.data?.download_urls?.wav;
      if (!url) {
        throw new Error('No download URL returned by Telnyx');
      }
      return url;
    } catch (error: any) {
      this.logger.error(
        `Failed to retrieve recording ${recordingId}: ${error.message}`,
      );
      throw new Error(`Telnyx getRecordingUrl failed: ${error.message}`);
    }
  }

  async getCallStatus(callId: string): Promise<'ACTIVE' | 'TERMINAL' | 'NOT_FOUND' | 'UNKNOWN'> {
    if (!this.telnyxClient || this.isMockCallId(callId)) {
      return 'UNKNOWN'; // Mock mode or mock/test IDs default to unknown to avoid real provider lookup
    }
    try {
      // Telnyx `Call Control` API to retrieve call state
      const call = (await this.telnyxClient.calls.retrieveStatus(callId)) as any;
      const status = call?.data?.call_state;
      if (!status) return 'UNKNOWN';

      const activeStates = ['bridged', 'active', 'ringing', 'answering', 'answered', 'initializing', 'dialing'];
      if (activeStates.includes(status)) {
        return 'ACTIVE';
      }
      
      const terminalStates = ['hangup', 'completed', 'done'];
      if (terminalStates.includes(status)) {
        return 'TERMINAL';
      }

      return 'UNKNOWN';
    } catch (error: any) {
      if (error?.raw?.status === 404 || error?.message?.includes('404')) {
        return 'NOT_FOUND';
      }
      this.logger.error(`Failed to get status for call ${callId}: ${error.message}`);
      return 'UNKNOWN';
    }
  }
}
