import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import {
  Prisma,
  SettlementParticipantType,
  SettlementStatus,
  PaymentStatus,
  ReconciliationStatus,
  CommercialStatus,
  DisputeStatus,
  AdjustmentDirection,
  AdjustmentStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

export interface GenerateSettlementOptions {
  workspace_id: string;
  period_start: Date;
  period_end: Date;
  buyer_id?: string;
  vendor_id?: string;
  created_by_user_id?: string;
}

export interface GeneratedBatchResult {
  batch_id: string;
  batch_number: string;
  workspace_id: string;
  participant_type: SettlementParticipantType;
  buyer_id: string | null;
  vendor_id: string | null;
  currency: string;
  period_start: Date;
  period_end: Date;
  gross_amount: string;
  adjustments_amount: string;
  net_amount: string;
  item_count: number;
  settlement_status: SettlementStatus;
  payment_status: PaymentStatus;
  reconciliation_status: ReconciliationStatus;
  is_existing: boolean;
}

export interface SettlementGenerationSummary {
  workspace_id: string;
  period_start: Date;
  period_end: Date;
  participant_type: SettlementParticipantType;
  batches: GeneratedBatchResult[];
  skipped_calls_count: number;
}

async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries = 5,
  initialDelayMs = 25,
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await operation();
    } catch (err: any) {
      attempt++;
      const isRetryable =
        err?.code === 'P2034' || // Transaction failed due to a write conflict or a deadlock
        err?.code === 'P2002' || // Unique constraint violation (e.g. concurrent batch or item creation)
        err?.code === '40001' || // serialization_failure
        err?.code === '40P01' || // deadlock_detected
        (typeof err?.message === 'string' &&
          (err.message.includes('write conflict') ||
            err.message.includes('deadlock') ||
            err.message.includes('could not serialize access')));

      if (attempt >= maxRetries || !isRetryable) {
        throw err;
      }
      const delay = initialDelayMs * Math.pow(2, attempt - 1) + Math.random() * 20;
      await new Promise((res) => setTimeout(res, delay));
    }
  }
}

@Injectable()
export class SettlementBatchService {
  private readonly logger = new Logger(SettlementBatchService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Generates deterministic human-readable batch numbers:
   * Format: SB-<TYPE>-<PARTICIPANT_ID_PREFIX>-<CURRENCY>-<YYYYMMDD_START>-<YYYYMMDD_END>
   */
  private generateBatchNumber(
    type: SettlementParticipantType,
    participantId: string,
    currency: string,
    periodStart: Date,
    periodEnd: Date,
  ): string {
    const pStartStr = periodStart.toISOString().slice(0, 10).replace(/-/g, '');
    const pEndStr = periodEnd.toISOString().slice(0, 10).replace(/-/g, '');
    const partPrefix = participantId.slice(0, 8);
    return `SB-${type}-${partPrefix}-${currency}-${pStartStr}-${pEndStr}`;
  }

  /**
   * AD-02 Secondary Guard: JIT Finalization Sweep
   * Atomically transitions matured, undisputed PENDING CallCommercial records to FINAL
   * immediately before querying settlement candidates.
   */
  public async sweepMaturedPendingToFinal(
    prismaClient: PrismaService | Prisma.TransactionClient,
    workspace_id: string,
    now: Date = new Date(),
  ): Promise<number> {
    const executeSweep = async (tx: Prisma.TransactionClient) => {
      // Find matured PENDING records in this workspace
      const pendingCandidates = await tx.callCommercial.findMany({
        where: {
          workspace_id,
          status: CommercialStatus.PENDING,
          finalizes_at: {
            not: null,
            lte: now,
          },
        },
        select: {
          id: true,
          dispute: {
            select: { status: true },
          },
        },
      });

      if (pendingCandidates.length === 0) {
        return 0;
      }

      // Filter out records with active PENDING disputes
      const eligibleIds = pendingCandidates
        .filter((c) => !c.dispute || c.dispute.status !== DisputeStatus.PENDING)
        .map((c) => c.id);

      if (eligibleIds.length === 0) {
        return 0;
      }

      // Atomically transition PENDING -> FINAL
      // status: PENDING in where predicate ensures concurrency safety
      const result = await tx.callCommercial.updateMany({
        where: {
          id: { in: eligibleIds },
          status: CommercialStatus.PENDING,
        },
        data: {
          status: CommercialStatus.FINAL,
        },
      });

      if (result.count > 0) {
        this.logger.log(
          `JIT finalization sweep: transitioned ${result.count} matured CallCommercial record(s) to FINAL in workspace ${workspace_id}`,
        );
      }

      return result.count;
    };

    if ('$transaction' in prismaClient) {
      return await (prismaClient as PrismaService).$transaction(executeSweep);
    } else {
      return await executeSweep(prismaClient as Prisma.TransactionClient);
    }
  }

  /**
   * Evaluates settlement eligibility and generates Buyer Settlement Batches.
   * Partitions by (buyer_id, currency) for eligible calls within [period_start, period_end).
   */
  async generateBuyerSettlement(
    options: GenerateSettlementOptions,
  ): Promise<SettlementGenerationSummary> {
    const { workspace_id, period_start, period_end, buyer_id, created_by_user_id } = options;

    if (!period_start || !period_end) {
      throw new BadRequestException('period_start and period_end are required');
    }
    if (period_start >= period_end) {
      throw new BadRequestException('period_start must be strictly before period_end');
    }

    // Verify workspace exists
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspace_id },
    });
    if (!workspace) {
      throw new NotFoundException(`Workspace ${workspace_id} not found`);
    }

    // If specific buyer requested, verify existence and workspace ownership
    if (buyer_id) {
      const buyer = await this.prisma.buyer.findFirst({
        where: { id: buyer_id, workspace_id },
      });
      if (!buyer) {
        throw new NotFoundException(
          `Buyer ${buyer_id} not found in workspace ${workspace_id}`,
        );
      }
    }

    const now = new Date();

    // 1. Identify any existing batches already generated for this period & buyer
    const existingBatches = await this.prisma.settlementBatch.findMany({
      where: {
        workspace_id,
        participant_type: SettlementParticipantType.BUYER,
        period_start,
        period_end,
        ...(buyer_id ? { buyer_id } : {}),
      },
    });

    const partitions = new Map<
      string,
      {
        participantId: string;
        currency: string;
        newItems: any[];
      }
    >();

    for (const eb of existingBatches) {
      if (eb.buyer_id && eb.currency) {
        const key = `${eb.buyer_id}::${eb.currency.toUpperCase()}`;
        partitions.set(key, {
          participantId: eb.buyer_id,
          currency: eb.currency.toUpperCase(),
          newItems: [],
        });
      }
    }

    // 2. JIT finalization sweep (AD-02 secondary guard):
    // Atomically transition matured, undisputed PENDING records in this workspace to FINAL
    await this.sweepMaturedPendingToFinal(this.prisma, workspace_id, now);

    // Query commercially finalized records matching criteria
    // Period condition: period_start <= finalizes_at < period_end
    // Maturity condition: finalizes_at <= NOW()
    const candidates = await this.prisma.callCommercial.findMany({
      where: {
        workspace_id,
        status: CommercialStatus.FINAL,
        finalizes_at: {
          not: null,
          gte: period_start,
          lt: period_end,
          lte: now,
        },
        revenue: {
          gt: 0,
        },
        ...(buyer_id ? { buyer_id } : {}),
      },
      include: {
        dispute: true,
        settlement_items: {
          where: {
            participant_type: SettlementParticipantType.BUYER,
          },
        },
      },
      orderBy: {
        finalizes_at: 'asc',
      },
    });

    let skippedCallsCount = 0;

    for (const comm of candidates) {
      // Missing buyer check
      if (!comm.buyer_id) {
        this.logger.warn(
          `Skipping Buyer settlement for CallCommercial ${comm.id}: buyer_id is null`,
        );
        skippedCallsCount++;
        continue;
      }

      // Pending dispute check
      if (comm.dispute && comm.dispute.status === DisputeStatus.PENDING) {
        this.logger.debug(
          `Skipping Buyer settlement for CallCommercial ${comm.id}: active PENDING dispute`,
        );
        skippedCallsCount++;
        continue;
      }

      // Currency check
      if (!comm.currency) {
        this.logger.warn(
          `Skipping CallCommercial ${comm.id}: missing currency snapshot`,
        );
        skippedCallsCount++;
        continue;
      }

      const partitionKey = `${comm.buyer_id}::${comm.currency.toUpperCase()}`;

      // If already settled on BUYER side, do not re-add to newItems, but preserve partition
      if (comm.settlement_items.length > 0) {
        if (!partitions.has(partitionKey)) {
          partitions.set(partitionKey, {
            participantId: comm.buyer_id,
            currency: comm.currency.toUpperCase(),
            newItems: [],
          });
        }
        continue;
      }

      // Eligible new item
      if (!partitions.has(partitionKey)) {
        partitions.set(partitionKey, {
          participantId: comm.buyer_id,
          currency: comm.currency.toUpperCase(),
          newItems: [],
        });
      }
      partitions.get(partitionKey)!.newItems.push(comm);
    }

    const createdBatches: GeneratedBatchResult[] = [];

    // Process each partition atomically with concurrency retry
    for (const [, partition] of partitions.entries()) {
      const { participantId, currency: currentCurrency, newItems } = partition;
      const batchNumber = this.generateBatchNumber(
        SettlementParticipantType.BUYER,
        participantId,
        currentCurrency,
        period_start,
        period_end,
      );

      const batchResult = await withRetry(async () => {
        return await this.prisma.$transaction(
          async (tx) => {
            let batch = await tx.settlementBatch.findUnique({
              where: {
                workspace_id_batch_number: {
                  workspace_id,
                  batch_number: batchNumber,
                },
              },
            });

            let isExisting = false;

            if (!batch) {
              // If there are no items to insert and batch does not exist, do not create an empty batch
              if (newItems.length === 0) {
                return null;
              }

              batch = await tx.settlementBatch.create({
                data: {
                  workspace_id,
                  batch_number: batchNumber,
                  participant_type: SettlementParticipantType.BUYER,
                  buyer_id: participantId,
                  currency: currentCurrency,
                  period_start,
                  period_end,
                  gross_amount: new Prisma.Decimal('0.0000'),
                  adjustments_amount: new Prisma.Decimal('0.0000'),
                  net_amount: new Prisma.Decimal('0.0000'),
                  item_count: 0,
                  settlement_status: SettlementStatus.DRAFT,
                  payment_status: PaymentStatus.UNPROCESSED,
                  reconciliation_status: ReconciliationStatus.UNRECONCILED,
                  created_by_user_id: created_by_user_id ?? 'system',
                },
              });
            } else {
              isExisting = true;
            }

            if (newItems.length > 0) {
              const itemsToCreate = newItems.map((comm) => ({
                workspace_id,
                settlement_batch_id: batch!.id,
                call_commercial_id: comm.id,
                participant_type: SettlementParticipantType.BUYER,
                amount: comm.revenue,
                currency: currentCurrency,
              }));

              await tx.settlementItem.createMany({
                data: itemsToCreate,
                skipDuplicates: true,
              });

              const aggregate = await tx.settlementItem.aggregate({
                where: {
                  settlement_batch_id: batch!.id,
                },
                _sum: {
                  amount: true,
                },
                _count: {
                  id: true,
                },
              });

              const gross = aggregate._sum.amount ?? new Prisma.Decimal('0.0000');
              const count = aggregate._count.id;

              // Pull and apply pending SettlementAdjustments for this Buyer and currency
              let totalAdjustments = new Prisma.Decimal('0.0000');
              if (tx.settlementAdjustment) {
                const pendingAdjustments = await tx.settlementAdjustment.findMany({
                  where: {
                    workspace_id,
                    participant_type: SettlementParticipantType.BUYER,
                    buyer_id: participantId,
                    currency: currentCurrency,
                    status: AdjustmentStatus.PENDING,
                    target_settlement_batch_id: null,
                  },
                });

                if (pendingAdjustments.length > 0) {
                  const adjIds = pendingAdjustments.map((a: any) => a.id);
                  await tx.settlementAdjustment.updateMany({
                    where: { id: { in: adjIds } },
                    data: {
                      target_settlement_batch_id: batch!.id,
                      status: AdjustmentStatus.APPLIED,
                      applied_at: new Date(),
                    },
                  });
                }

                const batchAdjustments = await tx.settlementAdjustment.findMany({
                  where: {
                    target_settlement_batch_id: batch!.id,
                    workspace_id,
                  },
                });

                for (const adj of batchAdjustments) {
                  // Buyer CREDIT reduces invoice amount (negative offset)
                  if (adj.direction === AdjustmentDirection.CREDIT) {
                    totalAdjustments = totalAdjustments.sub(adj.amount);
                  } else {
                    totalAdjustments = totalAdjustments.add(adj.amount);
                  }
                }
              }

              const net = gross.add(totalAdjustments);

              batch = await tx.settlementBatch.update({
                where: { id: batch!.id, workspace_id },
                data: {
                  gross_amount: gross,
                  adjustments_amount: totalAdjustments,
                  net_amount: net,
                  item_count: count,
                },
              });
            }

            return {
              batch_id: batch!.id,
              batch_number: batch!.batch_number,
              workspace_id: batch!.workspace_id,
              participant_type: batch!.participant_type,
              buyer_id: batch!.buyer_id,
              vendor_id: batch!.vendor_id,
              currency: batch!.currency,
              period_start: batch!.period_start,
              period_end: batch!.period_end,
              gross_amount: batch!.gross_amount.toString(),
              adjustments_amount: batch!.adjustments_amount.toString(),
              net_amount: batch!.net_amount.toString(),
              item_count: batch!.item_count,
              settlement_status: batch!.settlement_status,
              payment_status: batch!.payment_status,
              reconciliation_status: batch!.reconciliation_status,
              is_existing: isExisting,
            };
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          },
        );
      });

      if (batchResult && batchResult.item_count > 0) {
        createdBatches.push(batchResult);
      }
    }

    return {
      workspace_id,
      period_start,
      period_end,
      participant_type: SettlementParticipantType.BUYER,
      batches: createdBatches,
      skipped_calls_count: skippedCallsCount,
    };
  }

  /**
   * Evaluates settlement eligibility and generates Vendor Settlement Batches.
   * Partitions by (vendor_id, currency) for eligible calls within [period_start, period_end).
   */
  async generateVendorSettlement(
    options: GenerateSettlementOptions,
  ): Promise<SettlementGenerationSummary> {
    const { workspace_id, period_start, period_end, vendor_id, created_by_user_id } = options;

    if (!period_start || !period_end) {
      throw new BadRequestException('period_start and period_end are required');
    }
    if (period_start >= period_end) {
      throw new BadRequestException('period_start must be strictly before period_end');
    }

    // Verify workspace exists
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspace_id },
    });
    if (!workspace) {
      throw new NotFoundException(`Workspace ${workspace_id} not found`);
    }

    // If specific vendor requested, verify existence and workspace ownership
    if (vendor_id) {
      const vendor = await this.prisma.vendor.findFirst({
        where: { id: vendor_id, workspace_id },
      });
      if (!vendor) {
        throw new NotFoundException(
          `Vendor ${vendor_id} not found in workspace ${workspace_id}`,
        );
      }
    }

    const now = new Date();

    // 1. Identify any existing batches already generated for this period & vendor
    const existingBatches = await this.prisma.settlementBatch.findMany({
      where: {
        workspace_id,
        participant_type: SettlementParticipantType.VENDOR,
        period_start,
        period_end,
        ...(vendor_id ? { vendor_id } : {}),
      },
    });

    const partitions = new Map<
      string,
      {
        participantId: string;
        currency: string;
        newItems: any[];
      }
    >();

    for (const eb of existingBatches) {
      if (eb.vendor_id && eb.currency) {
        const key = `${eb.vendor_id}::${eb.currency.toUpperCase()}`;
        partitions.set(key, {
          participantId: eb.vendor_id,
          currency: eb.currency.toUpperCase(),
          newItems: [],
        });
      }
    }

    // 2. JIT finalization sweep (AD-02 secondary guard):
    // Atomically transition matured, undisputed PENDING records in this workspace to FINAL
    await this.sweepMaturedPendingToFinal(this.prisma, workspace_id, now);

    // Query commercially finalized records matching criteria
    // Period condition: period_start <= finalizes_at < period_end
    // Maturity condition: finalizes_at <= NOW()
    const candidates = await this.prisma.callCommercial.findMany({
      where: {
        workspace_id,
        status: CommercialStatus.FINAL,
        finalizes_at: {
          not: null,
          gte: period_start,
          lt: period_end,
          lte: now,
        },
        payout: {
          gt: 0,
        },
        ...(vendor_id ? { vendor_id } : {}),
      },
      include: {
        dispute: true,
        settlement_items: {
          where: {
            participant_type: SettlementParticipantType.VENDOR,
          },
        },
      },
      orderBy: {
        finalizes_at: 'asc',
      },
    });

    let skippedCallsCount = 0;

    for (const comm of candidates) {
      // Missing vendor check
      if (!comm.vendor_id) {
        this.logger.warn(
          `Skipping Vendor settlement for CallCommercial ${comm.id}: vendor_id is null`,
        );
        skippedCallsCount++;
        continue;
      }

      // Pending dispute check
      if (comm.dispute && comm.dispute.status === DisputeStatus.PENDING) {
        this.logger.debug(
          `Skipping Vendor settlement for CallCommercial ${comm.id}: active PENDING dispute`,
        );
        skippedCallsCount++;
        continue;
      }

      // Currency check
      if (!comm.currency) {
        this.logger.warn(
          `Skipping CallCommercial ${comm.id}: missing currency snapshot`,
        );
        skippedCallsCount++;
        continue;
      }

      const partitionKey = `${comm.vendor_id}::${comm.currency.toUpperCase()}`;

      // If already settled on VENDOR side, do not re-add to newItems, but preserve partition
      if (comm.settlement_items.length > 0) {
        if (!partitions.has(partitionKey)) {
          partitions.set(partitionKey, {
            participantId: comm.vendor_id,
            currency: comm.currency.toUpperCase(),
            newItems: [],
          });
        }
        continue;
      }

      // Eligible new item
      if (!partitions.has(partitionKey)) {
        partitions.set(partitionKey, {
          participantId: comm.vendor_id,
          currency: comm.currency.toUpperCase(),
          newItems: [],
        });
      }
      partitions.get(partitionKey)!.newItems.push(comm);
    }

    const createdBatches: GeneratedBatchResult[] = [];

    // Process each partition atomically with concurrency retry
    for (const [, partition] of partitions.entries()) {
      const { participantId, currency: currentCurrency, newItems } = partition;
      const batchNumber = this.generateBatchNumber(
        SettlementParticipantType.VENDOR,
        participantId,
        currentCurrency,
        period_start,
        period_end,
      );

      const batchResult = await withRetry(async () => {
        return await this.prisma.$transaction(
          async (tx) => {
            let batch = await tx.settlementBatch.findUnique({
              where: {
                workspace_id_batch_number: {
                  workspace_id,
                  batch_number: batchNumber,
                },
              },
            });

            let isExisting = false;

            if (!batch) {
              // If there are no items to insert and batch does not exist, do not create an empty batch
              if (newItems.length === 0) {
                return null;
              }

              batch = await tx.settlementBatch.create({
                data: {
                  workspace_id,
                  batch_number: batchNumber,
                  participant_type: SettlementParticipantType.VENDOR,
                  vendor_id: participantId,
                  currency: currentCurrency,
                  period_start,
                  period_end,
                  gross_amount: new Prisma.Decimal('0.0000'),
                  adjustments_amount: new Prisma.Decimal('0.0000'),
                  net_amount: new Prisma.Decimal('0.0000'),
                  item_count: 0,
                  settlement_status: SettlementStatus.DRAFT,
                  payment_status: PaymentStatus.UNPROCESSED,
                  reconciliation_status: ReconciliationStatus.UNRECONCILED,
                  created_by_user_id: created_by_user_id ?? 'system',
                },
              });
            } else {
              isExisting = true;
            }

            if (newItems.length > 0) {
              const itemsToCreate = newItems.map((comm) => ({
                workspace_id,
                settlement_batch_id: batch!.id,
                call_commercial_id: comm.id,
                participant_type: SettlementParticipantType.VENDOR,
                amount: comm.payout,
                currency: currentCurrency,
              }));

              await tx.settlementItem.createMany({
                data: itemsToCreate,
                skipDuplicates: true,
              });

              const aggregate = await tx.settlementItem.aggregate({
                where: {
                  settlement_batch_id: batch!.id,
                },
                _sum: {
                  amount: true,
                },
                _count: {
                  id: true,
                },
              });

              const gross = aggregate._sum.amount ?? new Prisma.Decimal('0.0000');
              const count = aggregate._count.id;

              // Pull and apply pending SettlementAdjustments for this Vendor and currency
              let totalAdjustments = new Prisma.Decimal('0.0000');
              if (tx.settlementAdjustment) {
                const pendingAdjustments = await tx.settlementAdjustment.findMany({
                  where: {
                    workspace_id,
                    participant_type: SettlementParticipantType.VENDOR,
                    vendor_id: participantId,
                    currency: currentCurrency,
                    status: AdjustmentStatus.PENDING,
                    target_settlement_batch_id: null,
                  },
                });

                if (pendingAdjustments.length > 0) {
                  const adjIds = pendingAdjustments.map((a: any) => a.id);
                  await tx.settlementAdjustment.updateMany({
                    where: { id: { in: adjIds } },
                    data: {
                      target_settlement_batch_id: batch!.id,
                      status: AdjustmentStatus.APPLIED,
                      applied_at: new Date(),
                    },
                  });
                }

                const batchAdjustments = await tx.settlementAdjustment.findMany({
                  where: {
                    target_settlement_batch_id: batch!.id,
                    workspace_id,
                  },
                });

                for (const adj of batchAdjustments) {
                  // Vendor CLAWBACK reduces payout amount (negative offset)
                  if (adj.direction === AdjustmentDirection.CLAWBACK) {
                    totalAdjustments = totalAdjustments.sub(adj.amount);
                  } else {
                    totalAdjustments = totalAdjustments.add(adj.amount);
                  }
                }
              }

              const net = gross.add(totalAdjustments);

              batch = await tx.settlementBatch.update({
                where: { id: batch!.id, workspace_id },
                data: {
                  gross_amount: gross,
                  adjustments_amount: totalAdjustments,
                  net_amount: net,
                  item_count: count,
                },
              });
            }

            return {
              batch_id: batch!.id,
              batch_number: batch!.batch_number,
              workspace_id: batch!.workspace_id,
              participant_type: batch!.participant_type,
              buyer_id: batch!.buyer_id,
              vendor_id: batch!.vendor_id,
              currency: batch!.currency,
              period_start: batch!.period_start,
              period_end: batch!.period_end,
              gross_amount: batch!.gross_amount.toString(),
              adjustments_amount: batch!.adjustments_amount.toString(),
              net_amount: batch!.net_amount.toString(),
              item_count: batch!.item_count,
              settlement_status: batch!.settlement_status,
              payment_status: batch!.payment_status,
              reconciliation_status: batch!.reconciliation_status,
              is_existing: isExisting,
            };
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          },
        );
      });

      if (batchResult && batchResult.item_count > 0) {
        createdBatches.push(batchResult);
      }
    }

    return {
      workspace_id,
      period_start,
      period_end,
      participant_type: SettlementParticipantType.VENDOR,
      batches: createdBatches,
      skipped_calls_count: skippedCallsCount,
    };
  }

  /**
   * Retrieves a paginated list of settlement batches for a workspace with optional filters.
   */
  async getBatches(
    workspaceId: string,
    filters?: {
      participant_type?: SettlementParticipantType;
      buyer_id?: string;
      vendor_id?: string;
      settlement_status?: SettlementStatus;
      payment_status?: PaymentStatus;
      reconciliation_status?: ReconciliationStatus;
      period_start?: Date;
      period_end?: Date;
      limit?: number;
      offset?: number;
    },
  ) {
    const where: Prisma.SettlementBatchWhereInput = {
      workspace_id: workspaceId,
    };

    if (filters?.participant_type) {
      where.participant_type = filters.participant_type;
    }
    if (filters?.buyer_id) {
      where.buyer_id = filters.buyer_id;
    }
    if (filters?.vendor_id) {
      where.vendor_id = filters.vendor_id;
    }
    if (filters?.settlement_status) {
      where.settlement_status = filters.settlement_status;
    }
    if (filters?.payment_status) {
      where.payment_status = filters.payment_status;
    }
    if (filters?.reconciliation_status) {
      where.reconciliation_status = filters.reconciliation_status;
    }
    if (filters?.period_start) {
      where.period_start = { gte: filters.period_start };
    }
    if (filters?.period_end) {
      where.period_end = { lte: filters.period_end };
    }

    const limit = Math.min(Math.max(filters?.limit ?? 50, 1), 100);
    const offset = Math.max(filters?.offset ?? 0, 0);

    const [batches, total] = await Promise.all([
      this.prisma.settlementBatch.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: offset,
        take: limit,
      }),
      this.prisma.settlementBatch.count({ where }),
    ]);

    return { batches, total, limit, offset };
  }

  /**
   * Retrieves a settlement batch by ID scoped strictly to workspace.
   */
  async getBatchById(workspaceId: string, batchId: string) {
    return this.prisma.settlementBatch.findFirst({
      where: {
        id: batchId,
        workspace_id: workspaceId,
      },
    });
  }

  /**
   * Retrieves line items for a settlement batch scoped to workspace with pagination.
   */
  async getBatchItems(
    workspaceId: string,
    batchId: string,
    options?: { limit?: number; offset?: number },
  ) {
    const limit = Math.min(Math.max(options?.limit ?? 50, 1), 100);
    const offset = Math.max(options?.offset ?? 0, 0);

    const [items, total] = await Promise.all([
      this.prisma.settlementItem.findMany({
        where: {
          settlement_batch_id: batchId,
          workspace_id: workspaceId,
        },
        include: {
          commercial: true,
        },
        orderBy: { created_at: 'asc' },
        skip: offset,
        take: limit,
      }),
      this.prisma.settlementItem.count({
        where: {
          settlement_batch_id: batchId,
          workspace_id: workspaceId,
        },
      }),
    ]);

    return { items, total, limit, offset };
  }
}
