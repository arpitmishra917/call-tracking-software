import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { normalizeE164 } from '../common/phone.utils.js';

@Injectable()
export class BlockedCallersService {
  constructor(private prisma: PrismaService) {}
  async listBlockedCallers(workspaceId: string, params: any = {}) {
    const where = { workspace_id: workspaceId };
    if (params.search) {
      where['phone_number'] = { contains: params.search };
    }
    const [items, total] = await Promise.all([
      this.prisma.blockedCaller.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: params.offset || 0,
        take: params.limit || 50,
      }),
      this.prisma.blockedCaller.count({ where }),
    ]);
    return { items, total };
  }

  async blockCaller(workspaceId: string, phoneNumber: string, reason?: string) {
    const e164 = normalizeE164(phoneNumber);
    if (!e164) throw new BadRequestException('Invalid phone number');

    return this.prisma.blockedCaller.upsert({
      where: {
        workspace_id_phone_number: {
          workspace_id: workspaceId,
          phone_number: e164,
        },
      },
      update: {
        reason,
      },
      create: {
        workspace_id: workspaceId,
        phone_number: e164,
        reason,
      },
    });
  }

  async unblockCaller(workspaceId: string, id: string) {
    return this.prisma.blockedCaller.delete({
      where: { id, workspace_id: workspaceId },
    });
  }
}
