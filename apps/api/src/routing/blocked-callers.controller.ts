import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { BlockedCallersService } from './blocked-callers.service.js';
import { WorkspaceRolesGuard } from '../authorization/workspace-roles.guard.js';
import { RequireWorkspaceRoles } from '../authorization/workspace-roles.decorator.js';
import { WorkspaceRole } from '@prisma/client';

@Controller('workspaces/:workspaceId/blocked-callers')
@UseGuards(WorkspaceRolesGuard)
@RequireWorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN)
export class BlockedCallersController {
  constructor(private readonly blockedCallersService: BlockedCallersService) {}

  @Get()
  list(@Param('workspaceId') workspaceId: string) {
    return this.blockedCallersService.listBlockedCallers(workspaceId);
  }

  @Post()
  block(
    @Param('workspaceId') workspaceId: string,
    @Body() body: { phoneNumber: string; reason?: string },
  ) {
    return this.blockedCallersService.blockCaller(
      workspaceId,
      body.phoneNumber,
      body.reason,
    );
  }

  @Delete(':id')
  unblock(@Param('workspaceId') workspaceId: string, @Param('id') id: string) {
    return this.blockedCallersService.unblockCaller(workspaceId, id);
  }
}
