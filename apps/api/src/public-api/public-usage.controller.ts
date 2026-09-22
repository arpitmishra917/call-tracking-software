import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiKeyAuthGuard } from '../auth/api-key.guard.js';
import { WorkspaceRolesGuard } from '../authorization/workspace-roles.guard.js';
import { RequireWorkspaceRoles } from '../authorization/workspace-roles.decorator.js';
import { WorkspaceRole } from '@prisma/client';
import { BillingService } from '../billing/billing.service.js';

@Controller('api/v1/workspaces/:workspaceId/usage')
@UseGuards(ApiKeyAuthGuard, WorkspaceRolesGuard)
export class PublicUsageController {
  constructor(private readonly billingService: BillingService) {}

  @Get()
  @RequireWorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN)
  async getUsage(@Param('workspaceId') workspaceId: string) {
    const billingState = await this.billingService.getBillingState(workspaceId);
    return billingState.usage;
  }
}
