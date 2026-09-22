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
var TwilioWebhookController_1;
import { Controller, Post, Req, Res, Logger } from '@nestjs/common';
import { CallController } from '../call-controller.js';
import { CallEventType } from '../telephony.events.js';
import { TwilioProvider } from './twilio.provider.js';
import { WebhookIdempotencyService } from '../webhook-idempotency.service.js';
let TwilioWebhookController = TwilioWebhookController_1 = class TwilioWebhookController {
    callController;
    twilioProvider;
    idempotency;
    logger = new Logger(TwilioWebhookController_1.name);
    constructor(callController, twilioProvider, idempotency) {
        this.callController = callController;
        this.twilioProvider = twilioProvider;
        this.idempotency = idempotency;
    }
    async handleWebhook(req, res) {
        const signature = req.headers['x-twilio-signature'];
        const authToken = process.env.TWILIO_AUTH_TOKEN;
        if (authToken && signature) {
            const fullUrl = (process.env.BASE_URL || `https://${req.hostname}`) + req.originalUrl;
            if (!this.twilioProvider.validateWebhook(signature, fullUrl, req.body)) {
                this.logger.warn('Invalid Twilio signature');
                return res.status(400).send('Invalid Twilio signature');
            }
        }
        else if (authToken && !signature) {
            this.logger.warn('Missing Twilio signature');
            return res.status(400).send('Missing Twilio signature');
        }
        else {
            this.logger.debug('TWILIO_AUTH_TOKEN not configured. Bypassing signature verification.');
        }
        const body = req.body || {};
        const seq = body.SequenceNumber || 'voice';
        const callStatus = body.CallStatus || 'unknown';
        const callSid = body.CallSid || 'unknown_sid';
        const eventId = `tw_${callSid}_${callStatus}_${seq}`;
        const { canProcess, id: internalId } = await this.idempotency.acquireLock('twilio', eventId, body);
        if (!canProcess) {
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
        res.type('text/xml');
        if (callStatus === 'ringing' || callStatus === 'queued') {
            const twiml = this.twilioProvider.getInitialTwiML(callSid);
            return res.send(twiml);
        }
        else {
            return res.send('<Response></Response>');
        }
    }
    normalizeTwilioEvent(reqBody) {
        const status = reqBody.CallStatus;
        let type = null;
        if (status === 'ringing' || status === 'queued') {
            type = CallEventType.CALL_INITIATED;
        }
        else if (status === 'in-progress') {
            type = CallEventType.CALL_ANSWERED;
        }
        else if (['completed', 'busy', 'no-answer', 'failed', 'canceled'].includes(status)) {
            type = CallEventType.CALL_HANGUP;
        }
        if (!type) {
            return { type: 'UNKNOWN', timestamp: new Date().toISOString() };
        }
        return {
            type,
            callId: reqBody.CallSid,
            direction: reqBody.Direction === 'inbound' ? 'incoming' : 'outgoing',
            connectionId: reqBody.CallSid,
            from: reqBody.From,
            to: reqBody.To,
            timestamp: new Date().toISOString(),
        };
    }
};
__decorate([
    Post(),
    __param(0, Req()),
    __param(1, Res()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], TwilioWebhookController.prototype, "handleWebhook", null);
TwilioWebhookController = TwilioWebhookController_1 = __decorate([
    Controller('webhooks/twilio'),
    __metadata("design:paramtypes", [CallController,
        TwilioProvider,
        WebhookIdempotencyService])
], TwilioWebhookController);
export { TwilioWebhookController };
//# sourceMappingURL=twilio.webhook.controller.js.map