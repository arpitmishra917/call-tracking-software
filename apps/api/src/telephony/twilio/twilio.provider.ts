import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import type { TelephonyProvider } from '../telephony.provider.js';
import {
  TelephonyProviderError,
  TelephonyErrorType,
} from '../telephony.errors.js';
import { CallController } from '../call-controller.js';
import { CallEventType } from '../telephony.events.js';
import twilio from 'twilio';

@Injectable()
export class TwilioProvider implements TelephonyProvider {
  private readonly logger = new Logger(TwilioProvider.name);
  private readonly client: twilio.Twilio | null;
  private readonly baseUrl: string;

  constructor(
    @Inject(forwardRef(() => CallController))
    private readonly callController: CallController,
  ) {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    this.baseUrl = process.env.BASE_URL || 'https://example.com';

    if (accountSid && authToken) {
      this.client = twilio(accountSid, authToken);
    } else {
      this.client = null;
      this.logger.warn(
        'TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN not provided. TwilioProvider is running in mock mode for development/tests.',
      );
    }
  }

  getInitialTwiML(callSid: string): string {
    // Place the inbound caller into a conference immediately.
    // We disable waitUrl so they hear silence instead of hold music while waiting for a buyer.
    // endConferenceOnExit ensures if the caller drops, the room is destroyed.
    return `<Response><Dial><Conference waitUrl="" endConferenceOnExit="true">bridge_${callSid}</Conference></Dial></Response>`;
  }

  validateWebhook(signature: string, url: string, body: any): boolean {
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    if (!authToken || !signature) return false;
    return twilio.validateRequest(authToken, signature, url, body);
  }

  async answerCall(callId: string): Promise<void> {
    // In our new architecture, the inbound call is answered implicitly by returning TwiML in the webhook.
    // The generic routing engine still requires an asynchronous CALL_ANSWERED event to proceed to dialing.
    this.logger.debug(`Synthesizing answered event for Twilio call ${callId}`);

    setImmediate(() => {
      this.callController
        .handleEvent({
          type: CallEventType.CALL_ANSWERED,
          callId: callId,
          direction: 'incoming',
          timestamp: new Date().toISOString(),
        })
        .catch((err: any) =>
          this.logger.error(
            `Failed to synthesize answered event for ${callId}: ${err.message}`,
          ),
        );
    });
  }

  async dialBuyer(
    to: string,
    from: string,
    connectionId: string,
    timeoutSecs: number,
  ): Promise<string> {
    if (!this.client) {
      this.logger.debug(
        `[MOCK] Dialing buyer to ${to} from ${from} into conference bridge_${connectionId}`,
      );
      return 'mock_twilio_buyer_leg_id_' + Date.now();
    }

    try {
      const confName = `bridge_${connectionId}`;
      const twiml = `<Response><Dial><Conference waitUrl="" endConferenceOnExit="false">${confName}</Conference></Dial></Response>`;

      const res = await this.client.calls.create({
        to,
        from,
        twiml,
        statusCallback: `${this.baseUrl}/webhooks/twilio`,
        statusCallbackEvent: ['answered', 'completed'],
        timeout: timeoutSecs,
      });
      return res.sid;
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
    // In the Native Conference architecture, the inbound call and the buyer call
    // were both created with TwiML that places them into `bridge_${callId}`.
    // Therefore, they are physically bridged the exact millisecond the buyer answers.
    // No REST API updates are needed!
    this.logger.debug(
      `Legs ${callId} and ${buyerCallId} are natively bridged via Conference bridge_${callId}`,
    );
  }

  async hangupCall(callId: string): Promise<void> {
    if (!this.client) {
      this.logger.debug(`[MOCK] Hanging up call ${callId}`);
      return;
    }

    try {
      await this.client.calls(callId).update({ status: 'completed' });
    } catch (error: any) {
      // Ignored for hangup to match POC fallback behavior safely
      this.logger.warn(
        `Hangup failed/ignored for call ${callId}: ${error.message}`,
      );
    }
  }

  async startRecording(callId: string): Promise<void> {
    if (!this.client) {
      this.logger.debug(`[MOCK] Starting recording for call ${callId}`);
      return;
    }
    try {
      await this.client.calls(callId).recordings.create({
        recordingChannels: 'dual',
      });
    } catch (error: any) {
      this.logger.error(
        `Start recording failed for call ${callId}: ${error.message}`,
      );
      throw new Error(`Twilio startRecording failed: ${error.message}`);
    }
  }

  async getRecordingUrl(recordingId: string): Promise<string> {
    if (!this.client) {
      return `https://mock.recording.url/${recordingId}.mp3`;
    }
    // Twilio recordings require basic auth for raw media if configured, but URL is predictable
    // Or we can just throw not implemented for now since this MVP is Telnyx
    throw new Error('Twilio getRecordingUrl not fully implemented in MVP1');
  }
}
