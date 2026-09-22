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

  constructor() {
    const apiKey = process.env.TELNYX_API_KEY;
    if (apiKey) {
      const telnyxFactory = Telnyx as any;
      this.telnyxClient = new telnyxFactory(apiKey);
    } else {
      this.logger.warn(
        'TELNYX_API_KEY not provided. TelnyxProvider is running in mock mode for development/tests.',
      );
    }
  }

  async answerCall(callId: string): Promise<void> {
    if (!this.telnyxClient) {
      this.logger.debug(`[MOCK] Answering call ${callId}`);
      return;
    }
    try {
      await this.telnyxClient.calls.actions.answer(callId);
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
  ): Promise<string> {
    if (!this.telnyxClient) {
      this.logger.debug(`[MOCK] Dialing buyer to ${to} from ${from}`);
      return 'mock_buyer_leg_id_' + Date.now();
    }
    try {
      const res = await this.telnyxClient.calls.dial({
        to,
        from,
        connection_id: connectionId,
        timeout_secs: timeoutSecs,
      });
      return res.data.call_control_id;
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
    try {
      await this.telnyxClient.calls.actions.bridge(callId, {
        call_control_id: buyerCallId,
      });
    } catch (error: any) {
      this.logger.error(
        `Failed to bridge calls ${callId} <-> ${buyerCallId}`,
        error,
      );
      throw new TelephonyProviderError(
        TelephonyErrorType.ROUTING_FAILED,
        'Failed to bridge calls',
        error,
      );
    }
  }

  async hangupCall(callId: string): Promise<void> {
    if (!this.telnyxClient) {
      this.logger.debug(`[MOCK] Hanging up call ${callId}`);
      return;
    }
    try {
      await this.telnyxClient.calls.actions.hangup(callId);
    } catch (error: any) {
      // Ignored for hangup to match POC fallback behavior safely
      this.logger.warn(
        `Hangup failed/ignored for call ${callId}: ${error.message}`,
      );
    }
  }

  async startRecording(callId: string): Promise<void> {
    if (!this.telnyxClient) {
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
      );
      throw new Error(`Telnyx startRecording failed: ${error.message}`);
    }
  }

  async getRecordingUrl(recordingId: string): Promise<string> {
    if (!this.telnyxClient) {
      return `https://mock.recording.url/${recordingId}.mp3`;
    }
    try {
      const recording = (await this.telnyxClient.recordings.retrieve(
        recordingId,
      )) as any;
      const url = recording.data?.download_urls?.mp3;
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
}
