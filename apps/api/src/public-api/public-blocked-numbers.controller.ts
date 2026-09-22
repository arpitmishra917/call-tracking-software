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
import { WorkspaceRole } from '@prisma/client';

@Controller('api/v1/workspaces/:workspaceId/blocked-numbers')
@UseGuards(ApiKeyAuthGuard, WorkspaceRolesGuard)
export class PublicBlockedNumbersController {
  constructor(private readonly blockedCallersService: BlockedCallersService) {}

  @Get()
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
  @RequireWorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN)
  async unblockNumber(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
  ) {
    return this.blockedCallersService.unblockCaller(workspaceId, id);
  }
}
