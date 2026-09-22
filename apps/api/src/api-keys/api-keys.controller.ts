import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiKeysService } from './api-keys.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { WorkspaceRolesGuard } from '../authorization/workspace-roles.guard.js';
import { RequireWorkspaceRoles } from '../authorization/workspace-roles.decorator.js';
import { WorkspaceRole } from '@prisma/client';

@Controller('workspaces/:workspaceId/api-keys')
@UseGuards(JwtAuthGuard, WorkspaceRolesGuard)
export class ApiKeysController {
  constructor(private readonly apiKeysService: ApiKeysService) {}

  @Get()
  @RequireWorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN)
  async listKeys(@Param('workspaceId') workspaceId: string) {
    return this.apiKeysService.listApiKeys(workspaceId);
  }

  @Post()
  @RequireWorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN)
  async createKey(
    @Param('workspaceId') workspaceId: string,
    @Body('name') name: string,
    @Req() req: any,
  ) {
    return this.apiKeysService.createApiKey(workspaceId, req.user.userId, name);
  }

  @Delete(':id')
  @RequireWorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN)
  async revokeKey(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
  ) {
    return this.apiKeysService.revokeApiKey(workspaceId, id);
  }
}
