import { Controller, Get, Post, Put, Param, Body, Query, UseGuards, Request } from '@nestjs/common';
import { VendorsService } from './vendors.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { WorkspaceRolesGuard } from '../authorization/workspace-roles.guard.js';
import { PermissionsGuard } from '../authorization/permissions.guard.js';
import { RequirePermission, RequireResourceScope } from '../authorization/permissions.decorator.js';

@Controller('workspaces/:workspaceId/vendors')
@UseGuards(JwtAuthGuard, WorkspaceRolesGuard, PermissionsGuard)
export class VendorsController {
  constructor(private readonly vendorsService: VendorsService) {}

  @Get()
  @RequirePermission('vendor:read')
  list(
    @Param('workspaceId') workspaceId: string,
    @Request() req: any,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.vendorsService.listVendors(workspaceId, req.user?.userId, {
      search,
      status,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  @Get(':id')
  @RequirePermission('vendor:read')
  @RequireResourceScope('vendor', 'id')
  get(@Param('workspaceId') workspaceId: string, @Param('id') id: string) {
    return this.vendorsService.getVendor(workspaceId, id);
  }

  @Post()
  @RequirePermission('vendor:create')
  create(
    @Param('workspaceId') workspaceId: string,
    @Body() body: { name: string },
  ) {
    return this.vendorsService.createVendor(workspaceId, body.name);
  }

  @Put(':id')
  @RequirePermission('vendor:update')
  @RequireResourceScope('vendor', 'id')
  update(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @Body() body: { name?: string; status?: string },
  ) {
    return this.vendorsService.updateVendor(workspaceId, id, body);
  }

  @Post(':id/archive')
  @RequirePermission('vendor:archive')
  @RequireResourceScope('vendor', 'id')
  archive(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
  ) {
    return this.vendorsService.updateVendor(workspaceId, id, { status: 'INACTIVE' });
  }

  @Post(':id/activate')
  @RequirePermission('vendor:update')
  @RequireResourceScope('vendor', 'id')
  activate(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
  ) {
    return this.vendorsService.updateVendor(workspaceId, id, { status: 'ACTIVE' });
  }
}
