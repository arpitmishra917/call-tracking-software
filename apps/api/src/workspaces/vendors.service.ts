import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { PermissionsService } from '../permissions/permissions.service.js';

@Injectable()
export class VendorsService {
  constructor(private readonly prisma: PrismaService, private readonly permissionsService: PermissionsService) {}

  async listVendors(
    workspaceId: string,
    userId: string = '',
    filters?: { search?: string; status?: string; limit?: number; offset?: number },
  ) {
    const permissions = await this.permissionsService.getPermissionsForUser(workspaceId, userId);
    const readPerms = permissions.filter(p => p.key === 'vendor:read');
    if (readPerms.length === 0) throw new ForbiddenException('Missing vendor:read permission');

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
        if (member?.vendor_id) {
          authOrConditions.push({ id: member.vendor_id });
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
      this.prisma.vendor.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: filters?.offset || 0,
        take: filters?.limit !== undefined ? filters.limit : 50,
      }),
      this.prisma.vendor.count({ where }),
    ]);

    return { items, total };
  }

  async getVendor(workspaceId: string, id: string) {
    const vendor = await this.prisma.vendor.findFirst({
      where: { id, workspace_id: workspaceId },
      include: {
        phone_numbers: {
          include: {
            campaign: true,
          },
        },
      },
    });
    if (!vendor) throw new NotFoundException('Vendor not found');
    return vendor;
  }

  async createVendor(workspaceId: string, name: string) {
    if (!name || !name.trim()) throw new BadRequestException('Name is required');
    return this.prisma.vendor.create({
      data: {
        workspace_id: workspaceId,
        name: name.trim(),
        status: 'ACTIVE',
      },
    });
  }

  async updateVendor(
    workspaceId: string,
    id: string,
    data: { name?: string; status?: string }
  ) {
    const vendor = await this.getVendor(workspaceId, id);

    if (data.name !== undefined && (!data.name || !data.name.trim())) {
      throw new BadRequestException('Name cannot be empty');
    }

    if (data.status !== undefined && !['ACTIVE', 'INACTIVE'].includes(data.status)) {
      throw new BadRequestException('Invalid status. Must be ACTIVE or INACTIVE');
    }

    return this.prisma.vendor.update({
      where: { id: vendor.id },
      data: {
        ...(data.name && { name: data.name.trim() }),
        ...(data.status && { status: data.status }),
      },
    });
  }
}
