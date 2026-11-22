import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Query,
  UseGuards,
  Request,
  ForbiddenException,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { PermissionsGuard } from '../authorization/permissions.guard.js';
import { RequirePermission } from '../authorization/permissions.decorator.js';
import { WorkspaceRolesGuard } from '../authorization/workspace-roles.guard.js';
import { RequireWorkspaceRoles } from '../authorization/workspace-roles.decorator.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PaymentService } from './payment.service.js';
import {
  CreatePaymentExecutionDto,
  RetryPaymentExecutionDto,
  ListPaymentInstructionsDto,
} from './dto/payment.dto.js';
import { WorkspaceRole } from '@prisma/client';

@Controller('workspaces/:workspaceId')
@UseGuards(JwtAuthGuard, WorkspaceRolesGuard, PermissionsGuard)
export class PaymentController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentService: PaymentService,
  ) {}

  /**
   * Helper to validate workspace membership and role context.
   * Strictly forbids Buyer and Vendor participant users and standard MEMBERs.
   */
  private async getMemberContext(workspaceId: string, userId: string) {
    const member = await this.prisma.workspaceMember.findUnique({
      where: {
        workspace_id_user_id: {
          workspace_id: workspaceId,
          user_id: userId,
        },
      },
    });

    if (!member) {
      throw new ForbiddenException('User is not a member of this workspace');
    }

    if (
      member.role === WorkspaceRole.MEMBER ||
      member.buyer_id ||
      member.vendor_id
    ) {
      throw new ForbiddenException(
        'Participants and standard members do not have access to payment resources',
      );
    }

    return member;
  }

  /**
   * Sanitizes execution data for ADMIN role (masks sensitive internal provider details).
   */
  private sanitizeExecution(execution: any, role: WorkspaceRole) {
    if (!execution || role === WorkspaceRole.OWNER) {
      return execution;
    }
    const sanitized = { ...execution };
    delete sanitized.provider_transaction_id;
    return sanitized;
  }

  private sanitizeInstruction(instruction: any, role: WorkspaceRole) {
    if (!instruction || role === WorkspaceRole.OWNER) {
      return instruction;
    }
    const sanitized = { ...instruction };
    if (sanitized.executions) {
      sanitized.executions = sanitized.executions.map((e: any) =>
        this.sanitizeExecution(e, role),
      );
    }
    return sanitized;
  }

  /**
   * POST /workspaces/:workspaceId/settlements/batches/:batchId/payment-instruction
   * Creates a deterministic PaymentInstruction from a FINALIZED SettlementBatch.
   * OWNER-only with payment:manage permission.
   */
  @Post('settlements/batches/:batchId/payment-instruction')
  @UseGuards(WorkspaceRolesGuard)
  @RequireWorkspaceRoles(WorkspaceRole.OWNER)
  @RequirePermission('payment:manage')
  async createInstructionFromBatch(
    @Param('workspaceId') workspaceId: string,
    @Param('batchId') batchId: string,
    @Request() req: any,
  ) {
    const member = await this.getMemberContext(workspaceId, req.user.userId);
    if (member.role !== WorkspaceRole.OWNER) {
      throw new ForbiddenException('Only workspace owners can create payment instructions');
    }

    return await this.paymentService.createPaymentInstruction(workspaceId, batchId);
  }

  /**
   * POST /workspaces/:workspaceId/payments/batches/:batchId/instructions (alias)
   */
  @Post('payments/batches/:batchId/instructions')
  @UseGuards(WorkspaceRolesGuard)
  @RequireWorkspaceRoles(WorkspaceRole.OWNER)
  @RequirePermission('payment:manage')
  async createInstructionFromBatchAlias(
    @Param('workspaceId') workspaceId: string,
    @Param('batchId') batchId: string,
    @Request() req: any,
  ) {
    const member = await this.getMemberContext(workspaceId, req.user.userId);
    if (member.role !== WorkspaceRole.OWNER) {
      throw new ForbiddenException('Only workspace owners can create payment instructions');
    }

    return await this.paymentService.createPaymentInstruction(workspaceId, batchId);
  }

  /**
   * GET /workspaces/:workspaceId/payments/instructions
   * Lists payment instructions with tenant isolation.
   * Accessible by OWNER and ADMIN with payment:read permission.
   */
  @Get('payments/instructions')
  @UseGuards(WorkspaceRolesGuard)
  @RequireWorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN)
  @RequirePermission('payment:read')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async listInstructions(
    @Param('workspaceId') workspaceId: string,
    @Query() query: ListPaymentInstructionsDto,
    @Request() req: any,
  ) {
    const member = await this.getMemberContext(workspaceId, req.user.userId);
    const result = await this.paymentService.listPaymentInstructions(workspaceId, query);

    return {
      ...result,
      items: result.items.map((inst) => this.sanitizeInstruction(inst, member.role)),
    };
  }

  /**
   * GET /workspaces/:workspaceId/payments/instructions/:instructionId
   * Retrieves single payment instruction with its executions.
   */
  @Get('payments/instructions/:instructionId')
  @UseGuards(WorkspaceRolesGuard)
  @RequireWorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN)
  @RequirePermission('payment:read')
  async getInstruction(
    @Param('workspaceId') workspaceId: string,
    @Param('instructionId') instructionId: string,
    @Request() req: any,
  ) {
    const member = await this.getMemberContext(workspaceId, req.user.userId);
    const instruction = await this.paymentService.getPaymentInstruction(
      workspaceId,
      instructionId,
    );

    return this.sanitizeInstruction(instruction, member.role);
  }

  /**
   * POST /workspaces/:workspaceId/payments/instructions/:instructionId/executions
   * Creates an execution attempt against a payment instruction.
   * OWNER-only with payment:manage permission.
   */
  @Post('payments/instructions/:instructionId/executions')
  @UseGuards(WorkspaceRolesGuard)
  @RequireWorkspaceRoles(WorkspaceRole.OWNER)
  @RequirePermission('payment:manage')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async createExecution(
    @Param('workspaceId') workspaceId: string,
    @Param('instructionId') instructionId: string,
    @Body() dto: CreatePaymentExecutionDto,
    @Request() req: any,
  ) {
    const member = await this.getMemberContext(workspaceId, req.user.userId);
    if (member.role !== WorkspaceRole.OWNER) {
      throw new ForbiddenException('Only workspace owners can execute payments');
    }

    return await this.paymentService.createPaymentExecution(
      workspaceId,
      instructionId,
      dto,
    );
  }

  /**
   * POST /workspaces/:workspaceId/payments/instructions/:instructionId/retry
   * Retries execution on a failed payment instruction.
   * OWNER-only with payment:manage permission.
   */
  @Post('payments/instructions/:instructionId/retry')
  @UseGuards(WorkspaceRolesGuard)
  @RequireWorkspaceRoles(WorkspaceRole.OWNER)
  @RequirePermission('payment:manage')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async retryExecution(
    @Param('workspaceId') workspaceId: string,
    @Param('instructionId') instructionId: string,
    @Body() dto: RetryPaymentExecutionDto,
    @Request() req: any,
  ) {
    const member = await this.getMemberContext(workspaceId, req.user.userId);
    if (member.role !== WorkspaceRole.OWNER) {
      throw new ForbiddenException('Only workspace owners can retry payments');
    }

    return await this.paymentService.retryPaymentExecution(
      workspaceId,
      instructionId,
      dto,
    );
  }

  /**
   * GET /workspaces/:workspaceId/payments/executions/:executionId
   * Retrieves single payment execution by ID.
   */
  @Get('payments/executions/:executionId')
  @UseGuards(WorkspaceRolesGuard)
  @RequireWorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN)
  @RequirePermission('payment:read')
  async getExecution(
    @Param('workspaceId') workspaceId: string,
    @Param('executionId') executionId: string,
    @Request() req: any,
  ) {
    const member = await this.getMemberContext(workspaceId, req.user.userId);
    const execution = await this.paymentService.getPaymentExecution(
      workspaceId,
      executionId,
    );

    return this.sanitizeExecution(execution, member.role);
  }
}
