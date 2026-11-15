import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PermissionsService } from '../permissions/permissions.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class CampaignsService {
  private sanitizeCampaignForBuyer(campaign: any, buyerId?: string | null) {
    const { default_payout_amount, buyers, destination_numbers, phone_numbers, ...rest } = campaign;
    const filteredBuyers = buyers
      ? buyers
          .filter((b: any) => b.buyer_id === buyerId)
          .map((b: any) => ({
            id: b.id,
            campaign_id: b.campaign_id,
            buyer_id: b.buyer_id,
            status: b.status,
            priority: b.priority,
            created_at: b.created_at,
            updated_at: b.updated_at,
            buyer: b.buyer
              ? {
                  id: b.buyer.id,
                  name: b.buyer.name,
                  destination_number: b.buyer.destination_number,
                  status: b.buyer.status,
                  max_concurrent_calls: b.buyer.max_concurrent_calls,
                }
              : undefined,
          }))
      : [];

    const filteredDestinations = destination_numbers
      ? destination_numbers
          .filter((d: any) => d.destination_number?.buyer_id === buyerId)
          .map((d: any) => ({
            id: d.id,
            campaign_id: d.campaign_id,
            destination_number_id: d.destination_number_id,
            priority: d.priority,
            weight: d.weight,
            status: d.status,
            created_at: d.created_at,
            updated_at: d.updated_at,
            destination_number: d.destination_number
              ? {
                  id: d.destination_number.id,
                  buyer_id: d.destination_number.buyer_id,
                  destination_number: d.destination_number.destination_number,
                  name: d.destination_number.name,
                  status: d.destination_number.status,
                  timeout: d.destination_number.timeout,
                  max_concurrent_calls: d.destination_number.max_concurrent_calls,
                }
              : undefined,
          }))
      : [];

    const sanitizedPhoneNumbers = phone_numbers
      ? phone_numbers.map((pn: any) => {
          const { vendor_id, vendor, ...pnRest } = pn;
          return pnRest;
        })
      : [];

    return {
      ...rest,
      buyers: filteredBuyers,
      destination_numbers: filteredDestinations,
      phone_numbers: sanitizedPhoneNumbers,
    };
  }

  constructor(private prisma: PrismaService, private permissionsService: PermissionsService) {}

  async listCampaigns(workspaceId: string, userId: string = '', filters?: { search?: string; status?: string; limit?: number; offset?: number }) {

    const permissions = await this.permissionsService.getPermissionsForUser(workspaceId, userId);
    const readPerms = permissions.filter(p => p.key === 'campaign:read');
    if (readPerms.length === 0) throw new ForbiddenException('Missing campaign:read permission');

    const hasAll = readPerms.some(p => p.scope_type === 'ALL');
    const hasAssigned = readPerms.some(p => p.scope_type === 'ASSIGNED');
    const allowedResourceIds = readPerms.filter(p => p.resource_id).map(p => p.resource_id);

    const where: any = { workspace_id: workspaceId };

    if (!hasAll) {
      let authOrConditions: any[] = [];
      if (hasAssigned) {
        const member = await this.prisma.workspaceMember.findUnique({
          where: { workspace_id_user_id: { workspace_id: workspaceId, user_id: userId } }
        });
        if (member?.buyer_id) {
          authOrConditions.push({ buyers: { some: { buyer_id: member.buyer_id } } });
          authOrConditions.push({ destination_numbers: { some: { destination_number: { buyer_id: member.buyer_id } } } });
        }
      }
      if (allowedResourceIds.length > 0) {
        authOrConditions.push({ id: { in: allowedResourceIds } });
      }
      if (authOrConditions.length === 0) {
        return { items: [], total: 0 };
      }
      where.AND = [{ OR: authOrConditions }];
    }
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
          destination_numbers: {
            include: {
              destination_number: {
                include: {
                  buyer: true,
                },
              },
            },
            orderBy: [{ priority: 'asc' }, { weight: 'desc' }],
          },
        },
        orderBy: { created_at: 'desc' },
        skip: filters?.offset || 0,
        take: filters?.limit || 50,
      }),
      this.prisma.campaign.count({ where }),
    ]);
    const member = userId
      ? await this.prisma.workspaceMember.findUnique({
          where: { workspace_id_user_id: { workspace_id: workspaceId, user_id: userId } },
        })
      : null;
    const isBuyer = member?.participant_type === 'BUYER';
    const buyerId = member?.buyer_id;

    const mappedItems = isBuyer
      ? items.map((c: any) => this.sanitizeCampaignForBuyer(c, buyerId))
      : items;

    return { items: mappedItems, total };
  }

  async getCampaign(workspaceId: string, id: string, userId?: string) {
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
        destination_numbers: {
          include: {
            destination_number: {
              include: {
                buyer: true,
              },
            },
          },
          orderBy: [{ priority: 'asc' }, { weight: 'desc' }],
        },
      },
    });
    if (!campaign) throw new NotFoundException('Campaign not found');
    if (userId) {
      const member = await this.prisma.workspaceMember.findUnique({
        where: { workspace_id_user_id: { workspace_id: workspaceId, user_id: userId } },
      });
      if (member?.participant_type === 'BUYER') {
        const isAssigned =
          campaign.buyers.some((b: any) => b.buyer_id === member.buyer_id) ||
          (campaign.destination_numbers &&
            campaign.destination_numbers.some(
              (d: any) => d.destination_number?.buyer_id === member.buyer_id,
            ));
        if (!isAssigned) {
          throw new ForbiddenException('Access denied to campaign');
        }
        return this.sanitizeCampaignForBuyer(campaign, member.buyer_id);
      }
    }

    return campaign;
  }

  async createCampaign(
    workspaceId: string,
    input:
      | string
      | {
          name: string;
          default_revenue_amount?: number | string | null;
          default_payout_amount?: number | string | null;
          currency?: string;
          conversion_duration_secs?: number | string | null;
        },
  ) {
    const rawData = typeof input === 'string' ? { name: input } : input;
    if (!rawData.name || typeof rawData.name !== 'string' || !rawData.name.trim()) {
      throw new BadRequestException('Campaign name is required');
    }

    let defaultRevenue: Prisma.Decimal | null = null;
    if (rawData.default_revenue_amount !== undefined && rawData.default_revenue_amount !== null && rawData.default_revenue_amount !== '') {
      const num = Number(rawData.default_revenue_amount);
      if (isNaN(num) || num < 0) {
        throw new BadRequestException('default_revenue_amount must be a non-negative number');
      }
      defaultRevenue = new Prisma.Decimal(rawData.default_revenue_amount.toString());
    }

    let defaultPayout: Prisma.Decimal | null = null;
    if (rawData.default_payout_amount !== undefined && rawData.default_payout_amount !== null && rawData.default_payout_amount !== '') {
      const num = Number(rawData.default_payout_amount);
      if (isNaN(num) || num < 0) {
        throw new BadRequestException('default_payout_amount must be a non-negative number');
      }
      defaultPayout = new Prisma.Decimal(rawData.default_payout_amount.toString());
    }

    let currency = 'USD';
    if (rawData.currency !== undefined && rawData.currency !== null && rawData.currency !== '') {
      const curr = rawData.currency.trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(curr)) {
        throw new BadRequestException('currency must be a valid 3-letter currency code (e.g. USD)');
      }
      currency = curr;
    }

    let conversionDurationSecs = 90;
    if (rawData.conversion_duration_secs !== undefined) {
      if (rawData.conversion_duration_secs === null || rawData.conversion_duration_secs === '') {
        throw new BadRequestException('conversion_duration_secs must be a non-negative integer');
      }
      const num = Number(rawData.conversion_duration_secs);
      if (
        typeof rawData.conversion_duration_secs === 'boolean' ||
        isNaN(num) ||
        !Number.isInteger(num) ||
        num < 0
      ) {
        throw new BadRequestException('conversion_duration_secs must be a non-negative integer');
      }
      conversionDurationSecs = num;
    }

    return this.prisma.campaign.create({
      data: {
        workspace_id: workspaceId,
        name: rawData.name.trim(),
        status: 'ACTIVE',
        conversion_duration_secs: conversionDurationSecs,
        default_revenue_amount: defaultRevenue,
        default_payout_amount: defaultPayout,
        currency,
      },
    });
  }

  async updateCampaign(
    workspaceId: string,
    id: string,
    data: {
      name?: string;
      status?: string;
      default_revenue_amount?: number | string | null;
      default_payout_amount?: number | string | null;
      currency?: string;
          conversion_duration_secs?: number | string | null;
        },
  ) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id, workspace_id: workspaceId },
    });
    if (!campaign) throw new NotFoundException('Campaign not found');

    const updateData: any = {};
    if (data.name !== undefined) {
      if (typeof data.name !== 'string' || !data.name.trim()) {
        throw new BadRequestException('Campaign name cannot be empty');
      }
      updateData.name = data.name.trim();
    }

    if (data.status !== undefined) {
      updateData.status = data.status;
    }

    if (data.default_revenue_amount !== undefined) {
      if (data.default_revenue_amount === null || data.default_revenue_amount === '') {
        updateData.default_revenue_amount = null;
      } else {
        const num = Number(data.default_revenue_amount);
        if (isNaN(num) || num < 0) {
          throw new BadRequestException('default_revenue_amount must be a non-negative number');
        }
        updateData.default_revenue_amount = new Prisma.Decimal(data.default_revenue_amount.toString());
      }
    }

    if (data.default_payout_amount !== undefined) {
      if (data.default_payout_amount === null || data.default_payout_amount === '') {
        updateData.default_payout_amount = null;
      } else {
        const num = Number(data.default_payout_amount);
        if (isNaN(num) || num < 0) {
          throw new BadRequestException('default_payout_amount must be a non-negative number');
        }
        updateData.default_payout_amount = new Prisma.Decimal(data.default_payout_amount.toString());
      }
    }

    if (data.currency !== undefined) {
      if (data.currency === null || data.currency === '') {
        updateData.currency = 'USD';
      } else {
        const curr = data.currency.trim().toUpperCase();
        if (!/^[A-Z]{3}$/.test(curr)) {
          throw new BadRequestException('currency must be a valid 3-letter currency code (e.g. USD)');
        }
        updateData.currency = curr;
      }
    }

    if (data.conversion_duration_secs !== undefined) {
      if (data.conversion_duration_secs === null || data.conversion_duration_secs === '') {
        throw new BadRequestException('conversion_duration_secs must be a non-negative integer');
      }
      const num = Number(data.conversion_duration_secs);
      if (
        typeof data.conversion_duration_secs === 'boolean' ||
        isNaN(num) ||
        !Number.isInteger(num) ||
        num < 0
      ) {
        throw new BadRequestException('conversion_duration_secs must be a non-negative integer');
      }
      updateData.conversion_duration_secs = num;
    }

    return this.prisma.campaign.update({
      where: { id },
      data: updateData,
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

  async removePhoneNumber(
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

    if (phone.campaign_id !== campaignId) {
      throw new BadRequestException('Phone number is not assigned to this campaign');
    }

    return this.prisma.phoneNumber.update({
      where: { id: phoneNumberId },
      data: { campaign_id: null },
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

  async addDestinationToCampaign(
    workspaceId: string,
    campaignId: string,
    destinationNumberId: string,
    priority?: number,
    weight?: number,
  ) {
    await this.getCampaign(workspaceId, campaignId);
    const destination = await this.prisma.destinationNumber.findUnique({
      where: { id: destinationNumberId, workspace_id: workspaceId },
    });
    if (!destination) {
      throw new NotFoundException('Destination number not found in workspace');
    }

    const existing = await this.prisma.campaignDestinationNumber.findUnique({
      where: {
        campaign_id_destination_number_id: {
          campaign_id: campaignId,
          destination_number_id: destinationNumberId,
        },
      },
    });
    if (existing) {
      throw new BadRequestException('Destination number is already assigned to this campaign');
    }

    let targetPriority = priority;
    if (targetPriority === undefined || targetPriority === null) {
      const highest = await this.prisma.campaignDestinationNumber.findFirst({
        where: { campaign_id: campaignId, workspace_id: workspaceId },
        orderBy: { priority: 'desc' },
      });
      targetPriority = (highest?.priority ?? 0) + 1;
    }

    return this.prisma.campaignDestinationNumber.create({
      data: {
        workspace_id: workspaceId,
        campaign_id: campaignId,
        destination_number_id: destinationNumberId,
        priority: targetPriority,
        weight: weight ?? 100,
        status: 'ACTIVE',
      },
      include: {
        destination_number: {
          include: {
            buyer: true,
          },
        },
      },
    });
  }

  async removeDestinationFromCampaign(
    workspaceId: string,
    campaignId: string,
    destinationNumberId: string,
  ) {
    await this.getCampaign(workspaceId, campaignId);

    const campaignDest = await this.prisma.campaignDestinationNumber.findFirst({
      where: {
        campaign_id: campaignId,
        destination_number_id: destinationNumberId,
        workspace_id: workspaceId,
      },
    });

    if (!campaignDest) {
      throw new NotFoundException('Destination number not assigned to this campaign');
    }

    return this.prisma.campaignDestinationNumber.delete({
      where: { id: campaignDest.id },
    });
  }

  async reorderDestinationsInCampaign(
    workspaceId: string,
    campaignId: string,
    destinationNumberIds: string[],
  ) {
    await this.getCampaign(workspaceId, campaignId);

    return this.prisma.$transaction(async (tx) => {
      const currentDestinations = await tx.campaignDestinationNumber.findMany({
        where: { campaign_id: campaignId, workspace_id: workspaceId },
      });

      if (currentDestinations.length !== destinationNumberIds.length) {
        throw new BadRequestException('Reorder list must contain exactly all currently assigned destination numbers');
      }

      const assignedIds = new Set(currentDestinations.map(cd => cd.destination_number_id));
      for (const id of destinationNumberIds) {
        if (!assignedIds.has(id)) {
          throw new BadRequestException(`Destination number ${id} is not assigned to this campaign`);
        }
      }

      const result = [];
      for (let i = 0; i < destinationNumberIds.length; i++) {
        const dnId = destinationNumberIds[i];
        const record = currentDestinations.find(cd => cd.destination_number_id === dnId);
        if (record) {
          const updated = await tx.campaignDestinationNumber.update({
            where: { id: record.id },
            data: { priority: i + 1 },
          });
          result.push(updated);
        }
      }

      return result;
    });
  }
}
