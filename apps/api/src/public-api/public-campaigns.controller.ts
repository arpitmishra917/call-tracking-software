import { Controller, Get, Post, Param, Body, UseGuards , Request} from '@nestjs/common';
import { PermissionsGuard } from '../authorization/permissions.guard.js';
import { RequirePermission, RequireResourceScope } from '../authorization/permissions.decorator.js';
import { CampaignsService } from '../routing/campaigns.service.js';
import { ApiKeyAuthGuard } from '../auth/api-key.guard.js';
import { WorkspaceRolesGuard } from '../authorization/workspace-roles.guard.js';
import { RequireWorkspaceRoles } from '../authorization/workspace-roles.decorator.js';
import { WorkspaceRole } from '@prisma/client';

@Controller('api/v1/workspaces/:workspaceId/campaigns')
@UseGuards(ApiKeyAuthGuard, WorkspaceRolesGuard, PermissionsGuard)
export class PublicCampaignsController {
  constructor(private readonly campaignsService: CampaignsService) {}

  @Get()
  @RequirePermission('campaign:read')
  async listCampaigns(
@Param('workspaceId') workspaceId: string,
@Request() req: any) {
    return this.campaignsService.listCampaigns(workspaceId, req.user.userId);
  }

  @Post()
  @RequirePermission('campaign:create')
  async createCampaign(
    @Param('workspaceId') workspaceId: string,
    @Body('name') name: string,
  ) {
    return this.campaignsService.createCampaign(workspaceId, name);
  }

  @Get(':id')
  @RequirePermission('campaign:read')
  @RequireResourceScope('campaign', 'id')
  async getCampaign(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
  ) {
    return this.campaignsService.getCampaign(workspaceId, id);
  }
}
