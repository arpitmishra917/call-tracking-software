import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { BillingService } from '../billing/billing.service.js';
import { ApiKeyAuthGuard } from '../auth/api-key.guard.js';
import { WorkspaceRolesGuard } from '../authorization/workspace-roles.guard.js';
import { RequireWorkspaceRoles } from '../authorization/workspace-roles.decorator.js';
import { PermissionsGuard } from '../authorization/permissions.guard.js';
import { RequirePermission } from '../authorization/permissions.decorator.js';
import { WorkspaceRole } from '@prisma/client';

@Controller('api/v1/workspaces/:workspaceId/billing')
@UseGuards(ApiKeyAuthGuard, WorkspaceRolesGuard, PermissionsGuard)
export class PublicBillingController {
  constructor(private readonly billingService: BillingService) {}

  @Get()
  @RequirePermission('billing:read')
  @RequireWorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN)
  async getBillingStatus(@Param('workspaceId') workspaceId: string) {
    return this.billingService.getBillingState(workspaceId);
  }
}
