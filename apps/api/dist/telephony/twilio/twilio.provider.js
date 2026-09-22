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
var TwilioProvider_1;
import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { TelephonyProviderError, TelephonyErrorType, } from '../telephony.errors.js';
import { CallController } from '../call-controller.js';
import { CallEventType } from '../telephony.events.js';
import twilio from 'twilio';
let TwilioProvider = TwilioProvider_1 = class TwilioProvider {
    callController;
    logger = new Logger(TwilioProvider_1.name);
    client;
    baseUrl;
    constructor(callController) {
        this.callController = callController;
        const accountSid = process.env.TWILIO_ACCOUNT_SID;
        const authToken = process.env.TWILIO_AUTH_TOKEN;
        this.baseUrl = process.env.BASE_URL || 'https://example.com';
        if (accountSid && authToken) {
            this.client = twilio(accountSid, authToken);
        }
        else {
            this.client = null;
            this.logger.warn('TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN not provided. TwilioProvider is running in mock mode for development/tests.');
        }
    }
    getInitialTwiML(callSid) {
        return `<Response><Dial><Conference waitUrl="" endConferenceOnExit="true">bridge_${callSid}</Conference></Dial></Response>`;
    }
    validateWebhook(signature, url, body) {
        const authToken = process.env.TWILIO_AUTH_TOKEN;
        if (!authToken || !signature)
            return false;
        return twilio.validateRequest(authToken, signature, url, body);
    }
    async answerCall(callId) {
        this.logger.debug(`Synthesizing answered event for Twilio call ${callId}`);
        setImmediate(() => {
            this.callController
                .handleEvent({
                type: CallEventType.CALL_ANSWERED,
                callId: callId,
                direction: 'incoming',
                timestamp: new Date().toISOString(),
            })
                .catch((err) => this.logger.error(`Failed to synthesize answered event for ${callId}: ${err.message}`));
        });
    }
    async dialBuyer(to, from, connectionId, timeoutSecs) {
        if (!this.client) {
            this.logger.debug(`[MOCK] Dialing buyer to ${to} from ${from} into conference bridge_${connectionId}`);
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
        }
        catch (error) {
            this.logger.error(`Failed to dial buyer ${to}`, error);
            throw new TelephonyProviderError(TelephonyErrorType.ROUTING_FAILED, 'Failed to dial buyer', error);
        }
    }
    async bridgeCalls(callId, buyerCallId) {
        this.logger.debug(`Legs ${callId} and ${buyerCallId} are natively bridged via Conference bridge_${callId}`);
    }
    async hangupCall(callId) {
        if (!this.client) {
            this.logger.debug(`[MOCK] Hanging up call ${callId}`);
            return;
        }
        try {
            await this.client.calls(callId).update({ status: 'completed' });
        }
        catch (error) {
            this.logger.warn(`Hangup failed/ignored for call ${callId}: ${error.message}`);
        }
    }
    async startRecording(callId) {
        if (!this.client) {
            this.logger.debug(`[MOCK] Starting recording for call ${callId}`);
            return;
        }
        try {
            await this.client.calls(callId).recordings.create({
                recordingChannels: 'dual',
            });
        }
        catch (error) {
            this.logger.error(`Start recording failed for call ${callId}: ${error.message}`);
            throw new Error(`Twilio startRecording failed: ${error.message}`);
        }
    }
    async getRecordingUrl(recordingId) {
        if (!this.client) {
            return `https://mock.recording.url/${recordingId}.mp3`;
        }
        throw new Error('Twilio getRecordingUrl not fully implemented in MVP1');
    }
};
TwilioProvider = TwilioProvider_1 = __decorate([
    Injectable(),
    __param(0, Inject(forwardRef(() => CallController))),
    __metadata("design:paramtypes", [CallController])
], TwilioProvider);
export { TwilioProvider };
//# sourceMappingURL=twilio.provider.js.map