import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { WebhooksService } from './webhooks.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { WorkspaceRolesGuard } from '../authorization/workspace-roles.guard.js';
import { RequireWorkspaceRoles } from '../authorization/workspace-roles.decorator.js';
import { PermissionsGuard } from '../authorization/permissions.guard.js';
import { RequirePermission } from '../authorization/permissions.decorator.js';
import { WorkspaceRole } from '@prisma/client';

@Controller('workspaces/:workspaceId/webhooks')
@UseGuards(JwtAuthGuard, WorkspaceRolesGuard, PermissionsGuard)
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Get()
  @RequireWorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN)
  @RequirePermission('webhook:read')
  async listWebhooks(@Param('workspaceId') workspaceId: string) {
    return this.webhooksService.getWebhooks(workspaceId);
  }

  @Post()
  @RequireWorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN)
  @RequirePermission('webhook:manage')
  async createWebhook(
    @Param('workspaceId') workspaceId: string,
    @Body('url') url: string,
  ) {
    return this.webhooksService.createWebhook(workspaceId, url);
  }

  @Delete(':id')
  @RequireWorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN)
  @RequirePermission('webhook:manage')
  async deleteWebhook(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
  ) {
    return this.webhooksService.deleteWebhook(workspaceId, id);
  }
}
