var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { normalizeE164 } from '../common/phone.utils.js';
let BlockedCallersService = class BlockedCallersService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async listBlockedCallers(workspaceId) {
        return this.prisma.blockedCaller.findMany({
            where: { workspace_id: workspaceId },
        });
    }
    async blockCaller(workspaceId, phoneNumber, reason) {
        const e164 = normalizeE164(phoneNumber);
        if (!e164)
            throw new BadRequestException('Invalid phone number');
        return this.prisma.blockedCaller.upsert({
            where: {
                workspace_id_phone_number: {
                    workspace_id: workspaceId,
                    phone_number: e164,
                },
            },
            update: {
                reason,
            },
            create: {
                workspace_id: workspaceId,
                phone_number: e164,
                reason,
            },
        });
    }
    async unblockCaller(workspaceId, id) {
        return this.prisma.blockedCaller.delete({
            where: { id, workspace_id: workspaceId },
        });
    }
};
BlockedCallersService = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [PrismaService])
], BlockedCallersService);
export { BlockedCallersService };
//# sourceMappingURL=blocked-callers.service.js.map