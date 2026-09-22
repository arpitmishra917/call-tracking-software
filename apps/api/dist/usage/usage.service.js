var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var UsageService_1;
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
let UsageService = UsageService_1 = class UsageService {
    prisma;
    logger = new Logger(UsageService_1.name);
    constructor(prisma) {
        this.prisma = prisma;
    }
    async recordUsage(workspaceId, type, quantity, sourceId, idempotencyKey) {
        try {
            const record = await this.prisma.usageRecord.upsert({
                where: { idempotency_key: idempotencyKey },
                update: {},
                create: {
                    workspace_id: workspaceId,
                    type,
                    quantity,
                    source_id: sourceId,
                    idempotency_key: idempotencyKey,
                },
            });
            this.logger.log(`Recorded usage for workspace ${workspaceId}: ${quantity} ${type} (source: ${sourceId}, key: ${idempotencyKey})`);
            return record;
        }
        catch (e) {
            this.logger.error(`Failed to record usage for workspace ${workspaceId}: ${e instanceof Error ? e.message : String(e)}`);
            throw e;
        }
    }
};
UsageService = UsageService_1 = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [PrismaService])
], UsageService);
export { UsageService };
//# sourceMappingURL=usage.service.js.map