import { Controller, Get, Post, Param, Body, UseGuards } from '@nestjs/common';
import { BuyersService } from './buyers.service.js';
import { WorkspaceRolesGuard } from '../authorization/workspace-roles.guard.js';
import { RequireWorkspaceRoles } from '../authorization/workspace-roles.decorator.js';
import { WorkspaceRole } from '@prisma/client';

@Controller('workspaces/:workspaceId/buyers')
@UseGuards(WorkspaceRolesGuard)
@RequireWorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN)
export class BuyersController {
  constructor(private readonly buyersService: BuyersService) {}

  @Get()
  list(@Param('workspaceId') workspaceId: string) {
    return this.buyersService.listBuyers(workspaceId);
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
}
