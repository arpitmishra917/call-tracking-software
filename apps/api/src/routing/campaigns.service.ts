import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class CampaignsService {
  constructor(private prisma: PrismaService) {}

  async listCampaigns(workspaceId: string, filters?: { search?: string; status?: string; limit?: number; offset?: number }) {
    const where: any = { workspace_id: workspaceId };
    if (filters?.search) {
      where.name = { contains: filters.search, mode: 'insensitive' };
    }
    if (filters?.status) {
      where.status = filters.status;
    }

    const [items, total] = await Promise.all([
      this.prisma.campaign.findMany({
        where,
        include: {
          phone_numbers: true,
          buyers: {
            include: {
              buyer: true,
            },
          },
        },
        orderBy: { created_at: 'desc' },
        skip: filters?.offset || 0,
        take: filters?.limit || 50,
      }),
      this.prisma.campaign.count({ where }),
    ]);
    return { items, total };
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

  async updateCampaign(
    workspaceId: string,
    id: string,
    data: { name?: string; status?: string }
  ) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id, workspace_id: workspaceId },
    });
    if (!campaign) throw new NotFoundException('Campaign not found');

    return this.prisma.campaign.update({
      where: { id },
      data,
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

  async removeBuyerFromCampaign(workspaceId: string, campaignId: string, buyerId: string) {
    // verify campaign exists
    await this.getCampaign(workspaceId, campaignId);
    
    const campaignBuyer = await this.prisma.campaignBuyer.findFirst({
      where: { campaign_id: campaignId, buyer_id: buyerId, workspace_id: workspaceId },
    });

    if (!campaignBuyer) {
      throw new NotFoundException('Buyer not assigned to this campaign');
    }

    return this.prisma.campaignBuyer.delete({
      where: { id: campaignBuyer.id },
    });
  }

  async reorderBuyersInCampaign(workspaceId: string, campaignId: string, buyerIds: string[]) {
    // verify campaign exists
    await this.getCampaign(workspaceId, campaignId);

    // execute a single transaction to prevent unique constraint collisions
    return this.prisma.$transaction(async (tx) => {
      // 1. Get current assigned buyers
      const currentBuyers = await tx.campaignBuyer.findMany({
        where: { campaign_id: campaignId, workspace_id: workspaceId },
      });

      // 2. Validate input covers exactly the assigned buyers
      if (currentBuyers.length !== buyerIds.length) {
        throw new BadRequestException('Reorder list must contain exactly all currently assigned buyers');
      }

      const assignedBuyerIds = new Set(currentBuyers.map(cb => cb.buyer_id));
      for (const id of buyerIds) {
        if (!assignedBuyerIds.has(id)) {
           throw new BadRequestException(`Buyer ${id} is not assigned to this campaign`);
        }
      }

      // 3. To avoid unique constraint violations on [campaign_id, priority], we temporarily 
      // set all priorities to a negative offset
      for (let i = 0; i < currentBuyers.length; i++) {
        await tx.campaignBuyer.update({
          where: { id: currentBuyers[i].id },
          data: { priority: -1 * (i + 1) }, 
        });
      }

      // 4. Now assign the final target priorities 1, 2, 3...
      const result = [];
      for (let i = 0; i < buyerIds.length; i++) {
        const buyerId = buyerIds[i];
        const campaignBuyer = currentBuyers.find(cb => cb.buyer_id === buyerId);
        if (campaignBuyer) {
          const updated = await tx.campaignBuyer.update({
            where: { id: campaignBuyer.id },
            data: { priority: i + 1 },
          });
          result.push(updated);
        }
      }

      return result;
    });
  }
}
