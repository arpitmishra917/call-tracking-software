import { Controller, Get, Post, Param, Body, UseGuards , Request} from '@nestjs/common';
import { PermissionsGuard } from '../authorization/permissions.guard.js';
import { RequirePermission, RequireResourceScope } from '../authorization/permissions.decorator.js';
import { BuyersService } from '../routing/buyers.service.js';
import { ApiKeyAuthGuard } from '../auth/api-key.guard.js';
import { WorkspaceRolesGuard } from '../authorization/workspace-roles.guard.js';
import { RequireWorkspaceRoles } from '../authorization/workspace-roles.decorator.js';
import { WorkspaceRole } from '@prisma/client';

@Controller('api/v1/workspaces/:workspaceId/buyers')
@UseGuards(ApiKeyAuthGuard, WorkspaceRolesGuard, PermissionsGuard)
export class PublicBuyersController {
  constructor(private readonly buyersService: BuyersService) {}

  @Get()
  @RequirePermission('buyer:read')
  async listBuyers(
@Param('workspaceId') workspaceId: string,
@Request() req: any) {
    return this.buyersService.listBuyers(workspaceId, req.user.userId);
  }

  @Get(':id')
  @RequirePermission('buyer:read')
  @RequireResourceScope('buyer', 'id')
  async getBuyer(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
  ) {
    return this.buyersService.getBuyer(workspaceId, id);
  }

  @Post()
  @RequirePermission('buyer:create')
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
