import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { normalizeE164 } from '../common/phone.utils.js';

@Injectable()
export class BuyersService {
  constructor(private prisma: PrismaService) {}

  async listBuyers(workspaceId: string, filters?: { search?: string; status?: string; limit?: number; offset?: number }) {
    const where: any = { workspace_id: workspaceId };
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
