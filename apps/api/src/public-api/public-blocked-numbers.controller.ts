import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { BlockedCallersService } from '../routing/blocked-callers.service.js';
import { ApiKeyAuthGuard } from '../auth/api-key.guard.js';
import { WorkspaceRolesGuard } from '../authorization/workspace-roles.guard.js';
import { RequireWorkspaceRoles } from '../authorization/workspace-roles.decorator.js';
import { PermissionsGuard } from '../authorization/permissions.guard.js';
import { RequirePermission } from '../authorization/permissions.decorator.js';
import { WorkspaceRole } from '@prisma/client';

@Controller('api/v1/workspaces/:workspaceId/blocked-numbers')
@UseGuards(ApiKeyAuthGuard, WorkspaceRolesGuard, PermissionsGuard)
export class PublicBlockedNumbersController {
  constructor(private readonly blockedCallersService: BlockedCallersService) {}

  @Get()
  @RequirePermission('phone_number:read')
  @RequireWorkspaceRoles(
    WorkspaceRole.OWNER,
    WorkspaceRole.ADMIN,
    WorkspaceRole.MEMBER,
    WorkspaceRole.VIEWER,
  )
  async listBlockedNumbers(@Param('workspaceId') workspaceId: string) {
    return this.blockedCallersService.listBlockedCallers(workspaceId);
  }

  @Post()
  @RequirePermission('phone_number:manage')
  @RequireWorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN)
  async blockNumber(
    @Param('workspaceId') workspaceId: string,
    @Body('phoneNumber') phoneNumber: string,
    @Body('reason') reason?: string,
  ) {
    return this.blockedCallersService.blockCaller(
      workspaceId,
      phoneNumber,
      reason,
    );
  }

  @Delete(':id')
  @RequirePermission('phone_number:manage')
  @RequireWorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN)
  async unblockNumber(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
  ) {
    return this.blockedCallersService.unblockCaller(workspaceId, id);
  }
}
