import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class CampaignsService {
  constructor(private prisma: PrismaService) {}

  async listCampaigns(workspaceId: string) {
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

  async getCampaign(workspaceId: string, id: string) {
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
    if (!campaign) throw new NotFoundException('Campaign not found');
    return campaign;
  }

  async createCampaign(workspaceId: string, name: string) {
    return this.prisma.campaign.create({
      data: {
        workspace_id: workspaceId,
        name,
        status: 'ACTIVE',
      },
    });
  }

  async assignPhoneNumber(
    workspaceId: string,
    campaignId: string,
    phoneNumberId: string,
  ) {
    // verify campaign exists
    await this.getCampaign(workspaceId, campaignId);

    // verify phone number exists and belongs to workspace
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

  async addBuyerToCampaign(
    workspaceId: string,
    campaignId: string,
    buyerId: string,
    priority: number,
  ) {
    // verify campaign and buyer
    await this.getCampaign(workspaceId, campaignId);
    const buyer = await this.prisma.buyer.findUnique({
      where: { id: buyerId, workspace_id: workspaceId },
    });
    if (!buyer) throw new NotFoundException('Buyer not found in workspace');

    return this.prisma.campaignBuyer.create({
      data: {
        workspace_id: workspaceId,
        campaign_id: campaignId,
        buyer_id: buyerId,
        priority,
      },
    });
  }
}
