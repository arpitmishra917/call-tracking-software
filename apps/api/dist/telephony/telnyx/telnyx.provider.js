var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var TelnyxProvider_1;
import { Injectable, Logger } from '@nestjs/common';
import { TelephonyProviderError, TelephonyErrorType, } from '../telephony.errors.js';
import Telnyx from 'telnyx';
let TelnyxProvider = TelnyxProvider_1 = class TelnyxProvider {
    logger = new Logger(TelnyxProvider_1.name);
    telnyxClient;
    constructor() {
        const apiKey = process.env.TELNYX_API_KEY;
        if (apiKey) {
            const telnyxFactory = Telnyx;
            this.telnyxClient = new telnyxFactory(apiKey);
        }
        else {
            this.logger.warn('TELNYX_API_KEY not provided. TelnyxProvider is running in mock mode for development/tests.');
        }
    }
    async answerCall(callId) {
        if (!this.telnyxClient) {
            this.logger.debug(`[MOCK] Answering call ${callId}`);
            return;
        }
        try {
            await this.telnyxClient.calls.actions.answer(callId);
        }
        catch (error) {
            this.logger.error(`Failed to answer call ${callId}`, error);
            throw new TelephonyProviderError(TelephonyErrorType.ROUTING_FAILED, 'Failed to answer call', error);
        }
    }
    async dialBuyer(to, from, connectionId, timeoutSecs) {
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
        }
        catch (error) {
            this.logger.error(`Failed to dial buyer ${to}`, error);
            throw new TelephonyProviderError(TelephonyErrorType.ROUTING_FAILED, 'Failed to dial buyer', error);
        }
    }
    async bridgeCalls(callId, buyerCallId) {
        if (!this.telnyxClient) {
            this.logger.debug(`[MOCK] Bridging calls ${callId} and ${buyerCallId}`);
            return;
        }
        try {
            await this.telnyxClient.calls.actions.bridge(callId, {
                call_control_id: buyerCallId,
            });
        }
        catch (error) {
            this.logger.error(`Failed to bridge calls ${callId} <-> ${buyerCallId}`, error);
            throw new TelephonyProviderError(TelephonyErrorType.ROUTING_FAILED, 'Failed to bridge calls', error);
        }
    }
    async hangupCall(callId) {
        if (!this.telnyxClient) {
            this.logger.debug(`[MOCK] Hanging up call ${callId}`);
            return;
        }
        try {
            await this.telnyxClient.calls.actions.hangup(callId);
        }
        catch (error) {
            this.logger.warn(`Hangup failed/ignored for call ${callId}: ${error.message}`);
        }
    }
    async startRecording(callId) {
        if (!this.telnyxClient) {
            this.logger.debug(`[MOCK] Starting recording for call ${callId}`);
            return;
        }
        try {
            await this.telnyxClient.calls.actions.startRecording(callId, {
                channels: 'dual',
                format: 'mp3',
            });
        }
        catch (error) {
            this.logger.error(`Start recording failed for call ${callId}: ${error.message}`);
            throw new Error(`Telnyx startRecording failed: ${error.message}`);
        }
    }
    async getRecordingUrl(recordingId) {
        if (!this.telnyxClient) {
            return `https://mock.recording.url/${recordingId}.mp3`;
        }
        try {
            const recording = (await this.telnyxClient.recordings.retrieve(recordingId));
            const url = recording.data?.download_urls?.mp3;
            if (!url) {
                throw new Error('No download URL returned by Telnyx');
            }
            return url;
        }
        catch (error) {
            this.logger.error(`Failed to retrieve recording ${recordingId}: ${error.message}`);
            throw new Error(`Telnyx getRecordingUrl failed: ${error.message}`);
        }
    }
};
TelnyxProvider = TelnyxProvider_1 = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [])
], TelnyxProvider);
export { TelnyxProvider };
//# sourceMappingURL=telnyx.provider.js.map