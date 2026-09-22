var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { Injectable, NotFoundException, BadRequestException, } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { normalizeE164 } from '../common/phone.utils.js';
let BuyersService = class BuyersService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async listBuyers(workspaceId) {
        return this.prisma.buyer.findMany({
            where: { workspace_id: workspaceId },
        });
    }
    async getBuyer(workspaceId, id) {
        const buyer = await this.prisma.buyer.findUnique({
            where: { id, workspace_id: workspaceId },
        });
        if (!buyer)
            throw new NotFoundException('Buyer not found');
        return buyer;
    }
    async createBuyer(workspaceId, name, destinationNumber, timeout = 30) {
        const e164 = normalizeE164(destinationNumber);
        if (!e164)
            throw new BadRequestException('Invalid destination number');
        return this.prisma.buyer.create({
            data: {
                workspace_id: workspaceId,
                name,
                destination_number: e164,
                timeout,
                status: 'ACTIVE',
            },
        });
    }
};
BuyersService = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [PrismaService])
], BuyersService);
export { BuyersService };
//# sourceMappingURL=buyers.service.js.map