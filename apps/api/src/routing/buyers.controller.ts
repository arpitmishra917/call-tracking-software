import { Controller, Query, Get, Post, Put, Param, Body, UseGuards, Request } from '@nestjs/common';
import { PermissionsGuard } from '../authorization/permissions.guard.js';
import { RequirePermission, RequireResourceScope } from '../authorization/permissions.decorator.js';
import { BuyersService } from './buyers.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { WorkspaceRolesGuard } from '../authorization/workspace-roles.guard.js';
import { RequireWorkspaceRoles } from '../authorization/workspace-roles.decorator.js';
import { WorkspaceRole } from '@prisma/client';
import { CreateBuyerDto, UpdateBuyerDto, ListBuyersQueryDto } from './dto/buyers.dto.js';

@Controller('workspaces/:workspaceId/buyers')
@UseGuards(JwtAuthGuard, WorkspaceRolesGuard, PermissionsGuard)
export class BuyersController {
  constructor(private readonly buyersService: BuyersService) {}

  @Get()
  @RequirePermission('buyer:read')
  list(
    @Param('workspaceId') workspaceId: string,
    @Request() req: any,
    @Query() query: ListBuyersQueryDto,
  ) {
    return this.buyersService.listBuyers(workspaceId, req.user.userId, {
      search: query.search,
      status: query.status,
      limit: query.limit,
      offset: query.offset,
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
    @Body() body: CreateBuyerDto,
  ) {
    const maxCalls =
      body.max_concurrent_calls !== undefined
        ? body.max_concurrent_calls
        : body.maxConcurrentCalls;
    return this.buyersService.createBuyer(
      workspaceId,
      body.name,
      body.email,
      body.destinationNumber,
      body.timeout,
      maxCalls,
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
    @Body() body: UpdateBuyerDto,
  ) {
    return this.buyersService.updateBuyer(workspaceId, id, body);
  }
}
