import { Controller, Get, Post, Param, Body, UseGuards } from '@nestjs/common';
import { VendorsService } from './vendors.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { WorkspaceRolesGuard } from '../authorization/workspace-roles.guard.js';
import { RequireWorkspaceRoles } from '../authorization/workspace-roles.decorator.js';
import { WorkspaceRole } from '@prisma/client';

@Controller('workspaces/:workspaceId/vendors')
@UseGuards(JwtAuthGuard, WorkspaceRolesGuard)
@RequireWorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN)
export class VendorsController {
  constructor(private readonly vendorsService: VendorsService) {}

  @Get()
  list(@Param('workspaceId') workspaceId: string) {
    return this.vendorsService.listVendors(workspaceId);
  }

  @Get(':id')
  get(@Param('workspaceId') workspaceId: string, @Param('id') id: string) {
    return this.vendorsService.getVendor(workspaceId, id);
  }

  @Post()
  create(
    @Param('workspaceId') workspaceId: string,
    @Body() body: { name: string },
  ) {
    return this.vendorsService.createVendor(workspaceId, body.name);
  }
}
