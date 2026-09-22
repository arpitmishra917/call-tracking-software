import { Controller, Get, Post, Param, Body, UseGuards } from '@nestjs/common';
import { CampaignsService } from '../routing/campaigns.service.js';
import { ApiKeyAuthGuard } from '../auth/api-key.guard.js';
import { WorkspaceRolesGuard } from '../authorization/workspace-roles.guard.js';
import { RequireWorkspaceRoles } from '../authorization/workspace-roles.decorator.js';
import { WorkspaceRole } from '@prisma/client';

@Controller('api/v1/workspaces/:workspaceId/campaigns')
@UseGuards(ApiKeyAuthGuard, WorkspaceRolesGuard)
export class PublicCampaignsController {
  constructor(private readonly campaignsService: CampaignsService) {}

  @Get()
  @RequireWorkspaceRoles(
    WorkspaceRole.OWNER,
    WorkspaceRole.ADMIN,
    WorkspaceRole.MEMBER,
    WorkspaceRole.VIEWER,
  )
  async listCampaigns(@Param('workspaceId') workspaceId: string) {
    return this.campaignsService.listCampaigns(workspaceId);
  }

  @Post()
  @RequireWorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN)
  async createCampaign(
    @Param('workspaceId') workspaceId: string,
    @Body('name') name: string,
  ) {
    return this.campaignsService.createCampaign(workspaceId, name);
  }

  @Get(':id')
  @RequireWorkspaceRoles(
    WorkspaceRole.OWNER,
    WorkspaceRole.ADMIN,
    WorkspaceRole.MEMBER,
    WorkspaceRole.VIEWER,
  )
  async getCampaign(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
  ) {
    return this.campaignsService.getCampaign(workspaceId, id);
  }
}
