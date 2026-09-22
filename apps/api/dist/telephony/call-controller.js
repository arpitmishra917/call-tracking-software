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
var CallController_1;
import { Injectable, Inject, forwardRef, Logger } from '@nestjs/common';
import { CallEventType } from './telephony.events.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CallsService } from '../calls/calls.service.js';
import { UsageService } from '../usage/usage.service.js';
import { WebhooksService } from '../webhooks/webhooks.service.js';
import { CallState, CallAttemptState } from '@prisma/client';
export const TELEPHONY_PROVIDER = 'TELEPHONY_PROVIDER';
let CallController = CallController_1 = class CallController {
    provider;
    prisma;
    callsService;
    usageService;
    webhooksService;
    logger = new Logger(CallController_1.name);
    constructor(provider, prisma, callsService, usageService, webhooksService) {
        this.provider = provider;
        this.prisma = prisma;
        this.callsService = callsService;
        this.usageService = usageService;
        this.webhooksService = webhooksService;
    }
    async handleEvent(event) {
        const { type, callId, direction, connectionId, from, to } = event;
        if (!callId)
            return;
        let call = await this.prisma.call.findUnique({
            where: { provider_call_id: callId },
            include: {
                attempts: { include: { buyer: true }, orderBy: { created_at: 'asc' } },
            },
        });
        let attempt = null;
        if (!call) {
            attempt = await this.prisma.callAttempt.findUnique({
                where: { provider_call_id: callId },
                include: {
                    call: {
                        include: {
                            attempts: {
                                include: { buyer: true },
                                orderBy: { created_at: 'asc' },
                            },
                        },
                    },
                    buyer: true,
                },
            });
            if (attempt) {
                call = attempt.call;
            }
        }
        if (type === CallEventType.CALL_INITIATED && direction === 'incoming') {
            if (call)
                return;
            const trackingNumber = await this.prisma.phoneNumber.findFirst({
                where: { phone_number: to },
            });
            if (!trackingNumber) {
                this.logger.warn(`Unknown tracking number: ${to}`);
                return;
            }
            const isBlocked = await this.prisma.blockedCaller.findUnique({
                where: {
                    workspace_id_phone_number: {
                        workspace_id: trackingNumber.workspace_id,
                        phone_number: from,
                    },
                },
            });
            if (isBlocked) {
                this.logger.log(`Call from blocked number ${from}. Hanging up.`);
                await this.prisma.call.create({
                    data: {
                        workspace_id: trackingNumber.workspace_id,
                        campaign_id: trackingNumber.campaign_id,
                        provider: 'provider',
                        provider_call_id: callId,
                        from_number: from,
                        to_number: to,
                        state: CallState.FAILED,
                    },
                });
                await this.provider.hangupCall(callId);
                return;
            }
            call = await this.callsService.createCall({
                workspace_id: trackingNumber.workspace_id,
                campaign_id: trackingNumber.campaign_id || undefined,
                provider: 'provider',
                provider_call_id: callId,
                from_number: from,
                to_number: to,
            });
            await this.provider.answerCall(callId);
            return;
        }
        if (!call) {
            this.logger.warn(`Received event ${type} for unknown call ${callId}`);
            return;
        }
        if (type === CallEventType.CALL_ANSWERED &&
            call.provider_call_id === callId) {
            if (call.state === CallState.INITIATED) {
                call = await this.callsService.transitionCall(call.id, CallState.ROUTING);
                try {
                    await this.provider.startRecording(call.provider_call_id);
                }
                catch (err) {
                    this.logger.error(`Failed to start recording for call ${callId}`, err);
                }
                await this.dialNextBuyer(call, connectionId);
            }
            return;
        }
        if (type === CallEventType.CALL_ANSWERED &&
            attempt &&
            attempt.provider_call_id === callId) {
            if (attempt.state === CallAttemptState.ANSWERED ||
                attempt.state === CallAttemptState.COMPLETED) {
                return;
            }
            if (call.state !== CallState.ROUTING) {
                await this.provider.hangupCall(callId);
                return;
            }
            try {
                await this.callsService.transitionAttempt(attempt.id, CallAttemptState.ANSWERED);
            }
            catch (err) {
                this.logger.warn(`Failed to transition attempt. Hanging up. ${err}`);
                await this.provider.hangupCall(callId);
                return;
            }
            await this.provider.bridgeCalls(call.provider_call_id, attempt.provider_call_id);
            await this.callsService.transitionCall(call.id, CallState.COMPLETED);
            return;
        }
        if (type === CallEventType.CALL_RECORDING_SAVED) {
            const { recordingId, recordingUrl } = event;
            if (recordingId) {
                try {
                    const rec = await this.prisma.recording.create({
                        data: {
                            workspace_id: call.workspace_id,
                            call_id: call.id,
                            provider_id: recordingId,
                            recording_url: recordingUrl,
                            status: 'COMPLETED',
                        },
                    });
                    this.logger.log(`Saved recording metadata for call ${call.id}`);
                    await this.usageService.recordUsage(call.workspace_id, 'RECORDING_STORAGE', 1, rec.id, `REC_${rec.id}`);
                    this.webhooksService
                        .queueEvent(call.workspace_id, 'recording.available', rec)
                        .catch(console.error);
                }
                catch (err) {
                    this.logger.error(`Failed to save recording metadata: ${err}`);
                }
            }
            return;
        }
        if (type === CallEventType.CALL_HANGUP) {
            if (call.provider_call_id === callId) {
                await this.callsService.handleCallerHangup(callId);
                const activeAttempts = call.attempts?.filter((a) => a.state === CallAttemptState.INITIATED ||
                    a.state === CallAttemptState.RINGING ||
                    a.state === CallAttemptState.ANSWERED) || [];
                for (const act of activeAttempts) {
                    if (act.provider_call_id) {
                        await this.provider.hangupCall(act.provider_call_id);
                    }
                }
            }
            else if (attempt && attempt.provider_call_id === callId) {
                if (call.state === CallState.COMPLETED &&
                    attempt.state === CallAttemptState.ANSWERED) {
                    await this.callsService.transitionAttempt(attempt.id, CallAttemptState.COMPLETED);
                    await this.provider.hangupCall(call.provider_call_id);
                    return;
                }
                if (attempt.state === CallAttemptState.COMPLETED ||
                    attempt.state === CallAttemptState.FAILED ||
                    attempt.state === CallAttemptState.CANCELED ||
                    attempt.state === CallAttemptState.NO_ANSWER) {
                    return;
                }
                if (call.state === CallState.COMPLETED) {
                    await this.callsService.transitionAttempt(attempt.id, CallAttemptState.COMPLETED);
                    await this.provider.hangupCall(call.provider_call_id);
                    return;
                }
                try {
                    await this.callsService.transitionAttempt(attempt.id, CallAttemptState.NO_ANSWER);
                }
                catch (err) {
                    this.logger.warn(`Could not transition attempt to NO_ANSWER. ${err}`);
                    return;
                }
                const updatedCall = await this.prisma.call.findUnique({
                    where: { id: call.id },
                    include: {
                        attempts: {
                            include: { buyer: true },
                            orderBy: { created_at: 'asc' },
                        },
                    },
                });
                if (updatedCall && updatedCall.state === CallState.ROUTING) {
                    await this.dialNextBuyer(updatedCall, connectionId);
                }
            }
        }
    }
    async dialNextBuyer(call, connectionId) {
        if (!call.campaign_id) {
            await this.callsService.transitionCall(call.id, CallState.FAILED);
            await this.provider.hangupCall(call.provider_call_id);
            return;
        }
        const campaign = await this.prisma.campaign.findUnique({
            where: { id: call.campaign_id },
            include: {
                buyers: {
                    where: { status: 'ACTIVE', buyer: { status: 'ACTIVE' } },
                    orderBy: { priority: 'asc' },
                    include: { buyer: true },
                },
            },
        });
        if (!campaign ||
            campaign.status !== 'ACTIVE' ||
            campaign.buyers.length === 0) {
            await this.callsService.transitionCall(call.id, CallState.FAILED);
            await this.provider.hangupCall(call.provider_call_id);
            return;
        }
        const attempts = call.attempts || [];
        const attemptedBuyerIds = new Set(attempts.map((a) => a.buyer_id));
        const nextCampaignBuyer = campaign.buyers.find((cb) => !attemptedBuyerIds.has(cb.buyer_id));
        if (!nextCampaignBuyer) {
            await this.callsService.transitionCall(call.id, CallState.NO_ANSWER);
            await this.provider.hangupCall(call.provider_call_id);
            return;
        }
        const attempt = await this.callsService.createCallAttempt({
            call_id: call.id,
            buyer_id: nextCampaignBuyer.buyer_id,
        });
        try {
            const buyerCallId = await this.provider.dialBuyer(nextCampaignBuyer.buyer.destination_number, call.to_number, connectionId || '', nextCampaignBuyer.buyer.timeout);
            await this.prisma.callAttempt.update({
                where: { id: attempt.id },
                data: { provider_call_id: buyerCallId },
            });
            await this.callsService.transitionAttempt(attempt.id, CallAttemptState.RINGING);
        }
        catch (err) {
            this.logger.error(`Failed to dial buyer ${nextCampaignBuyer.buyer_id}`, err);
            await this.callsService.transitionAttempt(attempt.id, CallAttemptState.FAILED);
            const updatedCall = await this.prisma.call.findUnique({
                where: { id: call.id },
                include: {
                    attempts: {
                        include: { buyer: true },
                        orderBy: { created_at: 'asc' },
                    },
                },
            });
            if (updatedCall && updatedCall.state === CallState.ROUTING) {
                await this.dialNextBuyer(updatedCall, connectionId);
            }
        }
    }
    getCallState(_id) {
        return null;
    }
};
CallController = CallController_1 = __decorate([
    Injectable(),
    __param(0, Inject(forwardRef(() => TELEPHONY_PROVIDER))),
    __metadata("design:paramtypes", [Object, PrismaService,
        CallsService,
        UsageService,
        WebhooksService])
], CallController);
export { CallController };
//# sourceMappingURL=call-controller.js.map