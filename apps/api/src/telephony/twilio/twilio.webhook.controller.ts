import { Controller, Post, Req, Res, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { CallController } from '../call-controller.js';
import { CallEventType, NormalizedCallEvent } from '../telephony.events.js';
import { TwilioProvider } from './twilio.provider.js';
import { WebhookIdempotencyService } from '../webhook-idempotency.service.js';

@Controller('webhooks/twilio')
export class TwilioWebhookController {
  private readonly logger = new Logger(TwilioWebhookController.name);

  constructor(
    private readonly callController: CallController,
    private readonly twilioProvider: TwilioProvider,
    private readonly idempotency: WebhookIdempotencyService,
  ) {}

  @Post()
  async handleWebhook(@Req() req: Request, @Res() res: Response) {
    const signature = req.headers['x-twilio-signature'] as string;

    // Auth token check
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    if (authToken && signature) {
      const fullUrl =
        (process.env.BASE_URL || `https://${req.hostname}`) + req.originalUrl;
      if (!this.twilioProvider.validateWebhook(signature, fullUrl, req.body)) {
        this.logger.warn('Invalid Twilio signature');
        return res.status(400).send('Invalid Twilio signature');
      }
    } else if (authToken && !signature) {
      this.logger.warn('Missing Twilio signature');
      return res.status(400).send('Missing Twilio signature');
    } else {
      this.logger.debug(
        'TWILIO_AUTH_TOKEN not configured. Bypassing signature verification.',
      );
    }

    const body = req.body || {};

    const seq = body.SequenceNumber || 'voice';
    const callStatus = body.CallStatus || 'unknown';
    const callSid = body.CallSid || 'unknown_sid';
    const eventId = `tw_${callSid}_${callStatus}_${seq}`;

    const { canProcess, id: internalId } = await this.idempotency.acquireLock(
      'twilio',
      eventId,
      body,
    );

    if (!canProcess) {
      // Duplicate / Already Processed / Pending
      res.type('text/xml');
      if (callStatus === 'ringing' || callStatus === 'queued') {
        return res.send(this.twilioProvider.getInitialTwiML(callSid));
      }
      return res.send('<Response></Response>');
    }

    this.logger.log(`Processing Twilio event: ${callStatus} (ID: ${eventId})`);

    const normalizedEvent = this.normalizeTwilioEvent(body);
    normalizedEvent.timestamp = new Date().toISOString();

    if (normalizedEvent.type !== 'UNKNOWN') {
      try {
        await this.callController.handleEvent(normalizedEvent);
        await this.idempotency.markProcessed(internalId!);
      } catch (err: any) {
        this.logger.error(`Error routing event: ${err.message}`, err.stack);
        await this.idempotency.markFailed(internalId!, err.message);
      }
    } else {
      await this.idempotency.markIgnored(internalId!, 'Unknown event type');
    }

    res.type('text/xml');
    if (callStatus === 'ringing' || callStatus === 'queued') {
      const twiml = this.twilioProvider.getInitialTwiML(callSid);
      return res.send(twiml);
    } else {
      return res.send('<Response></Response>');
    }
  }

  private normalizeTwilioEvent(
    reqBody: any,
  ): NormalizedCallEvent | { type: 'UNKNOWN'; timestamp: string } {
    const status = reqBody.CallStatus; // 'ringing', 'in-progress', 'completed', 'busy', 'no-answer', 'failed', 'canceled'

    let type: CallEventType | null = null;
    if (status === 'ringing' || status === 'queued') {
      type = CallEventType.CALL_INITIATED;
    } else if (status === 'in-progress') {
      type = CallEventType.CALL_ANSWERED;
    } else if (
      ['completed', 'busy', 'no-answer', 'failed', 'canceled'].includes(status)
    ) {
      type = CallEventType.CALL_HANGUP;
    }

    if (!type) {
      return { type: 'UNKNOWN', timestamp: new Date().toISOString() };
    }

    return {
      type,
      callId: reqBody.CallSid,
      direction: reqBody.Direction === 'inbound' ? 'incoming' : 'outgoing',
      connectionId: reqBody.CallSid, // Twilio doesn't have a distinct connection_id in the same way Telnyx does, CallSid serves as the bridge key
      from: reqBody.From,
      to: reqBody.To,
      timestamp: new Date().toISOString(),
    };
  }
}
