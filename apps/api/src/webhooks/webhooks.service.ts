import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import * as crypto from 'crypto';
import { safeFetch } from '../common/safe-fetch.js';

@Injectable()
export class WebhooksService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebhooksService.name);
  private timer: NodeJS.Timeout | null = null;
  private readonly algorithm = 'aes-256-cbc';
  private readonly keyLength = 32;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    this.timer = setInterval(() => this.processDeliveries(), 5000);
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  private getEncryptionKey(): Buffer {
    const key = process.env.WEBHOOK_ENCRYPTION_KEY;
    if (!key || key.length !== 32) {
      throw new Error('WEBHOOK_ENCRYPTION_KEY must be exactly 32 characters');
    }
    return Buffer.from(key, 'utf8');
  }

  private encrypt(text: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(
      this.algorithm,
      this.getEncryptionKey(),
      iv,
    );
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return `${iv.toString('hex')}:${encrypted}`;
  }

  private decrypt(text: string): string {
    const [ivHex, encryptedHex] = text.split(':');
    if (!ivHex || !encryptedHex) throw new Error('Invalid encrypted format');
    const iv = Buffer.from(ivHex, 'hex');
    const decipher = crypto.createDecipheriv(
      this.algorithm,
      this.getEncryptionKey(),
      iv,
    );
    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  // Generate a random signing secret
  private generateSecret(): string {
    return 'whsec_' + crypto.randomBytes(24).toString('hex');
  }

  // --- CRUD for Outbound Webhooks ---

  async createWebhook(workspaceId: string, url: string) {
    const secret = this.generateSecret();
    const webhook = await this.prisma.outboundWebhook.create({
      data: {
        workspace_id: workspaceId,
        url,
        secret_encrypted: this.encrypt(secret),
      },
    });
    return { ...webhook, secret };
  }

  async getWebhooks(workspaceId: string) {
    return this.prisma.outboundWebhook.findMany({
      where: { workspace_id: workspaceId },
      select: { id: true, url: true, status: true, created_at: true },
    });
  }

  async deleteWebhook(workspaceId: string, id: string) {
    const webhook = await this.prisma.outboundWebhook.findUnique({
      where: { id },
    });
    if (!webhook || webhook.workspace_id !== workspaceId) {
      throw new NotFoundException('Webhook not found');
    }
    return this.prisma.outboundWebhook.delete({ where: { id } });
  }

  // --- Queue Events ---
  async queueEvent(workspaceId: string, eventType: string, payload: any) {
    const webhooks = await this.prisma.outboundWebhook.findMany({
      where: { workspace_id: workspaceId, status: 'ACTIVE' },
    });
    if (webhooks.length === 0) return;

    // generate a stable logical event ID. Use payload.id if available.
    const entityId = payload?.id || crypto.randomUUID();
    const eventId = `evt_${eventType}_${entityId}`;

    for (const webhook of webhooks) {
      try {
        await this.prisma.webhookDelivery.create({
          data: {
            outbound_webhook_id: webhook.id,
            event_id: eventId,
            event_type: eventType,
            payload_json: JSON.stringify(payload),
            status: 'PENDING',
            next_attempt_at: new Date(),
          },
        });
      } catch (e: any) {
        // Unique constraint violation means this event was already queued for this webhook
        if (e.code === 'P2002') {
          this.logger.debug(
            `Webhook delivery for event ${eventId} already exists. Skipping duplicate.`,
          );
        } else {
          throw e;
        }
      }
    }
  }

  // --- Delivery Processing ---
  private async processDeliveries() {
    let claimedIds: string[] = [];
    try {
      const claimed = await this.prisma.$queryRaw<Array<{ id: string }>>`
        UPDATE webhook_deliveries
        SET status = 'PROCESSING', updated_at = NOW()
        WHERE id IN (
          SELECT id FROM webhook_deliveries
          WHERE (status = 'PENDING' AND (next_attempt_at IS NULL OR next_attempt_at <= NOW()))
             OR (status = 'PROCESSING' AND updated_at < NOW() - INTERVAL '5 minutes')
          LIMIT 20
          FOR UPDATE SKIP LOCKED
        )
        RETURNING id;
      `;
      claimedIds = claimed.map((r) => r.id);
    } catch (e) {
      this.logger.error(
        'Failed to claim webhook deliveries: ' + (e as Error).message,
      );
      return;
    }

    if (claimedIds.length === 0) return;

    const deliveries = await this.prisma.webhookDelivery.findMany({
      where: { id: { in: claimedIds } },
      include: { outbound_webhook: true },
    });

    for (const delivery of deliveries) {
      await this.attemptDelivery(delivery);
    }
  }

  async attemptDelivery(delivery: any) {
    const {
      id,
      event_id,
      event_type,
      payload_json,
      attempt_count,
      outbound_webhook,
    } = delivery;
    const url = outbound_webhook.url;
    let secret = '';

    try {
      secret = this.decrypt(outbound_webhook.secret_encrypted);
    } catch (e) {
      this.logger.error(
        `Failed to decrypt webhook secret for ${outbound_webhook.id}`,
      );
      return this.markFailed(id, attempt_count, 'Decryption error');
    }

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const payloadBytes = Buffer.from(payload_json, 'utf8');
    const signaturePayload = `${event_id}.${timestamp}.${payload_json}`;

    const hmac = crypto.createHmac('sha256', secret);
    const signature = hmac.update(signaturePayload, 'utf8').digest('hex');
    const headerValue = `t=${timestamp},v1=${signature}`;

    try {
      const response = await safeFetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Webhook-Id': event_id,
          'Webhook-Delivery-Id': id,
          'Webhook-Signature': headerValue,
        },
        body: payload_json,
      });

      if (response.ok) {
        await this.prisma.webhookDelivery.update({
          where: { id },
          data: {
            status: 'SUCCESS',
            attempt_count: attempt_count + 1,
            delivered_at: new Date(),
          },
        });
      } else {
        await this.markFailed(id, attempt_count, `HTTP ${response.status}`);
      }
    } catch (error: any) {
      await this.markFailed(
        id,
        attempt_count,
        error.message || 'Network error',
      );
    }
  }

  private async markFailed(
    deliveryId: string,
    currentAttemptCount: number,
    errorMsg: string,
  ) {
    const maxAttempts = 5;
    const newAttemptCount = currentAttemptCount + 1;
    let status = 'PENDING';
    let nextAttemptAt: Date | null = new Date();

    if (newAttemptCount >= maxAttempts) {
      status = 'FAILED';
      nextAttemptAt = null;
    } else {
      // Exponential backoff
      nextAttemptAt.setSeconds(
        nextAttemptAt.getSeconds() + Math.pow(2, newAttemptCount) * 5,
      );
    }

    await this.prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: {
        status,
        attempt_count: newAttemptCount,
        next_attempt_at: nextAttemptAt,
        last_error: errorMsg,
      },
    });
  }
}
