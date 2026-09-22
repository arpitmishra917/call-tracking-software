var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { Injectable, BadRequestException, NotFoundException, } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { UsageService } from '../usage/usage.service.js';
import { CallState, CallAttemptState, UsageType, } from '@prisma/client';
export const VALID_CALL_TRANSITIONS = {
    [CallState.INITIATED]: [
        CallState.ROUTING,
        CallState.CANCELED,
        CallState.FAILED,
    ],
    [CallState.ROUTING]: [
        CallState.COMPLETED,
        CallState.NO_ANSWER,
        CallState.FAILED,
        CallState.CANCELED,
    ],
    [CallState.COMPLETED]: [],
    [CallState.NO_ANSWER]: [],
    [CallState.FAILED]: [],
    [CallState.CANCELED]: [],
};
export const VALID_ATTEMPT_TRANSITIONS = {
    [CallAttemptState.INITIATED]: [
        CallAttemptState.RINGING,
        CallAttemptState.CANCELED,
        CallAttemptState.FAILED,
    ],
    [CallAttemptState.RINGING]: [
        CallAttemptState.ANSWERED,
        CallAttemptState.NO_ANSWER,
        CallAttemptState.FAILED,
        CallAttemptState.CANCELED,
    ],
    [CallAttemptState.ANSWERED]: [
        CallAttemptState.COMPLETED,
        CallAttemptState.FAILED,
    ],
    [CallAttemptState.COMPLETED]: [],
    [CallAttemptState.NO_ANSWER]: [],
    [CallAttemptState.FAILED]: [],
    [CallAttemptState.CANCELED]: [],
};
import { WebhooksService } from '../webhooks/webhooks.service.js';
let CallsService = class CallsService {
    prisma;
    usageService;
    webhooksService;
    constructor(prisma, usageService, webhooksService) {
        this.prisma = prisma;
        this.usageService = usageService;
        this.webhooksService = webhooksService;
    }
    async createCall(data) {
        const call = await this.prisma.call.create({
            data: {
                ...data,
                state: CallState.INITIATED,
            },
        });
        this.webhooksService
            .queueEvent(data.workspace_id, 'call.started', call)
            .catch(console.error);
        return call;
    }
    async transitionCall(callId, newState, durationSecs) {
        return this.prisma.$transaction(async (tx) => {
            const call = await tx.call.findUnique({ where: { id: callId } });
            if (!call)
                throw new NotFoundException(`Call ${callId} not found`);
            if (!this.isValidTransition(call.state, newState)) {
                throw new BadRequestException(`Invalid transition from ${call.state} to ${newState}`);
            }
            const updateData = { state: newState };
            if (durationSecs !== undefined) {
                updateData.duration_secs = durationSecs;
            }
            const updatedCall = await tx.call.update({
                where: { id: callId },
                data: updateData,
            });
            if (newState !== call.state) {
                if (newState === CallState.FAILED) {
                    this.webhooksService
                        .queueEvent(updatedCall.workspace_id, 'call.blocked', updatedCall)
                        .catch(console.error);
                }
                else if (newState === CallState.COMPLETED) {
                    this.webhooksService
                        .queueEvent(updatedCall.workspace_id, 'call.answered', updatedCall)
                        .catch(console.error);
                }
                else if (this.isTerminalCallState(newState)) {
                    this.webhooksService
                        .queueEvent(updatedCall.workspace_id, 'call.ended', updatedCall)
                        .catch(console.error);
                }
            }
            return updatedCall;
        });
    }
    async handleCallerHangup(providerCallId, durationSecs) {
        return this.prisma.$transaction(async (tx) => {
            const call = await tx.call.findUnique({
                where: { provider_call_id: providerCallId },
                include: { attempts: true },
            });
            if (!call)
                throw new NotFoundException(`Call ${providerCallId} not found`);
            let finalState = call.state;
            if (call.state === CallState.INITIATED ||
                call.state === CallState.ROUTING) {
                finalState = CallState.CANCELED;
            }
            else if (call.state === CallState.COMPLETED) {
                finalState = CallState.COMPLETED;
            }
            for (const attempt of call.attempts) {
                if (attempt.state === CallAttemptState.INITIATED ||
                    attempt.state === CallAttemptState.RINGING) {
                    await tx.callAttempt.update({
                        where: { id: attempt.id },
                        data: { state: CallAttemptState.CANCELED },
                    });
                }
            }
            const updateData = { state: finalState };
            const computedDuration = durationSecs !== undefined
                ? durationSecs
                : Math.floor((Date.now() - (call.created_at?.getTime?.() ?? Date.now())) /
                    1000);
            if (this.isTerminalCallState(finalState) && call.duration_secs === null) {
                updateData.duration_secs = computedDuration;
            }
            else if (durationSecs !== undefined) {
                updateData.duration_secs = durationSecs;
            }
            let updatedCall = call;
            if (call.state !== finalState || updateData.duration_secs !== undefined) {
                updatedCall = await tx.call.update({
                    where: { id: call.id },
                    data: updateData,
                });
            }
            if (updatedCall.duration_secs !== null && updatedCall.duration_secs > 0) {
                const minutes = Math.ceil(updatedCall.duration_secs / 60);
                await this.usageService.recordUsage(updatedCall.workspace_id, UsageType.CALL_MINUTE, minutes, updatedCall.id, `CALL_MINUTE_${updatedCall.id}`);
            }
            if (call.state !== finalState) {
                if (finalState === CallState.FAILED) {
                    this.webhooksService
                        .queueEvent(updatedCall.workspace_id, 'call.blocked', updatedCall)
                        .catch(console.error);
                }
                else if (finalState === CallState.COMPLETED) {
                    this.webhooksService
                        .queueEvent(updatedCall.workspace_id, 'call.answered', updatedCall)
                        .catch(console.error);
                }
                else if (this.isTerminalCallState(finalState)) {
                    this.webhooksService
                        .queueEvent(updatedCall.workspace_id, 'call.ended', updatedCall)
                        .catch(console.error);
                }
            }
            return updatedCall;
        });
    }
    async createCallAttempt(data) {
        return this.prisma.$transaction(async (tx) => {
            const call = await tx.call.findUnique({ where: { id: data.call_id } });
            if (!call)
                throw new NotFoundException(`Call ${data.call_id} not found`);
            if (this.isTerminalCallState(call.state)) {
                throw new BadRequestException(`Cannot create attempt for call in terminal state: ${call.state}`);
            }
            const attempt = await tx.callAttempt.create({
                data: {
                    ...data,
                    state: CallAttemptState.INITIATED,
                },
            });
            this.webhooksService
                .queueEvent(call.workspace_id, 'call.attempt.started', attempt)
                .catch(console.error);
            return attempt;
        });
    }
    async transitionAttempt(attemptId, newState, durationSecs) {
        return this.prisma.$transaction(async (tx) => {
            const attempt = await tx.callAttempt.findUnique({
                where: { id: attemptId },
            });
            if (!attempt)
                throw new NotFoundException(`CallAttempt ${attemptId} not found`);
            if (!this.isValidAttemptTransition(attempt.state, newState)) {
                throw new BadRequestException(`Invalid attempt transition from ${attempt.state} to ${newState}`);
            }
            const updateData = { state: newState };
            if (durationSecs !== undefined) {
                updateData.duration_secs = durationSecs;
            }
            const updatedAttempt = await tx.callAttempt.update({
                where: { id: attemptId },
                data: updateData,
            });
            if (newState !== attempt.state) {
                if (VALID_ATTEMPT_TRANSITIONS[newState].length === 0) {
                    const call = await tx.call.findUnique({
                        where: { id: attempt.call_id },
                    });
                    if (call) {
                        this.webhooksService
                            .queueEvent(call.workspace_id, 'call.attempt.ended', updatedAttempt)
                            .catch(console.error);
                    }
                }
            }
            return updatedAttempt;
        });
    }
    isValidTransition(from, to) {
        if (from === to)
            return true;
        return VALID_CALL_TRANSITIONS[from].includes(to);
    }
    isValidAttemptTransition(from, to) {
        if (from === to)
            return true;
        return VALID_ATTEMPT_TRANSITIONS[from].includes(to);
    }
    isTerminalCallState(state) {
        return VALID_CALL_TRANSITIONS[state].length === 0;
    }
    async getCalls(workspaceId, filters) {
        const where = { workspace_id: workspaceId };
        if (filters.campaignId) {
            where.campaign_id = filters.campaignId;
        }
        if (filters.buyerId) {
            where.attempts = {
                some: { buyer_id: filters.buyerId },
            };
        }
        if (filters.status) {
            where.state = filters.status;
        }
        if (filters.callerNumber) {
            where.from_number = { contains: filters.callerNumber };
        }
        if (filters.startDate || filters.endDate) {
            where.created_at = {};
            if (filters.startDate)
                where.created_at.gte = new Date(filters.startDate);
            if (filters.endDate)
                where.created_at.lte = new Date(filters.endDate);
        }
        const [items, total] = await Promise.all([
            this.prisma.call.findMany({
                where,
                include: {
                    campaign: { select: { name: true } },
                    attempts: {
                        include: { buyer: { select: { name: true } } },
                        orderBy: { created_at: 'asc' },
                    },
                },
                orderBy: { created_at: 'desc' },
                skip: filters.offset || 0,
                take: filters.limit || 50,
            }),
            this.prisma.call.count({ where }),
        ]);
        return { items, total };
    }
    async getCallDetail(workspaceId, callId) {
        const call = await this.prisma.call.findUnique({
            where: { id: callId, workspace_id: workspaceId },
            include: {
                campaign: { select: { name: true } },
                attempts: {
                    include: { buyer: { select: { name: true } } },
                    orderBy: { created_at: 'asc' },
                },
                recordings: true,
            },
        });
        if (!call)
            throw new NotFoundException(`Call ${callId} not found`);
        return call;
    }
    async getMetrics(workspaceId, filters) {
        const where = { workspace_id: workspaceId };
        if (filters.startDate || filters.endDate) {
            where.created_at = {};
            if (filters.startDate)
                where.created_at.gte = new Date(filters.startDate);
            if (filters.endDate)
                where.created_at.lte = new Date(filters.endDate);
        }
        const calls = await this.prisma.call.findMany({
            where,
            select: {
                state: true,
                duration_secs: true,
                campaign_id: true,
            },
        });
        const attempts = await this.prisma.callAttempt.findMany({
            where: {
                call: { workspace_id: workspaceId, ...where },
            },
            select: {
                state: true,
                buyer_id: true,
            },
        });
        const metrics = {
            total: calls.length,
            answered: calls.filter((c) => c.state === CallState.COMPLETED).length,
            missed: calls.filter((c) => c.state === CallState.NO_ANSWER ||
                c.state === CallState.FAILED ||
                c.state === CallState.CANCELED).length,
            blocked: calls.filter((c) => c.state === CallState.FAILED).length,
            avgDuration: 0,
            campaigns: {},
            buyers: {},
        };
        let totalDuration = 0;
        let durationCount = 0;
        calls.forEach((c) => {
            if (c.duration_secs) {
                totalDuration += c.duration_secs;
                durationCount++;
            }
            if (c.campaign_id) {
                if (!metrics.campaigns[c.campaign_id]) {
                    metrics.campaigns[c.campaign_id] = { total: 0, answered: 0 };
                }
                metrics.campaigns[c.campaign_id].total++;
                if (c.state === CallState.COMPLETED) {
                    metrics.campaigns[c.campaign_id].answered++;
                }
            }
        });
        if (durationCount > 0) {
            metrics.avgDuration = Math.round(totalDuration / durationCount);
        }
        attempts.forEach((a) => {
            if (a.buyer_id) {
                if (!metrics.buyers[a.buyer_id]) {
                    metrics.buyers[a.buyer_id] = { total: 0, answered: 0 };
                }
                metrics.buyers[a.buyer_id].total++;
                if (a.state === CallAttemptState.ANSWERED ||
                    a.state === CallAttemptState.COMPLETED) {
                    metrics.buyers[a.buyer_id].answered++;
                }
            }
        });
        return metrics;
    }
};
CallsService = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [PrismaService,
        UsageService,
        WebhooksService])
], CallsService);
export { CallsService };
//# sourceMappingURL=calls.service.js.map