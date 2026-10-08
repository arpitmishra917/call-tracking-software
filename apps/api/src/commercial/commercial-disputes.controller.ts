import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  UseGuards,
  Request,
  BadRequestException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { PermissionsGuard } from '../authorization/permissions.guard.js';
import { RequirePermission } from '../authorization/permissions.decorator.js';
import { WorkspaceRolesGuard } from '../authorization/workspace-roles.guard.js';
import { RequireWorkspaceRoles } from '../authorization/workspace-roles.decorator.js';
import { WorkspaceRole, DisputeStatus } from '@prisma/client';
import { CommercialDisputesService } from './commercial-disputes.service.js';

@Controller('workspaces/:workspaceId')
@UseGuards(JwtAuthGuard, PermissionsGuard)
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
    @Body() body: { reason: string; description?: string },
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
    @Body() body: { status: DisputeStatus; resolution_notes?: string },
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
    @Body() body?: { resolution_notes?: string },
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
    @Body() body?: { resolution_notes?: string },
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
