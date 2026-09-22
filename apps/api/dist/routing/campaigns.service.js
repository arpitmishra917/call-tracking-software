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
let CampaignsService = class CampaignsService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async listCampaigns(workspaceId) {
        return this.prisma.campaign.findMany({
            where: { workspace_id: workspaceId },
            include: {
                phone_numbers: true,
                buyers: {
                    include: {
                        buyer: true,
                    },
                },
            },
        });
    }
    async getCampaign(workspaceId, id) {
        const campaign = await this.prisma.campaign.findUnique({
            where: { id, workspace_id: workspaceId },
            include: {
                phone_numbers: true,
                buyers: {
                    include: {
                        buyer: true,
                    },
                    orderBy: {
                        priority: 'asc',
                    },
                },
            },
        });
        if (!campaign)
            throw new NotFoundException('Campaign not found');
        return campaign;
    }
    async createCampaign(workspaceId, name) {
        return this.prisma.campaign.create({
            data: {
                workspace_id: workspaceId,
                name,
                status: 'ACTIVE',
            },
        });
    }
    async assignPhoneNumber(workspaceId, campaignId, phoneNumberId) {
        await this.getCampaign(workspaceId, campaignId);
        const phone = await this.prisma.phoneNumber.findUnique({
            where: { id: phoneNumberId, workspace_id: workspaceId },
        });
        if (!phone)
            throw new NotFoundException('Phone number not found in workspace');
        return this.prisma.phoneNumber.update({
            where: { id: phoneNumberId },
            data: { campaign_id: campaignId },
        });
    }
    async addBuyerToCampaign(workspaceId, campaignId, buyerId, priority) {
        await this.getCampaign(workspaceId, campaignId);
        const buyer = await this.prisma.buyer.findUnique({
            where: { id: buyerId, workspace_id: workspaceId },
        });
        if (!buyer)
            throw new NotFoundException('Buyer not found in workspace');
        return this.prisma.campaignBuyer.create({
            data: {
                workspace_id: workspaceId,
                campaign_id: campaignId,
                buyer_id: buyerId,
                priority,
            },
        });
    }
};
CampaignsService = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [PrismaService])
], CampaignsService);
export { CampaignsService };
//# sourceMappingURL=campaigns.service.js.map