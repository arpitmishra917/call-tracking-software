import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PermissionsService } from '../permissions/permissions.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { normalizeE164 } from '../common/phone.utils.js';

@Injectable()
export class BuyersService {
  constructor(private prisma: PrismaService, private permissionsService: PermissionsService) {}

  async listBuyers(workspaceId: string, userId: string = '', filters?: { search?: string; status?: string; limit?: number; offset?: number }) {

    const permissions = await this.permissionsService.getPermissionsForUser(workspaceId, userId);
    const readPerms = permissions.filter(p => p.key === 'buyer:read');
    if (readPerms.length === 0) throw new ForbiddenException('Missing buyer:read permission');

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
          authOrConditions.push({ id: member.buyer_id });
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
      where.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { destination_number: { contains: filters.search } }
      ];
    }
    if (filters?.status) {
      where.status = filters.status;
    }

    const [items, total] = await Promise.all([
      this.prisma.buyer.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: filters?.offset || 0,
        take: filters?.limit || 50,
      }),
      this.prisma.buyer.count({ where }),
    ]);
    return { items, total };
  }

  async getBuyer(workspaceId: string, id: string) {
    const buyer = await this.prisma.buyer.findUnique({
      where: { id, workspace_id: workspaceId },
      include: {
        campaigns: {
          include: {
            campaign: true,
          },
        },
      },
    });
    if (!buyer) throw new NotFoundException('Buyer not found');
    return buyer;
  }

  async createBuyer(
    workspaceId: string,
    name: string,
    destinationNumber: string,
    timeout: number = 30,
  ) {
    const e164 = normalizeE164(destinationNumber);
    if (!e164) throw new BadRequestException('Invalid destination number');

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

  async updateBuyer(
    workspaceId: string,
    id: string,
    data: {
      name?: string;
      destinationNumber?: string;
      timeout?: number;
      status?: string;
    },
  ) {
    const buyer = await this.getBuyer(workspaceId, id);

    let e164: string | undefined;
    if (data.destinationNumber) {
      e164 = normalizeE164(data.destinationNumber);
      if (!e164) throw new BadRequestException('Invalid destination number');
    }

    return this.prisma.buyer.update({
      where: { id: buyer.id },
      data: {
        ...(data.name && { name: data.name }),
        ...(e164 && { destination_number: e164 }),
        ...(data.timeout !== undefined && { timeout: data.timeout }),
        ...(data.status && { status: data.status }),
      },
    });
  }
}
