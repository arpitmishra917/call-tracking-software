import { PermissionsGuard } from '../authorization/permissions.guard.js';
import { RequirePermission, RequireResourceScope } from '../authorization/permissions.decorator.js';
import { Controller, Get, Post, Put, Patch, Delete, Param, Body, Query, UseGuards, Request } from '@nestjs/common';
import { PhoneNumbersService } from './phone-numbers.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { WorkspaceRolesGuard } from '../authorization/workspace-roles.guard.js';
import { RequireWorkspaceRoles } from '../authorization/workspace-roles.decorator.js';
import { WorkspaceRole } from '@prisma/client';

@Controller('workspaces/:workspaceId/phone-numbers')
@UseGuards(JwtAuthGuard, WorkspaceRolesGuard, PermissionsGuard)
export class PhoneNumbersController {
  constructor(private readonly phoneNumbersService: PhoneNumbersService) {}

  @Get()
  @RequirePermission('phone_number:read')
  @RequireWorkspaceRoles(
    WorkspaceRole.OWNER,
    WorkspaceRole.ADMIN,
    WorkspaceRole.MEMBER,
    WorkspaceRole.VIEWER,
  )
  async listNumbers(
    @Param('workspaceId') workspaceId: string,
    @Request() req: any,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string
  ) {
    return this.phoneNumbersService.listWorkspaceNumbers(workspaceId, req.user.userId, {
      search,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined
    });
  }

  @Get('search')
  @RequireWorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN)
  async searchNumbers(
    @Param('workspaceId') workspaceId: string,
    @Query('countryCode') countryCode?: string,
    @Query('limit') limit?: string,
    @Query('numberType') numberType?: string,
    @Query('prefix') prefix?: string,
  ) {
    const limitNum = limit ? parseInt(limit, 10) : 5;
    return this.phoneNumbersService.searchAvailableNumbers(
      countryCode || 'US',
      limitNum,
      numberType,
      prefix,
    );
  }

  @Post()
  @RequirePermission('phone_number:create')
  @RequireWorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN)
  async provisionNumber(
    @Param('workspaceId') workspaceId: string,
    @Body('phoneNumber') phoneNumber: string,
    @Body('name') name?: string,
  ) {
    return this.phoneNumbersService.provisionNumber(
      workspaceId,
      phoneNumber,
      name,
    );
  }

  @Get(':id')
  @RequirePermission('phone_number:read')
  @RequireResourceScope('phone_number', 'id')
  @RequireWorkspaceRoles(
    WorkspaceRole.OWNER,
    WorkspaceRole.ADMIN,
    WorkspaceRole.MEMBER,
    WorkspaceRole.VIEWER,
  )
  async getNumber(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @Request() req: any,
  ) {
    return this.phoneNumbersService.getNumber(workspaceId, id, req?.user?.userId);
  }

  @RequirePermission('phone_number:manage')
  @Put(':id')
  @Patch(':id')
  @RequireResourceScope('phone_number', 'id')
  @RequireWorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN)
  async updateNumber(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @Body() body: { name?: string; vendorId?: string | null },
  ) {
    return this.phoneNumbersService.updateNumber(workspaceId, id, body);
  }

  @RequirePermission('phone_number:manage')
  @Delete(':id')
  @RequireResourceScope('phone_number', 'id')
  @RequireWorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN)
  async releaseNumber(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
  ) {
    return this.phoneNumbersService.releaseNumber(workspaceId, id);
  }
}
