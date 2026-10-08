import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  CreatePaymentExecutionDto,
  RetryPaymentExecutionDto,
  ListPaymentInstructionsDto,
} from './dto/payment.dto.js';
import {
  SettlementStatus,
  PaymentStatus,
  InstructionStatus,
  ExecutionStatus,
  PaymentDirection,
  SettlementParticipantType,
  Prisma,
} from '@prisma/client';

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Creates a deterministic PaymentInstruction from a FINALIZED SettlementBatch.
   * Enforces idempotency via batch-unique constraint and deterministic idempotency key.
   */
  async createPaymentInstruction(workspaceId: string, batchId: string) {
    const batch = await this.prisma.settlementBatch.findFirst({
      where: {
        id: batchId,
        workspace_id: workspaceId,
      },
    });

    if (!batch) {
      throw new NotFoundException(`Settlement batch ${batchId} not found in workspace`);
    }

    // Check if an instruction already exists for this batch (Idempotency)
    const existing = await this.prisma.paymentInstruction.findUnique({
      where: {
        settlement_batch_id: batch.id,
      },
      include: {
        executions: { orderBy: { attempt_number: 'asc' } },
      },
    });

    if (existing) {
      return existing;
    }

    // Validate batch status prerequisites
    if (batch.settlement_status !== SettlementStatus.FINALIZED) {
      throw new BadRequestException(
        `Settlement batch must be FINALIZED to create payment instruction (current status: ${batch.settlement_status})`,
      );
    }

    if (batch.payment_status !== PaymentStatus.UNPROCESSED) {
      throw new BadRequestException(
        `Batch payment status must be UNPROCESSED to create payment instruction (current status: ${batch.payment_status})`,
      );
    }

    const netAmountNum = Number(batch.net_amount);
    if (isNaN(netAmountNum) || netAmountNum <= 0) {
      throw new BadRequestException('Settlement batch net amount must be greater than zero');
    }

    if (!batch.currency) {
      throw new BadRequestException('Settlement batch currency is required');
    }

    // Determine direction and participant reference
    let direction: PaymentDirection;
    let buyerId: string | null = null;
    let vendorId: string | null = null;

    if (batch.participant_type === SettlementParticipantType.BUYER) {
      direction = PaymentDirection.COLLECTION;
      buyerId = batch.buyer_id;
      vendorId = null;
    } else if (batch.participant_type === SettlementParticipantType.VENDOR) {
      direction = PaymentDirection.DISBURSEMENT;
      buyerId = null;
      vendorId = batch.vendor_id;
    } else {
      throw new BadRequestException(`Unsupported participant type: ${batch.participant_type}`);
    }

    const idempotencyKey = `pi_${workspaceId}_${batch.id}`;

    try {
      return await this.prisma.$transaction(async (tx) => {
        const instruction = await tx.paymentInstruction.create({
          data: {
            workspace_id: workspaceId,
            settlement_batch_id: batch.id,
            direction,
            participant_type: batch.participant_type,
            buyer_id: buyerId,
            vendor_id: vendorId,
            amount: batch.net_amount,
            currency: batch.currency,
            idempotency_key: idempotencyKey,
            status: InstructionStatus.CREATED,
          },
          include: {
            executions: true,
          },
        });

        // Batch payment_status: UNPROCESSED -> PENDING (settlement_status remains FINALIZED)
        await tx.settlementBatch.update({
          where: { id: batch.id },
          data: {
            payment_status: PaymentStatus.PENDING,
          },
        });

        return instruction;
      });
    } catch (err: any) {
      // Handle concurrent creation race condition
      if (err?.code === 'P2002') {
        const raced = await this.prisma.paymentInstruction.findUnique({
          where: { settlement_batch_id: batch.id },
          include: {
            executions: { orderBy: { attempt_number: 'asc' } },
          },
        });
        if (raced) {
          return raced;
        }
      }
      throw err;
    }
  }

  /**
   * List payment instructions with tenant isolation and optional filtering.
   */
  async listPaymentInstructions(workspaceId: string, filters: ListPaymentInstructionsDto) {
    const where: Prisma.PaymentInstructionWhereInput = {
      workspace_id: workspaceId,
      ...(filters.batch_id ? { settlement_batch_id: filters.batch_id } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.direction ? { direction: filters.direction } : {}),
      ...(filters.participant_type ? { participant_type: filters.participant_type } : {}),
    };

    const take = filters.limit ? Number(filters.limit) : 50;
    const skip = filters.offset ? Number(filters.offset) : 0;

    const [items, total] = await Promise.all([
      this.prisma.paymentInstruction.findMany({
        where,
        take,
        skip,
        orderBy: { created_at: 'desc' },
        include: {
          executions: { orderBy: { attempt_number: 'asc' } },
          batch: true,
        },
      }),
      this.prisma.paymentInstruction.count({ where }),
    ]);

    return {
      items,
      total,
      limit: take,
      offset: skip,
    };
  }

  /**
   * Get single payment instruction by ID with its executions.
   */
  async getPaymentInstruction(workspaceId: string, instructionId: string) {
    const instruction = await this.prisma.paymentInstruction.findFirst({
      where: {
        id: instructionId,
        workspace_id: workspaceId,
      },
      include: {
        executions: { orderBy: { attempt_number: 'asc' } },
        batch: true,
      },
    });

    if (!instruction) {
      throw new NotFoundException(`Payment instruction ${instructionId} not found`);
    }

    return instruction;
  }

  /**
   * Create a PaymentExecution attempt against an existing PaymentInstruction.
   * Monotonically increments attempt_number and guards terminal states.
   */
  async createPaymentExecution(
    workspaceId: string,
    instructionId: string,
    dto: CreatePaymentExecutionDto,
  ) {
    const validProviders = ['manual', 'wire', 'mock'];
    if (!validProviders.includes(dto.provider)) {
      throw new BadRequestException(
        `Invalid payment provider: ${dto.provider}. Allowed providers: ${validProviders.join(', ')}`,
      );
    }

    const instruction = await this.prisma.paymentInstruction.findFirst({
      where: {
        id: instructionId,
        workspace_id: workspaceId,
      },
      include: {
        executions: { orderBy: { attempt_number: 'desc' } },
        batch: true,
      },
    });

    if (!instruction) {
      throw new NotFoundException(`Payment instruction ${instructionId} not found`);
    }

    // Idempotency check if caller provided key
    if (dto.idempotency_key) {
      const existing = await this.prisma.paymentExecution.findUnique({
        where: { idempotency_key: dto.idempotency_key },
      });
      if (existing) {
        if (
          existing.payment_instruction_id !== instruction.id ||
          existing.workspace_id !== workspaceId
        ) {
          throw new BadRequestException('Idempotency key collision across different executions');
        }
        return existing;
      }
    }

    // Terminal state checks
    if (
      instruction.status === InstructionStatus.SUCCEEDED ||
      instruction.batch.settlement_status === SettlementStatus.CLOSED ||
      instruction.batch.payment_status === PaymentStatus.SUCCEEDED
    ) {
      throw new BadRequestException('Payment instruction has already succeeded (terminal state)');
    }

    if (instruction.status === InstructionStatus.CANCELED) {
      throw new BadRequestException('Payment instruction is canceled and cannot be executed');
    }

    const latestAttempt = instruction.executions[0]?.attempt_number ?? 0;
    const nextAttemptNumber = latestAttempt + 1;
    const idempotencyKey = dto.idempotency_key || `pe_${instruction.id}_${nextAttemptNumber}`;
    const txnId = dto.provider_transaction_id || `txn_${instruction.id}_${nextAttemptNumber}`;
    const targetStatus = dto.simulate_status || 'SUCCEEDED';

    try {
      return await this.prisma.$transaction(async (tx) => {
        const execution = await tx.paymentExecution.create({
          data: {
            workspace_id: workspaceId,
            payment_instruction_id: instruction.id,
            attempt_number: nextAttemptNumber,
            provider: dto.provider,
            provider_transaction_id: txnId,
            idempotency_key: idempotencyKey,
            amount: instruction.amount,
            currency: instruction.currency,
            status: targetStatus as ExecutionStatus,
            initiated_at: new Date(),
            completed_at: targetStatus !== 'PROCESSING' ? new Date() : null,
            failure_code: targetStatus === 'FAILED' ? (dto.failure_code || 'EXECUTION_FAILED') : null,
            failure_reason:
              targetStatus === 'FAILED'
                ? (dto.failure_reason || 'Payment execution failed')
                : null,
          },
        });

        if (targetStatus === 'SUCCEEDED') {
          // Success transition: Instruction SUCCEEDED, Batch payment SUCCEEDED, Batch CLOSED
          await tx.paymentInstruction.update({
            where: { id: instruction.id },
            data: { status: InstructionStatus.SUCCEEDED },
          });

          await tx.settlementBatch.update({
            where: { id: instruction.settlement_batch_id },
            data: {
              payment_status: PaymentStatus.SUCCEEDED,
              settlement_status: SettlementStatus.CLOSED,
              closed_at: new Date(),
            },
          });
        } else if (targetStatus === 'FAILED') {
          // Failure transition: Instruction FAILED, Batch payment FAILED (batch remains FINALIZED)
          await tx.paymentInstruction.update({
            where: { id: instruction.id },
            data: { status: InstructionStatus.FAILED },
          });

          await tx.settlementBatch.update({
            where: { id: instruction.settlement_batch_id },
            data: {
              payment_status: PaymentStatus.FAILED,
            },
          });
        } else if (targetStatus === 'PROCESSING') {
          // Processing transition: Instruction PROCESSING, Batch payment PENDING
          await tx.paymentInstruction.update({
            where: { id: instruction.id },
            data: { status: InstructionStatus.PROCESSING },
          });

          await tx.settlementBatch.update({
            where: { id: instruction.settlement_batch_id },
            data: {
              payment_status: PaymentStatus.PENDING,
            },
          });
        }

        return execution;
      });
    } catch (err: any) {
      if (err?.code === 'P2002' && dto.idempotency_key) {
        const raced = await this.prisma.paymentExecution.findUnique({
          where: { idempotency_key: dto.idempotency_key },
        });
        if (raced) return raced;
      }
      throw err;
    }
  }

  /**
   * Retries a payment execution for a failed payment instruction.
   * Guarantees immutability of previous attempts and creates a new attempt.
   */
  async retryPaymentExecution(
    workspaceId: string,
    instructionId: string,
    dto: RetryPaymentExecutionDto,
  ) {
    const instruction = await this.prisma.paymentInstruction.findFirst({
      where: {
        id: instructionId,
        workspace_id: workspaceId,
      },
      include: {
        executions: { orderBy: { attempt_number: 'desc' } },
        batch: true,
      },
    });

    if (!instruction) {
      throw new NotFoundException(`Payment instruction ${instructionId} not found`);
    }

    if (
      instruction.status === InstructionStatus.SUCCEEDED ||
      instruction.batch.settlement_status === SettlementStatus.CLOSED
    ) {
      throw new BadRequestException(
        'Payment instruction has already succeeded and cannot be retried',
      );
    }

    const latestExec = instruction.executions[0];
    if (!latestExec || latestExec.status !== ExecutionStatus.FAILED) {
      throw new BadRequestException('Only failed payment executions can be retried');
    }

    const provider = dto.provider || latestExec.provider;

    return await this.createPaymentExecution(workspaceId, instruction.id, {
      provider,
      idempotency_key: dto.idempotency_key,
      provider_transaction_id: dto.provider_transaction_id,
      simulate_status: dto.simulate_status || 'SUCCEEDED',
      failure_code: dto.failure_code,
      failure_reason: dto.failure_reason,
    });
  }

  /**
   * Get payment execution by ID with tenant verification.
   */
  async getPaymentExecution(workspaceId: string, executionId: string) {
    const execution = await this.prisma.paymentExecution.findFirst({
      where: {
        id: executionId,
        workspace_id: workspaceId,
      },
      include: {
        instruction: {
          include: {
            batch: true,
          },
        },
      },
    });

    if (!execution) {
      throw new NotFoundException(`Payment execution ${executionId} not found`);
    }

    return execution;
  }
}
