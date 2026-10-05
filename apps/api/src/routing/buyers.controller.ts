import { Controller, Query, Get, Post, Put, Param, Body, UseGuards, Request } from '@nestjs/common';
import { PermissionsGuard } from '../authorization/permissions.guard.js';
import { RequirePermission, RequireResourceScope } from '../authorization/permissions.decorator.js';
import { BuyersService } from './buyers.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { WorkspaceRolesGuard } from '../authorization/workspace-roles.guard.js';
import { RequireWorkspaceRoles } from '../authorization/workspace-roles.decorator.js';
import { WorkspaceRole } from '@prisma/client';

@Controller('workspaces/:workspaceId/buyers')
@UseGuards(JwtAuthGuard, WorkspaceRolesGuard, PermissionsGuard)
export class BuyersController {
  constructor(private readonly buyersService: BuyersService) {}

  @Get()
  @RequirePermission('buyer:read')
  list(
    @Param('workspaceId') workspaceId: string,
    @Request() req: any,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string
  ) {
    return this.buyersService.listBuyers(workspaceId, req.user.userId, {
      search,
      status,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined
    });
  }

  @Get(':id')
  @RequirePermission('buyer:read')
  @RequireResourceScope('buyer', 'id')
  get(@Param('workspaceId') workspaceId: string, @Param('id') id: string) {
    return this.buyersService.getBuyer(workspaceId, id);
  }

  @Post()
  @RequirePermission('buyer:create')
  create(
    @Param('workspaceId') workspaceId: string,
    @Body() body: { name: string; destinationNumber: string; timeout?: number },
  ) {
    return this.buyersService.createBuyer(
      workspaceId,
      body.name,
      body.destinationNumber,
      body.timeout,
    );
  }

  @RequirePermission('buyer:update')
  @Post(':id/archive')
  @RequireResourceScope('buyer', 'id')
  archive(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
  ) {
    return this.buyersService.updateBuyer(workspaceId, id, { status: 'INACTIVE' });
  }

  @RequirePermission('buyer:update')
  @Post(':id/activate')
  @RequireResourceScope('buyer', 'id')
  activate(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
  ) {
    return this.buyersService.updateBuyer(workspaceId, id, { status: 'ACTIVE' });
  }

  @Put(':id')
  @RequirePermission('buyer:update')
  @RequireResourceScope('buyer', 'id')
  update(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @Body() body: { name?: string; destinationNumber?: string; timeout?: number; status?: string },
  ) {
    return this.buyersService.updateBuyer(workspaceId, id, body);
  }
}
