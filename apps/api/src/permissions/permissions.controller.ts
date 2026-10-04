import { Controller, Get, Put, Delete, Param, Body, Query, UseGuards, Req } from '@nestjs/common';
import { PermissionsService } from './permissions.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';

@UseGuards(JwtAuthGuard)
@Controller('workspaces/:workspaceId/permissions')
export class PermissionsController {
  constructor(private readonly permissionsService: PermissionsService) {}

  @Get()
  async getAllPermissions() {
    return this.permissionsService.getAllPermissions();
  }

  @Get('members/:memberId')
  async getMemberPermissions(
    @Param('workspaceId') workspaceId: string,
    @Param('memberId') memberId: string
  ) {
    return this.permissionsService.getMemberPermissions(workspaceId, memberId);
  }

  @Put('members/:memberId/:permissionKey')
  async assignPermission(
    @Param('workspaceId') workspaceId: string,
    @Param('memberId') memberId: string,
    @Param('permissionKey') permissionKey: string,
    @Body() body: any,
    @Req() req: any
  ) {
    return this.permissionsService.assignPermission(
      workspaceId, 
      req.user.userId, 
      memberId, 
      permissionKey,
      body?.scopeType,
      body?.resourceId
    );
  }

  @Delete('members/:memberId/:permissionKey')
  async removePermission(
    @Param('workspaceId') workspaceId: string,
    @Param('memberId') memberId: string,
    @Param('permissionKey') permissionKey: string,
    @Query('scopeType') scopeType: string,
    @Query('resourceId') resourceId: string,
    @Req() req: any
  ) {
    return this.permissionsService.removePermission(
      workspaceId, 
      req.user.userId, 
      memberId, 
      permissionKey,
      scopeType,
      resourceId
    );
  }
}

