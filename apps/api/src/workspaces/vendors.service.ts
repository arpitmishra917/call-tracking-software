import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class VendorsService {
  constructor(private readonly prisma: PrismaService) {}

  async listVendors(workspaceId: string) {
    const items = await this.prisma.vendor.findMany({
      where: { workspace_id: workspaceId },
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
