import {
  Controller,
  Post,
  Req,
  Res,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request, Response } from 'express';
import { CallController } from '../call-controller.js';
import { CallEventType, NormalizedCallEvent } from '../telephony.events.js';
import Telnyx from 'telnyx';
import { WebhookIdempotencyService } from '../webhook-idempotency.service.js';

@Controller('webhooks/telnyx')
export class TelnyxWebhookController {
  private readonly logger = new Logger(TelnyxWebhookController.name);

  constructor(
    private readonly callController: CallController,
    private readonly idempotency: WebhookIdempotencyService,
  ) {}

  @Post()
  async handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Res() res: Response,
  ) {
    const rawBody = req.rawBody;
    const signature = req.headers['telnyx-signature-ed25519'] as string;
    const timestamp = req.headers['telnyx-timestamp'] as string;

    if (!rawBody || !signature || !timestamp) {
      throw new BadRequestException(
        'Missing webhook signature headers or body',
      );
    }

    let telnyxEvent: any;
    try {
      const publicKey = process.env.TELNYX_PUBLIC_KEY;
      if (!publicKey) {
        this.logger.warn(
          'TELNYX_PUBLIC_KEY is not configured. Falling back to mock verification for dev/tests.',
        );
        telnyxEvent = req.body;
      } else {
        // @ts-ignore - handling standard/default import variance
        const telnyxFactory = Telnyx as any;
        const client = new telnyxFactory('dummy');
        const payloadStr = rawBody.toString('utf8');

        telnyxEvent = await client.webhooks.unwrap(
          payloadStr,
          {
            headers: {
              'telnyx-signature-ed25519': signature,
              'telnyx-timestamp': timestamp,
            },
          },
          publicKey,
        );
      }
    } catch (error: any) {
      this.logger.error(`Signature verification failed: ${error.message}`);
      return res.status(400).send(`Webhook Error: ${error.message}`);
    }

    const eventId = telnyxEvent.data?.id || telnyxEvent.id;
    const eventType = telnyxEvent.data?.event_type || telnyxEvent.type;

    if (!eventId) {
      this.logger.warn(`Received event without an ID: ${eventType}`);
      return res.status(200).send('Ignored');
    }

    const { canProcess, id: internalId } = await this.idempotency.acquireLock(
      'telnyx',
      eventId,
      telnyxEvent,
    );

    if (!canProcess) {
      this.logger.debug(`Duplicate/Pending event ignored: ${eventId}`);
      return res.status(200).send('Duplicate');
    }

    this.logger.log(`Processing Telnyx event: ${eventType} (ID: ${eventId})`);

    const normalizedEvent = this.normalizeTelnyxEvent(telnyxEvent);

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

    return res.status(200).send('OK');
  }

  private normalizeTelnyxEvent(
    event: any,
  ): NormalizedCallEvent | { type: 'UNKNOWN' } {
    const eventType = event.data?.event_type || event.type;
    const payload = event.data?.payload || {};

    let type: CallEventType | null = null;
    if (eventType === 'call.initiated') type = CallEventType.CALL_INITIATED;
    else if (eventType === 'call.answered') type = CallEventType.CALL_ANSWERED;
    else if (eventType === 'call.hangup') type = CallEventType.CALL_HANGUP;
    else if (eventType === 'call.recording.saved')
      type = CallEventType.CALL_RECORDING_SAVED;

    if (!type) {
      return { type: 'UNKNOWN' };
    }

    const normalized: NormalizedCallEvent = {
      type,
      callId: payload.call_control_id || payload.call_leg_id,
      direction: payload.direction,
      connectionId: payload.connection_id,
      from: payload.from,
      to: payload.to,
      timestamp:
        event.data?.occurred_at ||
        event.occurred_at ||
        new Date().toISOString(),
    };

    if (type === CallEventType.CALL_RECORDING_SAVED) {
      normalized.recordingId = payload.recording_id;
      normalized.recordingUrl =
        payload.recording_urls?.mp3 || payload.recording_urls?.wav;
    }

    return normalized;
  }
}
