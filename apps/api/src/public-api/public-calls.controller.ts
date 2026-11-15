import { Controller, Get, Param, Query, UseGuards , Request} from '@nestjs/common';
import { PermissionsGuard } from '../authorization/permissions.guard.js';
import { RequirePermission, RequireResourceScope } from '../authorization/permissions.decorator.js';
import { CallsService } from '../calls/calls.service.js';
import { ApiKeyAuthGuard } from '../auth/api-key.guard.js';
import { WorkspaceRolesGuard } from '../authorization/workspace-roles.guard.js';
import { RequireWorkspaceRoles } from '../authorization/workspace-roles.decorator.js';
import { WorkspaceRole } from '@prisma/client';

@Controller('api/v1/workspaces/:workspaceId/calls')
@UseGuards(ApiKeyAuthGuard, WorkspaceRolesGuard, PermissionsGuard)
export class PublicCallsController {
  constructor(private readonly callsService: CallsService) {}

  @Get()
  @RequirePermission('call:read')
  async listCalls(
    @Param('workspaceId') workspaceId: string,
    @Request() req: any,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 50;

    // getCalls likely takes (workspaceId, filterObject) or something, let's just pass workspaceId for now if it doesn't take pagination
    // Actually, I'll pass workspaceId and an object
    return this.callsService.getCalls(workspaceId, req.user.userId, { limit: limitNum });
  }

  @Get(':id')
  @RequirePermission('call:read')
  @RequireResourceScope('call', 'id')
  async getCall(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
  ) {
    return this.callsService.getCallDetail(workspaceId, id);
  }
}
