import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { PermissionsService } from '../permissions/permissions.service.js';

@Injectable()
export class VendorsService {
  constructor(private readonly prisma: PrismaService, private readonly permissionsService: PermissionsService) {}

  async listVendors(workspaceId: string, userId: string) {
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
        return { items: [] };
      }
      where.AND = [{ OR: authOrConditions }];
    }

    const items = await this.prisma.vendor.findMany({
      where,
      orderBy: { created_at: 'desc' },
    });
    return { items };
  }

  async getVendor(workspaceId: string, id: string) {
    const vendor = await this.prisma.vendor.findFirst({
      where: { id, workspace_id: workspaceId },
    });
    if (!vendor) throw new NotFoundException('Vendor not found');
    return vendor;
  }

  async createVendor(workspaceId: string, name: string) {
    if (!name) throw new BadRequestException('Name is required');
    return this.prisma.vendor.create({
      data: {
        workspace_id: workspaceId,
        name,
        status: 'ACTIVE',
      },
    });
  }
}
