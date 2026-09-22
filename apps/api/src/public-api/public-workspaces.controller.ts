import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { WorkspacesService } from '../workspaces/workspaces.service.js';
import { ApiKeyAuthGuard } from '../auth/api-key.guard.js';
import { WorkspaceRolesGuard } from '../authorization/workspace-roles.guard.js';
import { RequireWorkspaceRoles } from '../authorization/workspace-roles.decorator.js';
import { WorkspaceRole } from '@prisma/client';

@Controller('api/v1/workspaces')
@UseGuards(ApiKeyAuthGuard)
export class PublicWorkspacesController {
  constructor(private readonly workspacesService: WorkspacesService) {}

  @Get(':workspaceId')
  @UseGuards(WorkspaceRolesGuard)
  @RequireWorkspaceRoles(
    WorkspaceRole.OWNER,
    WorkspaceRole.ADMIN,
    WorkspaceRole.MEMBER,
    WorkspaceRole.VIEWER,
  )
  async getWorkspace(@Param('workspaceId') workspaceId: string) {
    return this.workspacesService.getWorkspaceInfo(workspaceId);
  }
}
