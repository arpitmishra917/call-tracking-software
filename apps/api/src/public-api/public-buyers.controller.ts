import { Controller, Get, Post, Param, Body, UseGuards } from '@nestjs/common';
import { BuyersService } from '../routing/buyers.service.js';
import { ApiKeyAuthGuard } from '../auth/api-key.guard.js';
import { WorkspaceRolesGuard } from '../authorization/workspace-roles.guard.js';
import { RequireWorkspaceRoles } from '../authorization/workspace-roles.decorator.js';
import { WorkspaceRole } from '@prisma/client';

@Controller('api/v1/workspaces/:workspaceId/buyers')
@UseGuards(ApiKeyAuthGuard, WorkspaceRolesGuard)
export class PublicBuyersController {
  constructor(private readonly buyersService: BuyersService) {}

  @Get()
  @RequireWorkspaceRoles(
    WorkspaceRole.OWNER,
    WorkspaceRole.ADMIN,
    WorkspaceRole.MEMBER,
    WorkspaceRole.VIEWER,
  )
  async listBuyers(@Param('workspaceId') workspaceId: string) {
    return this.buyersService.listBuyers(workspaceId);
  }

  @Get(':id')
  @RequireWorkspaceRoles(
    WorkspaceRole.OWNER,
    WorkspaceRole.ADMIN,
    WorkspaceRole.MEMBER,
    WorkspaceRole.VIEWER,
  )
  async getBuyer(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
  ) {
    return this.buyersService.getBuyer(workspaceId, id);
  }

  @Post()
  @RequireWorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN)
  async createBuyer(
    @Param('workspaceId') workspaceId: string,
    @Body('name') name: string,
    @Body('destinationNumberE164') destinationNumberE164: string,
    @Body('timeout') timeout?: number,
  ) {
    return this.buyersService.createBuyer(
      workspaceId,
      name,
      destinationNumberE164,
      timeout,
    );
  }
}
