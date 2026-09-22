import {
  Controller,
  Get,
  Post,
  Body,
  Req,
  UseGuards,
  Headers,
  RawBodyRequest,
} from '@nestjs/common';
import { BillingService } from './billing.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { WorkspaceRolesGuard } from '../authorization/workspace-roles.guard.js';
import { RequireWorkspaceRoles } from '../authorization/workspace-roles.decorator.js';
import { WorkspaceRole } from '@prisma/client';
import type { Request } from 'express';

@Controller()
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @Get('workspaces/:workspaceId/billing')
  @UseGuards(JwtAuthGuard, WorkspaceRolesGuard)
  @RequireWorkspaceRoles(
    WorkspaceRole.OWNER,
    WorkspaceRole.ADMIN,
    WorkspaceRole.MEMBER,
    WorkspaceRole.VIEWER,
  )
  getBillingState(@Req() req: any) {
    return this.billingService.getBillingState(req.params.workspaceId);
  }

  @Post('workspaces/:workspaceId/billing/checkout')
  @UseGuards(JwtAuthGuard, WorkspaceRolesGuard)
  @RequireWorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN)
  createCheckout(
    @Req() req: any,
    @Body() body: { planId: string; returnUrl: string },
  ) {
    return this.billingService.createCheckoutSession(
      req.params.workspaceId,
      body.planId,
      body.returnUrl,
    );
  }

  @Post('workspaces/:workspaceId/billing/portal')
  @UseGuards(JwtAuthGuard, WorkspaceRolesGuard)
  @RequireWorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN)
  createPortal(@Req() req: any, @Body() body: { returnUrl: string }) {
    return this.billingService.createPortalSession(
      req.params.workspaceId,
      body.returnUrl,
    );
  }

  @Post('webhooks/stripe')
  async handleWebhook(
    @Req() req: any,
    @Headers('stripe-signature') signature: string,
  ) {
    if (!signature) {
      return { received: false };
    }
    const rawBody = req.rawBody;
    if (!rawBody) {
      return { received: false };
    }
    await this.billingService.handleWebhook(signature, rawBody);
    return { received: true };
  }
}
