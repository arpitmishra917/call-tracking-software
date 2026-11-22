import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  Req,
  UseGuards,
  Headers,
  RawBodyRequest,
  ForbiddenException,
} from '@nestjs/common';
import { BillingService } from './billing.service.js';
import { WalletService } from './wallet.service.js';
import { MockPaymentProvider } from './mock-payment.provider.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { WorkspaceRolesGuard } from '../authorization/workspace-roles.guard.js';
import { PermissionsGuard } from '../authorization/permissions.guard.js';
import { RequireWorkspaceRoles } from '../authorization/workspace-roles.decorator.js';
import { RequirePermission } from '../authorization/permissions.decorator.js';
import { WorkspaceRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import type { Request } from 'express';
import {
  MockTopUpDto,
  CreateCheckoutSessionDto,
  CreatePortalSessionDto,
} from './dto/billing.dto.js';

@Controller()
export class BillingController {
  constructor(
    private readonly billingService: BillingService,
    private readonly walletService: WalletService,
    private readonly mockPaymentProvider: MockPaymentProvider,
    private readonly prisma: PrismaService,
  ) {}

  private async assertNotParticipant(workspaceId: string, userId?: string) {
    if (!userId) return;
    const member = await this.prisma.workspaceMember.findUnique({
      where: {
        workspace_id_user_id: {
          workspace_id: workspaceId,
          user_id: userId,
        },
      },
    });

    if (member?.participant_type === 'BUYER' || member?.participant_type === 'VENDOR') {
      throw new ForbiddenException('Participants do not have access to billing resources');
    }
  }

  @Get('workspaces/:workspaceId/billing')
  @UseGuards(JwtAuthGuard, WorkspaceRolesGuard, PermissionsGuard)
  @RequirePermission('billing:read')
  @RequireWorkspaceRoles(
    WorkspaceRole.OWNER,
    WorkspaceRole.ADMIN,
    WorkspaceRole.MEMBER,
    WorkspaceRole.VIEWER,
  )
  async getBillingState(@Req() req: any, @Param('workspaceId') workspaceId: string) {
    const wsId = workspaceId || req.params.workspaceId;
    await this.assertNotParticipant(wsId, req.user?.userId);
    return this.billingService.getBillingState(wsId);
  }

  @Get('workspaces/:workspaceId/billing/balance')
  @UseGuards(JwtAuthGuard, WorkspaceRolesGuard, PermissionsGuard)
  @RequirePermission('billing:read')
  @RequireWorkspaceRoles(
    WorkspaceRole.OWNER,
    WorkspaceRole.ADMIN,
    WorkspaceRole.MEMBER,
    WorkspaceRole.VIEWER,
  )
  async getBalance(@Req() req: any, @Param('workspaceId') workspaceId: string) {
    const wsId = workspaceId || req.params.workspaceId;
    await this.assertNotParticipant(wsId, req.user?.userId);
    return this.billingService.getBalance(wsId);
  }

  @Get('workspaces/:workspaceId/billing/wallet/transactions')
  @UseGuards(JwtAuthGuard, WorkspaceRolesGuard, PermissionsGuard)
  @RequirePermission('billing:read')
  @RequireWorkspaceRoles(
    WorkspaceRole.OWNER,
    WorkspaceRole.ADMIN,
    WorkspaceRole.MEMBER,
    WorkspaceRole.VIEWER,
  )
  async getWalletTransactions(
    @Req() req: any,
    @Param('workspaceId') workspaceId: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const wsId = workspaceId || req.params.workspaceId;
    await this.assertNotParticipant(wsId, req.user?.userId);
    const parsedLimit = limit ? Math.min(100, Math.max(1, parseInt(limit, 10))) : 50;
    const parsedOffset = offset ? Math.max(0, parseInt(offset, 10)) : 0;
    return this.walletService.getTransactions(wsId, parsedLimit, parsedOffset);
  }

  @Post('workspaces/:workspaceId/billing/wallet/mock-topup')
  @UseGuards(JwtAuthGuard, WorkspaceRolesGuard, PermissionsGuard)
  @RequirePermission('billing:manage')
  @RequireWorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN)
  async mockTopUp(@Req() req: any, @Param('workspaceId') workspaceId: string, @Body() body: MockTopUpDto) {
    const wsId = workspaceId || req.params.workspaceId;
    await this.assertNotParticipant(wsId, req.user?.userId);
    return this.mockPaymentProvider.createWalletTopUp(
      wsId,
      body.amountMinor,
      body.returnUrl || '',
    );
  }

  @Post('workspaces/:workspaceId/billing/checkout')
  @UseGuards(JwtAuthGuard, WorkspaceRolesGuard, PermissionsGuard)
  @RequirePermission('billing:manage')
  @RequireWorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN)
  async createCheckout(
    @Req() req: any,
    @Param('workspaceId') workspaceId: string,
    @Body() body: CreateCheckoutSessionDto,
  ) {
    const wsId = workspaceId || req.params.workspaceId;
    await this.assertNotParticipant(wsId, req.user?.userId);
    return this.billingService.createCheckoutSession(
      wsId,
      body.planId,
      body.returnUrl,
    );
  }

  @Post('workspaces/:workspaceId/billing/portal')
  @UseGuards(JwtAuthGuard, WorkspaceRolesGuard, PermissionsGuard)
  @RequirePermission('billing:manage')
  @RequireWorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN)
  async createPortal(
    @Req() req: any,
    @Param('workspaceId') workspaceId: string,
    @Body() body: CreatePortalSessionDto,
  ) {
    const wsId = workspaceId || req.params.workspaceId;
    await this.assertNotParticipant(wsId, req.user?.userId);
    return this.billingService.createPortalSession(
      wsId,
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
