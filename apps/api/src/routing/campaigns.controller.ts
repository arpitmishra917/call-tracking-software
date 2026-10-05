import { Controller, Get, Post, Put, Delete, Param, Body, UseGuards, Query, Request } from '@nestjs/common';
import { PermissionsGuard } from '../authorization/permissions.guard.js';
import { RequirePermission, RequireResourceScope } from '../authorization/permissions.decorator.js';
import { CampaignsService } from './campaigns.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { WorkspaceRolesGuard } from '../authorization/workspace-roles.guard.js';
import { RequireWorkspaceRoles } from '../authorization/workspace-roles.decorator.js';
import { WorkspaceRole } from '@prisma/client';

@Controller('workspaces/:workspaceId/campaigns')
@UseGuards(JwtAuthGuard, WorkspaceRolesGuard, PermissionsGuard)
export class CampaignsController {
  constructor(private readonly campaignsService: CampaignsService) {}

  @Get()
  @RequirePermission('campaign:read')
  list(
    @Param('workspaceId') workspaceId: string,
    @Request() req: any,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string
  ) {
    return this.campaignsService.listCampaigns(workspaceId, req.user.userId, {
      search,
      status,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined
    });
  }

  @Get(':id')
  @RequirePermission('campaign:read')
  @RequireResourceScope('campaign', 'id')
  get(@Param('workspaceId') workspaceId: string, @Param('id') id: string) {
    return this.campaignsService.getCampaign(workspaceId, id);
  }

  @Post()
  @RequirePermission('campaign:create')
  create(
    @Param('workspaceId') workspaceId: string,
    @Body('name') name: string,
  ) {
    return this.campaignsService.createCampaign(workspaceId, name);
  }

  @Put(':id')
  @RequirePermission('campaign:update')
  @RequireResourceScope('campaign', 'id')
  update(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @Body() body: { name?: string; status?: string },
  ) {
    return this.campaignsService.updateCampaign(workspaceId, id, body);
  }

  @RequirePermission('campaign:update')
  @Post(':id/archive')
  @RequireResourceScope('campaign', 'id')
  archive(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
  ) {
    return this.campaignsService.updateCampaign(workspaceId, id, {
      status: 'INACTIVE',
    });
  }

  @RequirePermission('campaign:update')
  @Post(':id/activate')
  @RequireResourceScope('campaign', 'id')
  activate(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
  ) {
    return this.campaignsService.updateCampaign(workspaceId, id, {
      status: 'ACTIVE',
    });
  }

  @RequirePermission('campaign:update')
  @Post(':id/phone-numbers')
  @RequireResourceScope('campaign', 'id')
  assignPhoneNumber(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @Body('phoneNumberId') phoneNumberId: string,
  ) {
    return this.campaignsService.assignPhoneNumber(
      workspaceId,
      id,
      phoneNumberId,
    );
  }

  @RequirePermission('campaign:update')
  @Delete(':id/phone-numbers/:phoneNumberId')
  @RequireResourceScope('campaign', 'id')
  removePhoneNumber(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @Param('phoneNumberId') phoneNumberId: string,
  ) {
    return this.campaignsService.removePhoneNumber(
      workspaceId,
      id,
      phoneNumberId,
    );
  }

  @Post(':id/buyers')
  @RequirePermission('campaign:update')
  @RequireResourceScope('campaign', 'id')
  addBuyer(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @Body() body: { buyerId: string; priority: number },
  ) {
    return this.campaignsService.addBuyerToCampaign(
      workspaceId,
      id,
      body.buyerId,
      body.priority,
    );
  }

  @RequirePermission('campaign:update')
  @Delete(':id/buyers/:buyerId')
  @RequireResourceScope('campaign', 'id')
  removeBuyer(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @Param('buyerId') buyerId: string,
  ) {
    return this.campaignsService.removeBuyerFromCampaign(workspaceId, id, buyerId);
  }

  @RequirePermission('campaign:update')
  @Put(':id/buyers/reorder')
  @RequireResourceScope('campaign', 'id')
  reorderBuyers(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @Body() body: { buyerIds: string[] },
  ) {
    return this.campaignsService.reorderBuyersInCampaign(workspaceId, id, body.buyerIds);
  }
}
