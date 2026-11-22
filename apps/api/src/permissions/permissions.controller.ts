import { Controller, Get, Put, Delete, Param, Body, Query, UseGuards, Req } from '@nestjs/common';
import { PermissionsService } from './permissions.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { WorkspaceRolesGuard } from '../authorization/workspace-roles.guard.js';
import { PermissionsGuard } from '../authorization/permissions.guard.js';
import { RequireWorkspaceRoles } from '../authorization/workspace-roles.decorator.js';
import { RequirePermission } from '../authorization/permissions.decorator.js';
import { WorkspaceRole } from '@prisma/client';

@Controller('workspaces/:workspaceId/permissions')
@UseGuards(JwtAuthGuard, WorkspaceRolesGuard, PermissionsGuard)
export class PermissionsController {
  constructor(private readonly permissionsService: PermissionsService) {}

  @Get()
  @RequireWorkspaceRoles(
    WorkspaceRole.OWNER,
    WorkspaceRole.ADMIN,
    WorkspaceRole.MEMBER,
    WorkspaceRole.VIEWER,
  )
  async getAllPermissions() {
    return this.permissionsService.getAllPermissions();
  }

  @Get('members/:memberId')
  @RequireWorkspaceRoles(
    WorkspaceRole.OWNER,
    WorkspaceRole.ADMIN,
    WorkspaceRole.MEMBER,
    WorkspaceRole.VIEWER,
  )
  @RequirePermission('member:read')
  async getMemberPermissions(
    @Param('workspaceId') workspaceId: string,
    @Param('memberId') memberId: string
  ) {
    return this.permissionsService.getMemberPermissions(workspaceId, memberId);
  }

  @Put('members/:memberId/:permissionKey')
  @RequireWorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN)
  @RequirePermission('member:update')
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
  @RequireWorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN)
  @RequirePermission('member:update')
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

