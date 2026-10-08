import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CommercialStatus, DisputeStatus } from '@prisma/client';

export interface FinalizationBatchResult {
  finalizedCount: number;
  candidateCount: number;
  blockedByDisputeCount: number;
}

@Injectable()
export class CommercialFinalizationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CommercialFinalizationService.name);
  private timer: NodeJS.Timeout | null = null;
  private isProcessing = false;

  // 10-minute polling interval as mandated by frozen AD-02
  public readonly FINALIZATION_POLL_INTERVAL_MS = 10 * 60 * 1000;
  private readonly BATCH_SIZE = 100;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    this.logger.log('Starting Commercial Finalization worker loop (10m interval)...');
    this.timer = setInterval(() => {
      this.processFinalizationBatch().catch((err) => {
        this.logger.error(`Finalization loop error: ${err.message}`, err.stack);
      });
    }, this.FINALIZATION_POLL_INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Processes a single batch of matured PENDING CallCommercial records.
   * Can be invoked by the background interval or directly by settlement sweeps / tests.
   *
   * Invariants (AD-02):
   * 1. Only records where status === 'PENDING' are considered.
   * 2. Only records where finalizes_at != null AND finalizes_at <= referenceTime are eligible.
   * 3. Records with active PENDING disputes are strictly blocked from finalization.
   * 4. Idempotent and concurrency-safe via database atomic status guards.
   * 5. Never mutates revenue, payout, cost, or profit.
   */
  async processFinalizationBatch(
    referenceTime: Date = new Date(),
    workspaceId?: string,
  ): Promise<FinalizationBatchResult> {
    if (this.isProcessing) {
      this.logger.debug('Finalization batch already in progress, skipping overlap.');
      return { finalizedCount: 0, candidateCount: 0, blockedByDisputeCount: 0 };
    }

    this.isProcessing = true;
    try {
      const now = referenceTime;

      // Find matured PENDING candidates
      const candidates = await this.prisma.callCommercial.findMany({
        where: {
          status: CommercialStatus.PENDING,
          finalizes_at: {
            not: null,
            lte: now,
          },
          ...(workspaceId ? { workspace_id: workspaceId } : {}),
        },
        include: {
          dispute: {
            select: { id: true, status: true },
          },
        },
        take: this.BATCH_SIZE,
        orderBy: { finalizes_at: 'asc' },
      });

      if (candidates.length === 0) {
        return { finalizedCount: 0, candidateCount: 0, blockedByDisputeCount: 0 };
      }

      const eligibleIds: string[] = [];
      let blockedByDisputeCount = 0;

      for (const comm of candidates) {
        // Dispute check: Any active PENDING dispute blocks finalization
        if (comm.dispute && comm.dispute.status === DisputeStatus.PENDING) {
          blockedByDisputeCount++;
          continue;
        }

        eligibleIds.push(comm.id);
      }

      if (eligibleIds.length === 0) {
        return { finalizedCount: 0, candidateCount: candidates.length, blockedByDisputeCount };
      }

      // Concurrency-safe atomic transition:
      // Even if another worker concurrently processes the same ID, status: PENDING
      // ensures that each record transitions only once.
      const updateResult = await this.prisma.callCommercial.updateMany({
        where: {
          id: { in: eligibleIds },
          status: CommercialStatus.PENDING, // concurrency lock
        },
        data: {
          status: CommercialStatus.FINAL,
        },
      });

      this.logger.log(
        `commercial.finalization.completed: Finalized ${updateResult.count} of ${candidates.length} candidates (${blockedByDisputeCount} blocked by dispute).`,
      );

      return {
        finalizedCount: updateResult.count,
        candidateCount: candidates.length,
        blockedByDisputeCount,
      };
    } finally {
      this.isProcessing = false;
    }
  }
}
