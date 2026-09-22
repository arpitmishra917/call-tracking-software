var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var WebhookIdempotencyService_1;
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { WebhookStatus } from '@prisma/client';
let WebhookIdempotencyService = WebhookIdempotencyService_1 = class WebhookIdempotencyService {
    prisma;
    logger = new Logger(WebhookIdempotencyService_1.name);
    constructor(prisma) {
        this.prisma = prisma;
    }
    async acquireLock(provider, providerEventId, payload) {
        try {
            const existing = await this.prisma.webhookEvent.findUnique({
                where: {
                    provider_providerEventId: {
                        provider,
                        providerEventId,
                    },
                },
            });
            if (existing) {
                if (existing.status === WebhookStatus.PROCESSED) {
                    this.logger.debug(`[${provider}] Event ${providerEventId} is already PROCESSED.`);
                    return { canProcess: false, id: existing.id };
                }
                if (existing.status === WebhookStatus.PENDING) {
                    this.logger.debug(`[${provider}] Event ${providerEventId} is currently PENDING.`);
                    return { canProcess: false, id: existing.id };
                }
                await this.prisma.webhookEvent.update({
                    where: { id: existing.id },
                    data: {
                        status: WebhookStatus.PENDING,
                        error: null,
                        payload: payload,
                    },
                });
                return { canProcess: true, id: existing.id };
            }
            const created = await this.prisma.webhookEvent.create({
                data: {
                    provider,
                    providerEventId,
                    status: WebhookStatus.PENDING,
                    payload: payload,
                },
            });
            return { canProcess: true, id: created.id };
        }
        catch (err) {
            if (err.code === 'P2002') {
                this.logger.debug(`[${provider}] Event ${providerEventId} failed to lock (duplicate race).`);
                return { canProcess: false };
            }
            this.logger.error(`Could not acquire lock for ${provider} event ${providerEventId}: ${err.message}`);
            return { canProcess: false };
        }
    }
    async markProcessed(id) {
        await this.prisma.webhookEvent.update({
            where: { id },
            data: { status: WebhookStatus.PROCESSED },
        });
    }
    async markFailed(id, errorMsg) {
        await this.prisma.webhookEvent.update({
            where: { id },
            data: { status: WebhookStatus.FAILED, error: errorMsg },
        });
    }
    async markIgnored(id, reason) {
        await this.prisma.webhookEvent.update({
            where: { id },
            data: { status: WebhookStatus.IGNORED, error: reason },
        });
    }
};
WebhookIdempotencyService = WebhookIdempotencyService_1 = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [PrismaService])
], WebhookIdempotencyService);
export { WebhookIdempotencyService };
//# sourceMappingURL=webhook-idempotency.service.js.map