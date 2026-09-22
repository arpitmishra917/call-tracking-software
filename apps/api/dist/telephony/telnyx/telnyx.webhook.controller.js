var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var TelnyxWebhookController_1;
import { Controller, Post, Req, Res, Logger, BadRequestException, } from '@nestjs/common';
import { CallController } from '../call-controller.js';
import { CallEventType } from '../telephony.events.js';
import Telnyx from 'telnyx';
import { WebhookIdempotencyService } from '../webhook-idempotency.service.js';
let TelnyxWebhookController = TelnyxWebhookController_1 = class TelnyxWebhookController {
    callController;
    idempotency;
    logger = new Logger(TelnyxWebhookController_1.name);
    constructor(callController, idempotency) {
        this.callController = callController;
        this.idempotency = idempotency;
    }
    async handleWebhook(req, res) {
        const rawBody = req.rawBody;
        const signature = req.headers['telnyx-signature-ed25519'];
        const timestamp = req.headers['telnyx-timestamp'];
        if (!rawBody || !signature || !timestamp) {
            throw new BadRequestException('Missing webhook signature headers or body');
        }
        let telnyxEvent;
        try {
            const publicKey = process.env.TELNYX_PUBLIC_KEY;
            if (!publicKey) {
                this.logger.warn('TELNYX_PUBLIC_KEY is not configured. Falling back to mock verification for dev/tests.');
                telnyxEvent = req.body;
            }
            else {
                const telnyxFactory = Telnyx;
                const client = new telnyxFactory('dummy');
                const payloadStr = rawBody.toString('utf8');
                telnyxEvent = await client.webhooks.unwrap(payloadStr, {
                    headers: {
                        'telnyx-signature-ed25519': signature,
                        'telnyx-timestamp': timestamp,
                    },
                }, publicKey);
            }
        }
        catch (error) {
            this.logger.error(`Signature verification failed: ${error.message}`);
            return res.status(400).send(`Webhook Error: ${error.message}`);
        }
        const eventId = telnyxEvent.data?.id || telnyxEvent.id;
        const eventType = telnyxEvent.data?.event_type || telnyxEvent.type;
        if (!eventId) {
            this.logger.warn(`Received event without an ID: ${eventType}`);
            return res.status(200).send('Ignored');
        }
        const { canProcess, id: internalId } = await this.idempotency.acquireLock('telnyx', eventId, telnyxEvent);
        if (!canProcess) {
            this.logger.debug(`Duplicate/Pending event ignored: ${eventId}`);
            return res.status(200).send('Duplicate');
        }
        this.logger.log(`Processing Telnyx event: ${eventType} (ID: ${eventId})`);
        const normalizedEvent = this.normalizeTelnyxEvent(telnyxEvent);
        if (normalizedEvent.type !== 'UNKNOWN') {
            try {
                await this.callController.handleEvent(normalizedEvent);
                await this.idempotency.markProcessed(internalId);
            }
            catch (err) {
                this.logger.error(`Error routing event: ${err.message}`, err.stack);
                await this.idempotency.markFailed(internalId, err.message);
            }
        }
        else {
            await this.idempotency.markIgnored(internalId, 'Unknown event type');
        }
        return res.status(200).send('OK');
    }
    normalizeTelnyxEvent(event) {
        const eventType = event.data?.event_type || event.type;
        const payload = event.data?.payload || {};
        let type = null;
        if (eventType === 'call.initiated')
            type = CallEventType.CALL_INITIATED;
        else if (eventType === 'call.answered')
            type = CallEventType.CALL_ANSWERED;
        else if (eventType === 'call.hangup')
            type = CallEventType.CALL_HANGUP;
        else if (eventType === 'call.recording.saved')
            type = CallEventType.CALL_RECORDING_SAVED;
        if (!type) {
            return { type: 'UNKNOWN' };
        }
        const normalized = {
            type,
            callId: payload.call_control_id || payload.call_leg_id,
            direction: payload.direction,
            connectionId: payload.connection_id,
            from: payload.from,
            to: payload.to,
            timestamp: event.data?.occurred_at ||
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
};
__decorate([
    Post(),
    __param(0, Req()),
    __param(1, Res()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], TelnyxWebhookController.prototype, "handleWebhook", null);
TelnyxWebhookController = TelnyxWebhookController_1 = __decorate([
    Controller('webhooks/telnyx'),
    __metadata("design:paramtypes", [CallController,
        WebhookIdempotencyService])
], TelnyxWebhookController);
export { TelnyxWebhookController };
//# sourceMappingURL=telnyx.webhook.controller.js.map