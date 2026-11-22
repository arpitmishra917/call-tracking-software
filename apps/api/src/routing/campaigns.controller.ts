import { Controller, Get, Post, Put, Delete, Param, Body, UseGuards, Query, Request } from '@nestjs/common';
import { PermissionsGuard } from '../authorization/permissions.guard.js';
import { RequirePermission, RequireResourceScope } from '../authorization/permissions.decorator.js';
import { CampaignsService } from './campaigns.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { WorkspaceRolesGuard } from '../authorization/workspace-roles.guard.js';
import { RequireWorkspaceRoles } from '../authorization/workspace-roles.decorator.js';
import { WorkspaceRole } from '@prisma/client';
import {
  CreateCampaignDto,
  UpdateCampaignDto,
  ListCampaignsQueryDto,
  AssignPhoneNumberDto,
  AssignBuyerDto,
  BatchAssignBuyersDto,
  AssignDestinationNumberDto,
  BatchAssignDestinationNumbersDto,
} from './dto/campaigns.dto.js';

@Controller('workspaces/:workspaceId/campaigns')
@UseGuards(JwtAuthGuard, WorkspaceRolesGuard, PermissionsGuard)
export class CampaignsController {
  constructor(private readonly campaignsService: CampaignsService) {}

  @Get()
  @RequirePermission('campaign:read')
  list(
    @Param('workspaceId') workspaceId: string,
    @Request() req: any,
    @Query() query: ListCampaignsQueryDto,
  ) {
    return this.campaignsService.listCampaigns(workspaceId, req.user.userId, {
      search: query.search,
      status: query.status,
      limit: query.limit,
      offset: query.offset,
    });
  }

  @Get(':id')
  @RequirePermission('campaign:read')
  @RequireResourceScope('campaign', 'id')
  get(@Param('workspaceId') workspaceId: string, @Param('id') id: string, @Request() req: any) {
    return this.campaignsService.getCampaign(workspaceId, id, req.user?.userId);
  }

  @Post()
  @RequirePermission('campaign:create')
  create(
    @Param('workspaceId') workspaceId: string,
    @Body() body: CreateCampaignDto,
  ) {
    return this.campaignsService.createCampaign(workspaceId, body);
  }

  @Put(':id')
  @RequirePermission('campaign:update')
  @RequireResourceScope('campaign', 'id')
  update(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @Body() body: UpdateCampaignDto,
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
    @Body() body: AssignPhoneNumberDto,
  ) {
    return this.campaignsService.assignPhoneNumber(
      workspaceId,
      id,
      body.phoneNumberId,
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
    @Body() body: AssignBuyerDto,
  ) {
    return this.campaignsService.addBuyerToCampaign(
      workspaceId,
      id,
      body.buyerId,
      body.priority ?? 0,
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
    @Body() body: BatchAssignBuyersDto,
  ) {
    return this.campaignsService.reorderBuyersInCampaign(workspaceId, id, body.buyerIds);
  }

  @Post(':id/destinations')
  @RequirePermission('campaign:update')
  @RequireResourceScope('campaign', 'id')
  addDestination(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @Body() body: AssignDestinationNumberDto,
  ) {
    return this.campaignsService.addDestinationToCampaign(
      workspaceId,
      id,
      body.destinationNumberId,
      body.priority,
      body.weight,
    );
  }

  @RequirePermission('campaign:update')
  @Delete(':id/destinations/:destinationNumberId')
  @RequireResourceScope('campaign', 'id')
  removeDestination(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @Param('destinationNumberId') destinationNumberId: string,
  ) {
    return this.campaignsService.removeDestinationFromCampaign(
      workspaceId,
      id,
      destinationNumberId,
    );
  }

  @RequirePermission('campaign:update')
  @Put(':id/destinations/reorder')
  @RequireResourceScope('campaign', 'id')
  reorderDestinations(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @Body() body: BatchAssignDestinationNumbersDto,
  ) {
    return this.campaignsService.reorderDestinationsInCampaign(
      workspaceId,
      id,
      body.destinationNumberIds,
    );
  }
}
