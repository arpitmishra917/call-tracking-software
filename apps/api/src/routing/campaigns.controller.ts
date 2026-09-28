import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  UseGuards, Query,
} from '@nestjs/common';
import { CampaignsService } from './campaigns.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { WorkspaceRolesGuard } from '../authorization/workspace-roles.guard.js';
import { RequireWorkspaceRoles } from '../authorization/workspace-roles.decorator.js';
import { WorkspaceRole } from '@prisma/client';

@Controller('workspaces/:workspaceId/campaigns')
@UseGuards(JwtAuthGuard, WorkspaceRolesGuard)
@RequireWorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN)
export class CampaignsController {
  constructor(private readonly campaignsService: CampaignsService) {}

  @Get()
  list(
    @Param('workspaceId') workspaceId: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string
  ) {
    return this.campaignsService.listCampaigns(workspaceId, {
      search,
      status,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined
    });
  }

  @Get(':id')
  get(@Param('workspaceId') workspaceId: string, @Param('id') id: string) {
    return this.campaignsService.getCampaign(workspaceId, id);
  }

  @Post()
  create(
    @Param('workspaceId') workspaceId: string,
    @Body('name') name: string,
  ) {
    return this.campaignsService.createCampaign(workspaceId, name);
  }

  @Put(':id')
  update(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @Body() body: { name?: string; status?: string },
  ) {
    return this.campaignsService.updateCampaign(workspaceId, id, body);
  }

  @Post(':id/archive')
  archive(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
  ) {
    return this.campaignsService.updateCampaign(workspaceId, id, {
      status: 'INACTIVE',
    });
  }

  @Post(':id/activate')
  activate(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
  ) {
    return this.campaignsService.updateCampaign(workspaceId, id, {
      status: 'ACTIVE',
    });
  }

  @Post(':id/phone-numbers')
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

  @Post(':id/buyers')
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

  @Delete(':id/buyers/:buyerId')
  removeBuyer(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @Param('buyerId') buyerId: string,
  ) {
    return this.campaignsService.removeBuyerFromCampaign(workspaceId, id, buyerId);
  }

  @Put(':id/buyers/reorder')
  reorderBuyers(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @Body() body: { buyerIds: string[] },
  ) {
    return this.campaignsService.reorderBuyersInCampaign(workspaceId, id, body.buyerIds);
  }
}
