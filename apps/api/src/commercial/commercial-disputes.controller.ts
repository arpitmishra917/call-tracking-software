import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  UseGuards,
  Request,
  BadRequestException,
  Query,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { PermissionsGuard } from '../authorization/permissions.guard.js';
import { RequirePermission } from '../authorization/permissions.decorator.js';
import { WorkspaceRolesGuard } from '../authorization/workspace-roles.guard.js';
import { RequireWorkspaceRoles } from '../authorization/workspace-roles.decorator.js';
import { WorkspaceRole, DisputeStatus } from '@prisma/client';
import { CommercialDisputesService } from './commercial-disputes.service.js';
import {
  CreateDisputeDto,
  ResolveDisputeDto,
  DirectResolveDisputeDto,
} from './dto/commercial-disputes.dto.js';

@Controller('workspaces/:workspaceId')
@UseGuards(JwtAuthGuard, WorkspaceRolesGuard, PermissionsGuard)
export class CommercialDisputesController {
  constructor(private readonly disputesService: CommercialDisputesService) {}

  /**
   * Buyer creates a dispute on a CallCommercial record.
   */
  @Post('call-commercials/:callCommercialId/dispute')
  @RequirePermission('dispute:create')
  async createDispute(
    @Param('workspaceId') workspaceId: string,
    @Param('callCommercialId') callCommercialId: string,
    @Request() req: any,
    @Body() body: CreateDisputeDto,
  ) {
    if (!body?.reason || typeof body.reason !== 'string' || !body.reason.trim()) {
      throw new BadRequestException('Dispute reason is required');
    }

    return this.disputesService.createDispute({
      workspaceId,
      callCommercialId,
      userId: req.user.userId,
      reason: body.reason,
      description: body.description,
    });
  }

  /**
   * Manager (Owner/Admin) resolves a dispute with status and optional notes.
   */
  @Post('disputes/:disputeId/resolve')
  @UseGuards(WorkspaceRolesGuard)
  @RequireWorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN)
  @RequirePermission('dispute:manage')
  async resolveDispute(
    @Param('workspaceId') workspaceId: string,
    @Param('disputeId') disputeId: string,
    @Request() req: any,
    @Body() body: ResolveDisputeDto,
  ) {
    if (body.status !== DisputeStatus.ACCEPTED && body.status !== DisputeStatus.REJECTED) {
      throw new BadRequestException('Status must be ACCEPTED or REJECTED');
    }

    return this.disputesService.resolveDispute({
      workspaceId,
      disputeId,
      userId: req.user.userId,
      status: body.status,
      resolutionNotes: body.resolution_notes,
    });
  }

  /**
   * Manager (Owner/Admin) accepts a dispute directly.
   */
  @Post('disputes/:disputeId/accept')
  @UseGuards(WorkspaceRolesGuard)
  @RequireWorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN)
  @RequirePermission('dispute:manage')
  async acceptDispute(
    @Param('workspaceId') workspaceId: string,
    @Param('disputeId') disputeId: string,
    @Request() req: any,
    @Body() body?: DirectResolveDisputeDto,
  ) {
    return this.disputesService.resolveDispute({
      workspaceId,
      disputeId,
      userId: req.user.userId,
      status: DisputeStatus.ACCEPTED,
      resolutionNotes: body?.resolution_notes,
    });
  }

  /**
   * Manager (Owner/Admin) rejects a dispute directly.
   */
  @Post('disputes/:disputeId/reject')
  @UseGuards(WorkspaceRolesGuard)
  @RequireWorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN)
  @RequirePermission('dispute:manage')
  async rejectDispute(
    @Param('workspaceId') workspaceId: string,
    @Param('disputeId') disputeId: string,
    @Request() req: any,
    @Body() body?: DirectResolveDisputeDto,
  ) {
    return this.disputesService.resolveDispute({
      workspaceId,
      disputeId,
      userId: req.user.userId,
      status: DisputeStatus.REJECTED,
      resolutionNotes: body?.resolution_notes,
    });
  }

  /**
   * List disputes in the workspace with pagination and status filtering.
   */
  @Get('disputes')
  @RequirePermission('commercial:read')
  async listDisputes(
    @Param('workspaceId') workspaceId: string,
    @Request() req: any,
    @Query('status') status?: string,
    @Query('buyerId') buyerId?: string,
    @Query('limit') limitStr?: string,
    @Query('offset') offsetStr?: string,
  ) {
    let disputeStatus: DisputeStatus | undefined;
    if (status && status !== 'ALL') {
      if (!Object.values(DisputeStatus).includes(status as DisputeStatus)) {
        throw new BadRequestException(`Invalid dispute status: ${status}`);
      }
      disputeStatus = status as DisputeStatus;
    }

    const limit = limitStr ? parseInt(limitStr, 10) : undefined;
    if (limit !== undefined && (isNaN(limit) || limit < 1 || limit > 100)) {
      throw new BadRequestException('Limit must be an integer between 1 and 100');
    }

    const offset = offsetStr ? parseInt(offsetStr, 10) : undefined;
    if (offset !== undefined && (isNaN(offset) || offset < 0)) {
      throw new BadRequestException('Offset must be a non-negative integer');
    }

    return this.disputesService.listDisputes(workspaceId, req?.user?.userId, {
      status: disputeStatus,
      buyerId,
      limit,
      offset,
    });
  }

  /**
   * Retrieve a dispute by dispute ID.
   */
  @Get('disputes/:disputeId')
  @RequirePermission('commercial:read')
  async getDispute(
    @Param('workspaceId') workspaceId: string,
    @Param('disputeId') disputeId: string,
    @Request() req?: any,
  ) {
    return this.disputesService.getDispute(workspaceId, disputeId, req?.user?.userId);
  }

  /**
   * Retrieve a dispute by CallCommercial ID.
   */
  @Get('call-commercials/:callCommercialId/dispute')
  @RequirePermission('commercial:read')
  async getDisputeByCommercial(
    @Param('workspaceId') workspaceId: string,
    @Param('callCommercialId') callCommercialId: string,
    @Request() req?: any,
  ) {
    return this.disputesService.getDisputeByCallCommercial(workspaceId, callCommercialId, req?.user?.userId);
  }
}
