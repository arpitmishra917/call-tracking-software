import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { CampaignsService } from './campaigns.service.js';
import { WorkspaceRolesGuard } from '../authorization/workspace-roles.guard.js';
import { RequireWorkspaceRoles } from '../authorization/workspace-roles.decorator.js';
import { WorkspaceRole } from '@prisma/client';

@Controller('workspaces/:workspaceId/campaigns')
@UseGuards(WorkspaceRolesGuard)
@RequireWorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN)
export class CampaignsController {
  constructor(private readonly campaignsService: CampaignsService) {}

  @Get()
  list(@Param('workspaceId') workspaceId: string) {
    return this.campaignsService.listCampaigns(workspaceId);
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
}
