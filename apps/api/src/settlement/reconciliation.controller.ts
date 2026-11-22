import {
  Controller,
  Post,
  Get,
  Param,
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
import { ReconciliationService } from './reconciliation.service.js';
import { ListReconciliationRunsDto } from './dto/reconciliation.dto.js';
import { WorkspaceRole } from '@prisma/client';

@Controller('workspaces/:workspaceId')
@UseGuards(JwtAuthGuard, WorkspaceRolesGuard, PermissionsGuard)
export class ReconciliationController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reconciliationService: ReconciliationService,
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
        'Participants and standard members do not have access to reconciliation resources',
      );
    }

    return member;
  }

  /**
   * POST /workspaces/:workspaceId/reconciliation/batches/:batchId/run
   * Triggers batch-level reconciliation audit.
   * OWNER-only with reconciliation:run permission.
   */
  @Post('reconciliation/batches/:batchId/run')
  @UseGuards(WorkspaceRolesGuard)
  @RequireWorkspaceRoles(WorkspaceRole.OWNER)
  @RequirePermission('reconciliation:run')
  async runBatchReconciliation(
    @Param('workspaceId') workspaceId: string,
    @Param('batchId') batchId: string,
    @Request() req: any,
  ) {
    const member = await this.getMemberContext(workspaceId, req.user.userId);
    if (member.role !== WorkspaceRole.OWNER) {
      throw new ForbiddenException('Only workspace owners can trigger reconciliation');
    }

    return await this.reconciliationService.runBatchReconciliation(
      workspaceId,
      batchId,
    );
  }

  /**
   * POST /workspaces/:workspaceId/settlements/batches/:batchId/reconciliation/run (alias)
   */
  @Post('settlements/batches/:batchId/reconciliation/run')
  @UseGuards(WorkspaceRolesGuard)
  @RequireWorkspaceRoles(WorkspaceRole.OWNER)
  @RequirePermission('reconciliation:run')
  async runBatchReconciliationAlias(
    @Param('workspaceId') workspaceId: string,
    @Param('batchId') batchId: string,
    @Request() req: any,
  ) {
    const member = await this.getMemberContext(workspaceId, req.user.userId);
    if (member.role !== WorkspaceRole.OWNER) {
      throw new ForbiddenException('Only workspace owners can trigger reconciliation');
    }

    return await this.reconciliationService.runBatchReconciliation(
      workspaceId,
      batchId,
    );
  }

  /**
   * POST /workspaces/:workspaceId/reconciliation/run
   * Triggers workspace-level reconciliation audit across all settlement batches.
   * OWNER-only with reconciliation:run permission.
   */
  @Post('reconciliation/run')
  @UseGuards(WorkspaceRolesGuard)
  @RequireWorkspaceRoles(WorkspaceRole.OWNER)
  @RequirePermission('reconciliation:run')
  async runWorkspaceReconciliation(
    @Param('workspaceId') workspaceId: string,
    @Request() req: any,
  ) {
    const member = await this.getMemberContext(workspaceId, req.user.userId);
    if (member.role !== WorkspaceRole.OWNER) {
      throw new ForbiddenException('Only workspace owners can trigger reconciliation');
    }

    return await this.reconciliationService.runWorkspaceReconciliation(workspaceId);
  }

  /**
   * GET /workspaces/:workspaceId/reconciliation/runs
   * Lists reconciliation runs with tenant isolation and filtering.
   * Accessible by OWNER and ADMIN with reconciliation:read permission.
   */
  @Get('reconciliation/runs')
  @UseGuards(WorkspaceRolesGuard)
  @RequireWorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN)
  @RequirePermission('reconciliation:read')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async listRuns(
    @Param('workspaceId') workspaceId: string,
    @Query() query: ListReconciliationRunsDto,
    @Request() req: any,
  ) {
    await this.getMemberContext(workspaceId, req.user.userId);
    return await this.reconciliationService.listReconciliationRuns(workspaceId, query);
  }

  /**
   * GET /workspaces/:workspaceId/reconciliation/runs/:runId
   * Retrieves single reconciliation run with its issues.
   * Accessible by OWNER and ADMIN with reconciliation:read permission.
   */
  @Get('reconciliation/runs/:runId')
  @UseGuards(WorkspaceRolesGuard)
  @RequireWorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN)
  @RequirePermission('reconciliation:read')
  async getRun(
    @Param('workspaceId') workspaceId: string,
    @Param('runId') runId: string,
    @Request() req: any,
  ) {
    await this.getMemberContext(workspaceId, req.user.userId);
    return await this.reconciliationService.getReconciliationRun(workspaceId, runId);
  }

  /**
   * GET /workspaces/:workspaceId/reconciliation/runs/:runId/issues
   * Retrieves issues associated with a reconciliation run.
   * Accessible by OWNER and ADMIN with reconciliation:read permission.
   */
  @Get('reconciliation/runs/:runId/issues')
  @UseGuards(WorkspaceRolesGuard)
  @RequireWorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN)
  @RequirePermission('reconciliation:read')
  async getRunIssues(
    @Param('workspaceId') workspaceId: string,
    @Param('runId') runId: string,
    @Request() req: any,
  ) {
    await this.getMemberContext(workspaceId, req.user.userId);
    return await this.reconciliationService.getReconciliationRunIssues(
      workspaceId,
      runId,
    );
  }
}
