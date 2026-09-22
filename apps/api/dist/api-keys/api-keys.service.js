var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import * as crypto from 'crypto';
let ApiKeysService = class ApiKeysService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async createApiKey(workspaceId, userId, name) {
        const rawSecret = crypto.randomBytes(32).toString('hex');
        const keyPrefix = rawSecret.substring(0, 8);
        const hashedSecret = crypto
            .createHash('sha256')
            .update(rawSecret)
            .digest('hex');
        const apiKey = await this.prisma.apiKey.create({
            data: {
                workspace_id: workspaceId,
                user_id: userId,
                name,
                key_prefix: keyPrefix,
                hashed_secret: hashedSecret,
            },
        });
        return {
            ...apiKey,
            rawSecret: `pk_${rawSecret}`,
        };
    }
    async listApiKeys(workspaceId) {
        return this.prisma.apiKey.findMany({
            where: { workspace_id: workspaceId },
            orderBy: { created_at: 'desc' },
            select: {
                id: true,
                workspace_id: true,
                name: true,
                key_prefix: true,
                last_used_at: true,
                revoked_at: true,
                created_at: true,
            },
        });
    }
    async revokeApiKey(workspaceId, id) {
        const key = await this.prisma.apiKey.findFirst({
            where: { id, workspace_id: workspaceId },
        });
        if (!key) {
            throw new NotFoundException('API key not found');
        }
        return this.prisma.apiKey.update({
            where: { id },
            data: { revoked_at: new Date() },
        });
    }
    async validateApiKey(token) {
        if (!token.startsWith('pk_')) {
            return null;
        }
        const rawSecret = token.substring(3);
        const keyPrefix = rawSecret.substring(0, 8);
        const hashedSecret = crypto
            .createHash('sha256')
            .update(rawSecret)
            .digest('hex');
        const key = await this.prisma.apiKey.findFirst({
            where: {
                key_prefix: keyPrefix,
                hashed_secret: hashedSecret,
                revoked_at: null,
            },
        });
        if (key) {
            this.prisma.apiKey
                .update({
                where: { id: key.id },
                data: { last_used_at: new Date() },
            })
                .catch(() => {
            });
        }
        return key;
    }
};
ApiKeysService = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [PrismaService])
], ApiKeysService);
export { ApiKeysService };
//# sourceMappingURL=api-keys.service.js.map