import { Controller, Get, Post, Put, Delete, Param, Body, Query, UseGuards, Request } from '@nestjs/common';
import { PermissionsGuard } from '../authorization/permissions.guard.js';
import { RequirePermission, RequireResourceScope } from '../authorization/permissions.decorator.js';
import { PhoneNumbersService } from '../phone-numbers/phone-numbers.service.js';
import { ApiKeyAuthGuard } from '../auth/api-key.guard.js';
import { WorkspaceRolesGuard } from '../authorization/workspace-roles.guard.js';
import { RequireWorkspaceRoles } from '../authorization/workspace-roles.decorator.js';
import { WorkspaceRole } from '@prisma/client';

@Controller('api/v1/workspaces/:workspaceId/phone-numbers')
@UseGuards(ApiKeyAuthGuard, WorkspaceRolesGuard, PermissionsGuard)
export class PublicPhoneNumbersController {
  constructor(private readonly phoneNumbersService: PhoneNumbersService) {}

  @Get()
  @RequirePermission('phone_number:read')
  async listNumbers(
@Param('workspaceId') workspaceId: string,
@Request() req: any) {
    return this.phoneNumbersService.listWorkspaceNumbers(workspaceId, req.user.userId);
  }

  @Get('search')
  async searchNumbers(
    @Param('workspaceId') workspaceId: string,
    @Query('countryCode') countryCode?: string,
    @Query('limit') limit?: string,
  ) {
    const limitNum = limit ? parseInt(limit, 10) : 5;
    return this.phoneNumbersService.searchAvailableNumbers(
      countryCode || 'US',
      limitNum,
    );
  }

  @Post()
  @RequirePermission('phone_number:create')
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

  @Put(':id')
  async updateNumber(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @Body('name') name: string,
  ) {
    return this.phoneNumbersService.updateNumber(workspaceId, id, name);
  }

  @Delete(':id')
  async releaseNumber(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
  ) {
    return this.phoneNumbersService.releaseNumber(workspaceId, id);
  }
}
