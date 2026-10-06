import { Controller, Get, Post, Param, Body, UseGuards, Request } from '@nestjs/common';
import { VendorsService } from './vendors.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { PermissionsGuard } from '../authorization/permissions.guard.js';
import { RequirePermission, RequireResourceScope } from '../authorization/permissions.decorator.js';

@Controller('workspaces/:workspaceId/vendors')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class VendorsController {
  constructor(private readonly vendorsService: VendorsService) {}

  @Get()
  @RequirePermission('vendor:read')
  list(@Param('workspaceId') workspaceId: string, @Request() req: any) {
    return this.vendorsService.listVendors(workspaceId, req.user.userId);
  }

  @Get(':id')
  @RequirePermission('vendor:read')
  @RequireResourceScope('vendor', 'id')
  get(@Param('workspaceId') workspaceId: string, @Param('id') id: string) {
    return this.vendorsService.getVendor(workspaceId, id);
  }

  @Post()
  @RequirePermission('vendor:write')
  create(
    @Param('workspaceId') workspaceId: string,
    @Body() body: { name: string },
  ) {
    return this.vendorsService.createVendor(workspaceId, body.name);
  }
}
