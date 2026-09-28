import { Controller, Query, Get, Post, Put, Param, Body, UseGuards } from '@nestjs/common';
import { BuyersService } from './buyers.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { WorkspaceRolesGuard } from '../authorization/workspace-roles.guard.js';
import { RequireWorkspaceRoles } from '../authorization/workspace-roles.decorator.js';
import { WorkspaceRole } from '@prisma/client';

@Controller('workspaces/:workspaceId/buyers')
@UseGuards(JwtAuthGuard, WorkspaceRolesGuard)
@RequireWorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN)
export class BuyersController {
  constructor(private readonly buyersService: BuyersService) {}

  @Get()
  list(
    @Param('workspaceId') workspaceId: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string
  ) {
    return this.buyersService.listBuyers(workspaceId, {
      search,
      status,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined
    });
  }

  @Get(':id')
  get(@Param('workspaceId') workspaceId: string, @Param('id') id: string) {
    return this.buyersService.getBuyer(workspaceId, id);
  }

  @Post()
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

  @Post(':id/archive')
  archive(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
  ) {
    return this.buyersService.updateBuyer(workspaceId, id, { status: 'INACTIVE' });
  }

  @Post(':id/activate')
  activate(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
  ) {
    return this.buyersService.updateBuyer(workspaceId, id, { status: 'ACTIVE' });
  }

  @Put(':id')
  update(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @Body() body: { name?: string; destinationNumber?: string; timeout?: number; status?: string },
  ) {
    return this.buyersService.updateBuyer(workspaceId, id, body);
  }
}
