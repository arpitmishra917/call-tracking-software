import {
  Injectable,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { ListReconciliationRunsDto } from './dto/reconciliation.dto.js';
import {
  ReconciliationRunType,
  ReconciliationStatus,
  ReconciliationIssueType,
  ExecutionStatus,
  Prisma,
} from '@prisma/client';

export interface AuditIssue {
  issue_type: ReconciliationIssueType;
  description: string;
  call_commercial_id?: string | null;
  expected_amount?: Prisma.Decimal | null;
  actual_amount?: Prisma.Decimal | null;
}

@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Run reconciliation for a specific settlement batch.
   * Produces an immutable ReconciliationRun snapshot and creates ReconciliationIssue records if discrepancies are found.
   */
  async runBatchReconciliation(workspaceId: string, batchId: string) {
    const batch = await this.prisma.settlementBatch.findFirst({
      where: {
        id: batchId,
        workspace_id: workspaceId,
      },
      include: {
        items: true,
        adjustments: true,
        payment_instruction: {
          include: {
            executions: { orderBy: { attempt_number: 'desc' } },
          },
        },
      },
    });

    if (!batch) {
      throw new NotFoundException(`Settlement batch ${batchId} not found in workspace`);
    }

    const issues: AuditIssue[] = [];

    // 1. Audit Item Sum & Adjustments: sum(items) + adjustments == net_amount
    const itemsSum = batch.items.reduce(
      (sum, item) => sum.add(item.amount),
      new Prisma.Decimal(0),
    );
    const calculatedNet = itemsSum.add(batch.adjustments_amount);

    if (!calculatedNet.equals(batch.net_amount)) {
      issues.push({
        issue_type: ReconciliationIssueType.SUM_MISMATCH,
        description: `Batch net amount (${batch.net_amount.toString()}) does not match calculated sum of items and adjustments (${calculatedNet.toString()})`,
        expected_amount: batch.net_amount,
        actual_amount: calculatedNet,
      });
    }

    // 2. Audit Currency Consistency
    for (const item of batch.items) {
      if (item.currency.toUpperCase() !== batch.currency.toUpperCase()) {
        issues.push({
          issue_type: ReconciliationIssueType.CURRENCY_MISMATCH,
          description: `Item currency (${item.currency}) does not match batch currency (${batch.currency})`,
          call_commercial_id: item.call_commercial_id,
          expected_amount: null,
          actual_amount: null,
        });
      }
    }

    if (batch.payment_instruction) {
      if (batch.payment_instruction.currency.toUpperCase() !== batch.currency.toUpperCase()) {
        issues.push({
          issue_type: ReconciliationIssueType.CURRENCY_MISMATCH,
          description: `Payment instruction currency (${batch.payment_instruction.currency}) does not match batch currency (${batch.currency})`,
          expected_amount: null,
          actual_amount: null,
        });
      }

      for (const exec of batch.payment_instruction.executions) {
        if (exec.currency.toUpperCase() !== batch.currency.toUpperCase()) {
          issues.push({
            issue_type: ReconciliationIssueType.CURRENCY_MISMATCH,
            description: `Payment execution currency (${exec.currency}) does not match batch currency (${batch.currency})`,
            expected_amount: null,
            actual_amount: null,
          });
        }
      }
    }

    // 3. Audit Payment Presence
    // For FINALIZED or CLOSED batches, verify that a valid instruction and successful execution exist
    if (batch.settlement_status === 'FINALIZED' || batch.settlement_status === 'CLOSED') {
      const successfulExec = batch.payment_instruction?.executions.find(
        (e) => e.status === ExecutionStatus.SUCCEEDED,
      );

      if (!batch.payment_instruction || !successfulExec) {
        issues.push({
          issue_type: ReconciliationIssueType.MISSING_PAYMENT,
          description: `Settlement batch ${batch.batch_number} is ${batch.settlement_status} but lacks a successful payment execution`,
          expected_amount: batch.net_amount,
          actual_amount: successfulExec ? successfulExec.amount : null,
        });
      }
    }

    // 4. Audit Duplicate Commercial Participation
    // Check intra-batch item duplicates
    const seenCallIds = new Set<string>();
    for (const item of batch.items) {
      if (seenCallIds.has(item.call_commercial_id)) {
        issues.push({
          issue_type: ReconciliationIssueType.DUPLICATE_CALL,
          description: `Duplicate call commercial ID detected in batch: ${item.call_commercial_id}`,
          call_commercial_id: item.call_commercial_id,
        });
      }
      seenCallIds.add(item.call_commercial_id);
    }

    // Check cross-batch duplicates for same participant_type in workspace
    if (batch.items.length > 0) {
      const callCommercialIds = batch.items.map((i) => i.call_commercial_id);
      const duplicateOtherItems = await this.prisma.settlementItem.findMany({
        where: {
          workspace_id: workspaceId,
          participant_type: batch.participant_type,
          settlement_batch_id: { not: batch.id },
          call_commercial_id: { in: callCommercialIds },
        },
      });

      for (const dup of duplicateOtherItems) {
        issues.push({
          issue_type: ReconciliationIssueType.DUPLICATE_CALL,
          description: `Call commercial ID ${dup.call_commercial_id} is already settled in batch ${dup.settlement_batch_id}`,
          call_commercial_id: dup.call_commercial_id,
        });
      }
    }

    const status =
      issues.length === 0
        ? ReconciliationStatus.RECONCILED
        : ReconciliationStatus.DISCREPANCY;

    // Create immutable ReconciliationRun snapshot and update batch status
    return await this.prisma.$transaction(async (tx) => {
      const run = await tx.reconciliationRun.create({
        data: {
          workspace_id: workspaceId,
          run_type: ReconciliationRunType.BATCH_LEVEL,
          settlement_batch_id: batch.id,
          status,
          items_checked: batch.items.length,
          discrepancy_count: issues.length,
          issues: {
            create: issues.map((iss) => ({
              issue_type: iss.issue_type,
              description: iss.description,
              call_commercial_id: iss.call_commercial_id || null,
              expected_amount: iss.expected_amount || null,
              actual_amount: iss.actual_amount || null,
            })),
          },
        },
        include: {
          issues: true,
          batch: true,
        },
      });

      await tx.settlementBatch.update({
        where: { id: batch.id },
        data: {
          reconciliation_status: status,
        },
      });

      return run;
    });
  }

  /**
   * Run workspace-level reconciliation across all settlement batches in workspace.
   */
  async runWorkspaceReconciliation(workspaceId: string) {
    const batches = await this.prisma.settlementBatch.findMany({
      where: { workspace_id: workspaceId },
      include: {
        items: true,
        adjustments: true,
        payment_instruction: {
          include: {
            executions: { orderBy: { attempt_number: 'desc' } },
          },
        },
      },
    });

    const allIssues: AuditIssue[] = [];
    let totalItemsChecked = 0;
    const batchIssueMap = new Map<string, number>();

    // Global duplicate detection across workspace
    const globalCallMap = new Map<string, string>(); // `${call_commercial_id}_${participant_type}` -> batch_id

    for (const batch of batches) {
      let batchIssuesCount = 0;
      totalItemsChecked += batch.items.length;

      // 1. Sum check
      const itemsSum = batch.items.reduce(
        (sum, item) => sum.add(item.amount),
        new Prisma.Decimal(0),
      );
      const calculatedNet = itemsSum.add(batch.adjustments_amount);

      if (!calculatedNet.equals(batch.net_amount)) {
        allIssues.push({
          issue_type: ReconciliationIssueType.SUM_MISMATCH,
          description: `Batch ${batch.batch_number}: net amount (${batch.net_amount}) does not match sum (${calculatedNet})`,
          expected_amount: batch.net_amount,
          actual_amount: calculatedNet,
        });
        batchIssuesCount++;
      }

      // 2. Currency check
      for (const item of batch.items) {
        if (item.currency.toUpperCase() !== batch.currency.toUpperCase()) {
          allIssues.push({
            issue_type: ReconciliationIssueType.CURRENCY_MISMATCH,
            description: `Batch ${batch.batch_number}: item currency (${item.currency}) mismatch with batch (${batch.currency})`,
            call_commercial_id: item.call_commercial_id,
          });
          batchIssuesCount++;
        }
      }

      if (batch.payment_instruction) {
        if (batch.payment_instruction.currency.toUpperCase() !== batch.currency.toUpperCase()) {
          allIssues.push({
            issue_type: ReconciliationIssueType.CURRENCY_MISMATCH,
            description: `Batch ${batch.batch_number}: payment instruction currency mismatch`,
          });
          batchIssuesCount++;
        }
        for (const exec of batch.payment_instruction.executions) {
          if (exec.currency.toUpperCase() !== batch.currency.toUpperCase()) {
            allIssues.push({
              issue_type: ReconciliationIssueType.CURRENCY_MISMATCH,
              description: `Batch ${batch.batch_number}: payment execution currency mismatch`,
            });
            batchIssuesCount++;
          }
        }
      }

      // 3. Payment check
      if (batch.settlement_status === 'FINALIZED' || batch.settlement_status === 'CLOSED') {
        const successfulExec = batch.payment_instruction?.executions.find(
          (e) => e.status === ExecutionStatus.SUCCEEDED,
        );
        if (!batch.payment_instruction || !successfulExec) {
          allIssues.push({
            issue_type: ReconciliationIssueType.MISSING_PAYMENT,
            description: `Batch ${batch.batch_number} is ${batch.settlement_status} but lacks successful payment execution`,
            expected_amount: batch.net_amount,
            actual_amount: successfulExec ? successfulExec.amount : null,
          });
          batchIssuesCount++;
        }
      }

      // 4. Duplicate check
      for (const item of batch.items) {
        const key = `${item.call_commercial_id}_${item.participant_type}`;
        if (globalCallMap.has(key)) {
          allIssues.push({
            issue_type: ReconciliationIssueType.DUPLICATE_CALL,
            description: `Duplicate commercial participation for call ${item.call_commercial_id} across batches ${globalCallMap.get(key)} and ${batch.id}`,
            call_commercial_id: item.call_commercial_id,
          });
          batchIssuesCount++;
        } else {
          globalCallMap.set(key, batch.id);
        }
      }

      batchIssueMap.set(batch.id, batchIssuesCount);
    }

    const overallStatus =
      allIssues.length === 0
        ? ReconciliationStatus.RECONCILED
        : ReconciliationStatus.DISCREPANCY;

    return await this.prisma.$transaction(async (tx) => {
      const run = await tx.reconciliationRun.create({
        data: {
          workspace_id: workspaceId,
          run_type: ReconciliationRunType.WORKSPACE_LEVEL,
          settlement_batch_id: null,
          status: overallStatus,
          items_checked: totalItemsChecked,
          discrepancy_count: allIssues.length,
          issues: {
            create: allIssues.map((iss) => ({
              issue_type: iss.issue_type,
              description: iss.description,
              call_commercial_id: iss.call_commercial_id || null,
              expected_amount: iss.expected_amount || null,
              actual_amount: iss.actual_amount || null,
            })),
          },
        },
        include: {
          issues: true,
        },
      });

      // Update reconciliation_status on each batch individually
      for (const batch of batches) {
        const issuesForBatch = batchIssueMap.get(batch.id) ?? 0;
        await tx.settlementBatch.update({
          where: { id: batch.id },
          data: {
            reconciliation_status:
              issuesForBatch === 0
                ? ReconciliationStatus.RECONCILED
                : ReconciliationStatus.DISCREPANCY,
          },
        });
      }

      return run;
    });
  }

  /**
   * List reconciliation runs for workspace with filtering and pagination.
   */
  async listReconciliationRuns(workspaceId: string, filters: ListReconciliationRunsDto) {
    const where: Prisma.ReconciliationRunWhereInput = {
      workspace_id: workspaceId,
      ...(filters.batch_id ? { settlement_batch_id: filters.batch_id } : {}),
      ...(filters.run_type ? { run_type: filters.run_type } : {}),
      ...(filters.status ? { status: filters.status } : {}),
    };

    const take = filters.limit ? Number(filters.limit) : 50;
    const skip = filters.offset ? Number(filters.offset) : 0;

    const [items, total] = await Promise.all([
      this.prisma.reconciliationRun.findMany({
        where,
        take,
        skip,
        orderBy: { created_at: 'desc' },
        include: {
          batch: true,
          _count: { select: { issues: true } },
        },
      }),
      this.prisma.reconciliationRun.count({ where }),
    ]);

    return {
      items,
      total,
      limit: take,
      offset: skip,
    };
  }

  /**
   * Get single reconciliation run with its issues and batch details.
   */
  async getReconciliationRun(workspaceId: string, runId: string) {
    const run = await this.prisma.reconciliationRun.findFirst({
      where: {
        id: runId,
        workspace_id: workspaceId,
      },
      include: {
        issues: { orderBy: { created_at: 'asc' } },
        batch: true,
      },
    });

    if (!run) {
      throw new NotFoundException(`Reconciliation run ${runId} not found`);
    }

    return run;
  }

  /**
   * Get issues for a reconciliation run.
   */
  async getReconciliationRunIssues(workspaceId: string, runId: string) {
    const run = await this.prisma.reconciliationRun.findFirst({
      where: {
        id: runId,
        workspace_id: workspaceId,
      },
    });

    if (!run) {
      throw new NotFoundException(`Reconciliation run ${runId} not found`);
    }

    const issues = await this.prisma.reconciliationIssue.findMany({
      where: {
        reconciliation_run_id: runId,
      },
      orderBy: { created_at: 'asc' },
    });

    return {
      run_id: runId,
      issues,
    };
  }
}
