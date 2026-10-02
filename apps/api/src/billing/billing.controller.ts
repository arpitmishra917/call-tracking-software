import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Req,
  UseGuards,
  Headers,
  RawBodyRequest,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { BillingService } from './billing.service.js';
import { WalletService } from './wallet.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { WorkspaceRolesGuard } from '../authorization/workspace-roles.guard.js';
import { RequireWorkspaceRoles } from '../authorization/workspace-roles.decorator.js';
import { WorkspaceRole } from '@prisma/client';
import type { Request } from 'express';
import { randomUUID } from 'crypto';

@Controller()
export class BillingController {
  constructor(
    private readonly billingService: BillingService,
    private readonly walletService: WalletService,
  ) {}

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

  @Get('workspaces/:workspaceId/billing/balance')
  @UseGuards(JwtAuthGuard, WorkspaceRolesGuard)
  async getBalance(@Param('workspaceId') workspaceId: string) {
    return this.billingService.getBalance(workspaceId);
  }

  @Get('workspaces/:workspaceId/billing/wallet/transactions')
  @UseGuards(JwtAuthGuard, WorkspaceRolesGuard)
  @RequireWorkspaceRoles(
    WorkspaceRole.OWNER,
    WorkspaceRole.ADMIN,
    WorkspaceRole.MEMBER,
    WorkspaceRole.VIEWER,
  )
  async getWalletTransactions(@Param('workspaceId') workspaceId: string) {
    return this.walletService.getTransactions(workspaceId);
  }

  @Post('workspaces/:workspaceId/billing/wallet/mock-topup')
  @UseGuards(JwtAuthGuard, WorkspaceRolesGuard)
  @RequireWorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN)
  async mockTopUp(@Param('workspaceId') workspaceId: string, @Body() body: any) {
    if (
      process.env.NODE_ENV === 'production' ||
      process.env.WALLET_MOCK_PAYMENTS_ENABLED !== 'true'
    ) {
      throw new ForbiddenException('Mock payments are only allowed in development.');
    }

    const amountMinor = parseInt(body.amountMinor, 10);
    if (isNaN(amountMinor) || amountMinor < 2500) {
      throw new BadRequestException('Minimum mock top-up is $25.00 (2500 minor units).');
    }

    return this.walletService.creditWallet({
      workspaceId,
      amountMinor,
      referenceType: 'MOCK_PAYMENT',
      referenceId: randomUUID(),
      idempotencyKey: body.idempotencyKey || randomUUID(),
      description: 'Mock development payment top-up',
    });
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
