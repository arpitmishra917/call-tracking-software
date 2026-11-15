import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { WebhookStatus } from '@prisma/client';
import { randomUUID } from 'crypto';

export interface WebhookLockResult {
  canProcess: boolean;
  id?: string;
  leaseToken?: string;
}

@Injectable()
export class WebhookIdempotencyService {
  private readonly logger = new Logger(WebhookIdempotencyService.name);
  public static readonly STALE_LOCK_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Attempts to acquire an exclusive lock on a webhook event using atomic conditional database operations.
   *
   * Guarantees:
   * 1. Mutual Exclusion: At most one worker can hold the lease for an event at any time.
   * 2. Atomic Stale Recovery: Stale locks (> 5 min) are claimed via atomic conditional updateMany.
   * 3. Active Lock Protection: Unexpired leases cannot be preempted or stolen.
   * 4. Fencing Tokens: Every lease issuance returns a unique leaseToken stored in the database.
   * 5. Retry Safety: Retries of FAILED or IGNORED events use atomic CAS transitions.
   */
  async acquireLock(
    provider: string,
    providerEventId: string,
    payload: any,
  ): Promise<WebhookLockResult> {
    const leaseToken = randomUUID();
    const leaseMarker = `lease:${leaseToken}`;

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
        // Case 1: Already PROCESSED - Idempotent safe NO-OP
        if (existing.status === WebhookStatus.PROCESSED) {
          this.logger.debug(
            `[${provider}] Event ${providerEventId} is already PROCESSED.`,
          );
          return { canProcess: false, id: existing.id };
        }

        // Case 2: Currently PENDING
        if (existing.status === WebhookStatus.PENDING) {
          const updatedAtTime = existing.updatedAt
            ? new Date(existing.updatedAt).getTime()
            : 0;
          const isStale =
            Date.now() - updatedAtTime >
            WebhookIdempotencyService.STALE_LOCK_THRESHOLD_MS;

          if (!isStale) {
            this.logger.debug(
              `[${provider}] Event ${providerEventId} is actively PENDING.`,
            );
            return { canProcess: false, id: existing.id };
          }

          // Stale lock recovery (BUG-BE-003): Use ATOMIC conditional database operation.
          // Only update if the event is STILL PENDING and updatedAt is <= stale threshold.
          const staleThreshold = new Date(
            Date.now() - WebhookIdempotencyService.STALE_LOCK_THRESHOLD_MS,
          );

          const recoveryResult = await this.prisma.webhookEvent.updateMany({
            where: {
              id: existing.id,
              status: WebhookStatus.PENDING,
              updatedAt: { lte: staleThreshold },
            },
            data: {
              status: WebhookStatus.PENDING,
              error: leaseMarker,
              payload: payload,
            },
          });

          if (recoveryResult.count === 0) {
            // Another worker claimed the stale lock or completed processing concurrently
            this.logger.debug(
              `[${provider}] Lost race to recover stale lock for event ${providerEventId}.`,
            );
            return { canProcess: false, id: existing.id };
          }

          this.logger.warn(
            `[${provider}] Event ${providerEventId} was stuck in PENDING for > ${
              WebhookIdempotencyService.STALE_LOCK_THRESHOLD_MS / 1000
            }s. Recovered stale lock with lease token ${leaseToken}.`,
          );
          return { canProcess: true, id: existing.id, leaseToken };
        }

        // Case 3: FAILED or IGNORED - retry via atomic conditional update
        const retryResult = await this.prisma.webhookEvent.updateMany({
          where: {
            id: existing.id,
            status: { in: [WebhookStatus.FAILED, WebhookStatus.IGNORED] },
          },
          data: {
            status: WebhookStatus.PENDING,
            error: leaseMarker,
            payload: payload,
          },
        });

        if (retryResult.count === 0) {
          // Another worker claimed the retry concurrently
          return { canProcess: false, id: existing.id };
        }

        return { canProcess: true, id: existing.id, leaseToken };
      }

      // Case 4: Initial event creation with lease marker
      const created = await this.prisma.webhookEvent.create({
        data: {
          provider,
          providerEventId,
          status: WebhookStatus.PENDING,
          error: leaseMarker,
          payload: payload,
        },
      });

      return { canProcess: true, id: created.id, leaseToken };
    } catch (err: any) {
      if (err.code === 'P2002') {
        // Unique constraint violation (race condition on concurrent initial delivery)
        this.logger.debug(
          `[${provider}] Event ${providerEventId} failed to lock (duplicate create race).`,
        );
        return { canProcess: false };
      }
      this.logger.error(
        `Could not acquire lock for ${provider} event ${providerEventId}: ${err.message}`,
      );
      return { canProcess: false };
    }
  }

  /**
   * Marks an event as PROCESSED.
   * leaseToken is strictly mandatory: Missing or invalid leaseToken will never permit a state transition.
   * Atomically verifies event ID, PENDING status, and matching leaseToken.
   */
  async markProcessed(id: string, leaseToken: string): Promise<boolean> {
    if (!id || !leaseToken) {
      this.logger.error(
        `markProcessed rejected: Missing mandatory id ('${id}') or leaseToken ('${leaseToken}').`,
      );
      return false;
    }

    const result = await this.prisma.webhookEvent.updateMany({
      where: {
        id,
        status: WebhookStatus.PENDING,
        error: `lease:${leaseToken}`,
      },
      data: {
        status: WebhookStatus.PROCESSED,
        error: null,
      },
    });

    if (result.count === 0) {
      this.logger.warn(
        `Failed to mark event ${id} PROCESSED. Lease lost, expired, invalid leaseToken, or event not in PENDING status.`,
      );
      return false;
    }
    return true;
  }

  /**
   * Marks an event as FAILED.
   * leaseToken is strictly mandatory: Missing or invalid leaseToken will never permit a state transition.
   * Atomically verifies event ID, PENDING status, and matching leaseToken.
   */
  async markFailed(
    id: string,
    errorMsg: string,
    leaseToken: string,
  ): Promise<boolean> {
    if (!id || !leaseToken) {
      this.logger.error(
        `markFailed rejected: Missing mandatory id ('${id}') or leaseToken ('${leaseToken}').`,
      );
      return false;
    }

    const result = await this.prisma.webhookEvent.updateMany({
      where: {
        id,
        status: WebhookStatus.PENDING,
        error: `lease:${leaseToken}`,
      },
      data: {
        status: WebhookStatus.FAILED,
        error: errorMsg || 'Unknown error',
      },
    });

    if (result.count === 0) {
      this.logger.warn(
        `Failed to mark event ${id} FAILED. Lease lost, expired, invalid leaseToken, or event not in PENDING status.`,
      );
      return false;
    }
    return true;
  }

  /**
   * Marks an event as IGNORED.
   * leaseToken is strictly mandatory: Missing or invalid leaseToken will never permit a state transition.
   * Atomically verifies event ID, PENDING status, and matching leaseToken.
   */
  async markIgnored(
    id: string,
    reason: string | undefined,
    leaseToken: string,
  ): Promise<boolean> {
    if (!id || !leaseToken) {
      this.logger.error(
        `markIgnored rejected: Missing mandatory id ('${id}') or leaseToken ('${leaseToken}').`,
      );
      return false;
    }

    const result = await this.prisma.webhookEvent.updateMany({
      where: {
        id,
        status: WebhookStatus.PENDING,
        error: `lease:${leaseToken}`,
      },
      data: {
        status: WebhookStatus.IGNORED,
        error: reason || null,
      },
    });

    if (result.count === 0) {
      this.logger.warn(
        `Failed to mark event ${id} IGNORED. Lease lost, expired, invalid leaseToken, or event not in PENDING status.`,
      );
      return false;
    }
    return true;
  }
}
