import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { WebhookStatus } from '@prisma/client';

@Injectable()
export class WebhookIdempotencyService {
  private readonly logger = new Logger(WebhookIdempotencyService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Attempts to lock an event for processing.
   * If the event is already PENDING or PROCESSED, returns { canProcess: false }.
   * If the event doesn't exist, creates it as PENDING and returns { canProcess: true }.
   */
  async acquireLock(
    provider: string,
    providerEventId: string,
    payload: any,
  ): Promise<{ canProcess: boolean; id?: string }> {
    try {
      const existing = await this.prisma.webhookEvent.findUnique({
        where: {
          provider_providerEventId: {
            provider,
            providerEventId,
          },
        },
      });

      if (existing) {
        if (existing.status === WebhookStatus.PROCESSED) {
          this.logger.debug(
            `[${provider}] Event ${providerEventId} is already PROCESSED.`,
          );
          return { canProcess: false, id: existing.id };
        }
        if (existing.status === WebhookStatus.PENDING) {
          this.logger.debug(
            `[${provider}] Event ${providerEventId} is currently PENDING.`,
          );
          return { canProcess: false, id: existing.id };
        }

        // If FAILED or IGNORED, retry
        await this.prisma.webhookEvent.update({
          where: { id: existing.id },
          data: {
            status: WebhookStatus.PENDING,
            error: null,
            payload: payload,
          },
        });
        return { canProcess: true, id: existing.id };
      }

      const created = await this.prisma.webhookEvent.create({
        data: {
          provider,
          providerEventId,
          status: WebhookStatus.PENDING,
          payload: payload,
        },
      });

      return { canProcess: true, id: created.id };
    } catch (err: any) {
      if (err.code === 'P2002') {
        // Unique constraint violation (race condition on creation)
        this.logger.debug(
          `[${provider}] Event ${providerEventId} failed to lock (duplicate race).`,
        );
        return { canProcess: false };
      }
      this.logger.error(
        `Could not acquire lock for ${provider} event ${providerEventId}: ${err.message}`,
      );
      return { canProcess: false };
    }
  }

  async markProcessed(id: string): Promise<void> {
    await this.prisma.webhookEvent.update({
      where: { id },
      data: { status: WebhookStatus.PROCESSED },
    });
  }

  async markFailed(id: string, errorMsg: string): Promise<void> {
    await this.prisma.webhookEvent.update({
      where: { id },
      data: { status: WebhookStatus.FAILED, error: errorMsg },
    });
  }

  async markIgnored(id: string, reason?: string): Promise<void> {
    await this.prisma.webhookEvent.update({
      where: { id },
      data: { status: WebhookStatus.IGNORED, error: reason },
    });
  }
}
