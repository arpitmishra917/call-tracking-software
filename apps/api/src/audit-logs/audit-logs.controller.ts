import { Controller, Get, Param, Query, UseGuards, Request } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { WorkspaceRolesGuard } from '../authorization/workspace-roles.guard.js';
import { PermissionsGuard } from '../authorization/permissions.guard.js';
import { RequirePermission } from '../authorization/permissions.decorator.js';
import { AuditLogsService } from './audit-logs.service.js';

@Controller('workspaces/:workspaceId/audit-logs')
@UseGuards(JwtAuthGuard, WorkspaceRolesGuard, PermissionsGuard)
@RequirePermission('audit_log:read')
export class AuditLogsController {
  constructor(private readonly auditLogsService: AuditLogsService) {}

  @Get()
  async getAuditLogs(
    @Param('workspaceId') workspaceId: string,
    @Request() req: any,
    @Query() query: any,
  ) {
    return this.auditLogsService.getAuditLogs(workspaceId, req.user.userId, query);
  }
}
