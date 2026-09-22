import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { UsageType } from '@prisma/client';

@Injectable()
export class UsageService {
  private readonly logger = new Logger(UsageService.name);

  constructor(private prisma: PrismaService) {}

  async recordUsage(
    workspaceId: string,
    type: UsageType,
    quantity: number,
    sourceId: string | null,
    idempotencyKey: string,
  ) {
    try {
      const record = await this.prisma.usageRecord.upsert({
        where: { idempotency_key: idempotencyKey },
        update: {},
        create: {
          workspace_id: workspaceId,
          type,
          quantity,
          source_id: sourceId,
          idempotency_key: idempotencyKey,
        },
      });

      this.logger.log(
        `Recorded usage for workspace ${workspaceId}: ${quantity} ${type} (source: ${sourceId}, key: ${idempotencyKey})`,
      );

      return record;
    } catch (e) {
      this.logger.error(
        `Failed to record usage for workspace ${workspaceId}: ${e instanceof Error ? e.message : String(e)}`,
      );
      throw e;
    }
  }
}
