import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PhoneNumbersService } from './phone-numbers.service.js';
import { WorkspaceRolesGuard } from '../authorization/workspace-roles.guard.js';
import { RequireWorkspaceRoles } from '../authorization/workspace-roles.decorator.js';
import { WorkspaceRole } from '@prisma/client';

@Controller('workspaces/:workspaceId/phone-numbers')
@UseGuards(WorkspaceRolesGuard)
export class PhoneNumbersController {
  constructor(private readonly phoneNumbersService: PhoneNumbersService) {}

  @Get()
  @RequireWorkspaceRoles(
    WorkspaceRole.OWNER,
    WorkspaceRole.ADMIN,
    WorkspaceRole.MEMBER,
    WorkspaceRole.VIEWER,
  )
  async listNumbers(@Param('workspaceId') workspaceId: string) {
    return this.phoneNumbersService.listWorkspaceNumbers(workspaceId);
  }

  @Get('search')
  @RequireWorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN)
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

  @Put(':id')
  @RequireWorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN)
  async updateNumber(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @Body('name') name: string,
  ) {
    return this.phoneNumbersService.updateNumber(workspaceId, id, name);
  }

  @Delete(':id')
  @RequireWorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN)
  async releaseNumber(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
  ) {
    return this.phoneNumbersService.releaseNumber(workspaceId, id);
  }
}
