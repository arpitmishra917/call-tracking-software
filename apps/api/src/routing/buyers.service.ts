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

  async listBuyers(workspaceId: string) {
    return this.prisma.buyer.findMany({
      where: { workspace_id: workspaceId },
    });
  }

  async getBuyer(workspaceId: string, id: string) {
    const buyer = await this.prisma.buyer.findUnique({
      where: { id, workspace_id: workspaceId },
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
}
