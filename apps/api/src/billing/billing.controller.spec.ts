import { Test, TestingModule } from '@nestjs/testing';
import { BillingController } from './billing.controller.js';
import { BillingService } from './billing.service.js';
import { WalletService } from './wallet.service.js';
import { MockPaymentProvider } from './mock-payment.provider.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { WorkspaceRolesGuard } from '../authorization/workspace-roles.guard.js';
import { PermissionsGuard } from '../authorization/permissions.guard.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ForbiddenException } from '@nestjs/common';
import { vi, describe, it, expect, beforeEach } from 'vitest';

describe('BillingController', () => {
  let controller: BillingController;
  let billingService: BillingService;
  let walletService: WalletService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BillingController],
      providers: [
        {
          provide: BillingService,
          useValue: {
            getBillingState: vi.fn().mockResolvedValue({ status: 'ok' }),
            getBalance: vi.fn().mockResolvedValue({ balance: 1000 }),
            createCheckoutSession: vi
              .fn()
              .mockResolvedValue({ url: 'checkout' }),
            createPortalSession: vi.fn().mockResolvedValue({ url: 'portal' }),
            handleWebhook: vi.fn(),
          },
        },
        {
          provide: WalletService,
          useValue: {
            getTransactions: vi.fn().mockResolvedValue([]),
          },
        },
        { provide: MockPaymentProvider, useValue: {} },
        {
          provide: PrismaService,
          useValue: {
            workspaceMember: {
              findUnique: vi.fn().mockResolvedValue(null),
            },
          },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(WorkspaceRolesGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<BillingController>(BillingController);
    billingService = module.get<BillingService>(BillingService);
    walletService = module.get<WalletService>(WalletService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('should get billing state for internal user', async () => {
    const req = { params: { workspaceId: 'ws-1' }, user: { userId: 'user-admin' } };
    vi.spyOn(prisma.workspaceMember, 'findUnique').mockResolvedValue({
      id: 'member-1',
      workspace_id: 'ws-1',
      user_id: 'user-admin',
      role: 'ADMIN',
      participant_type: null,
    } as any);

    await controller.getBillingState(req, 'ws-1');
    expect(billingService.getBillingState).toHaveBeenCalledWith('ws-1');
  });

  it('should create checkout session', async () => {
    const req = { params: { workspaceId: 'ws-1' }, user: { userId: 'user-owner' } };
    const body = { planId: 'p-1', returnUrl: 'url' };
    const res = await controller.createCheckout(req, 'ws-1', body);
    expect(res).toEqual({ url: 'checkout' });
    expect(billingService.createCheckoutSession).toHaveBeenCalledWith(
      'ws-1',
      'p-1',
      'url',
    );
  });

  it('should create portal session', async () => {
    const req = { params: { workspaceId: 'ws-1' }, user: { userId: 'user-owner' } };
    const body = { returnUrl: 'url' };
    const res = await controller.createPortal(req, 'ws-1', body);
    expect(res).toEqual({ url: 'portal' });
    expect(billingService.createPortalSession).toHaveBeenCalledWith(
      'ws-1',
      'url',
    );
  });

  it('should handle webhook', async () => {
    const req = { rawBody: Buffer.from('test') };
    const res = await controller.handleWebhook(req, 'sig');
    expect(res).toEqual({ received: true });
    expect(billingService.handleWebhook).toHaveBeenCalledWith(
      'sig',
      req.rawBody,
    );
  });

  it('should reject webhook without signature', async () => {
    const req = { rawBody: Buffer.from('test') };
    const res = await controller.handleWebhook(req, '');
    expect(res).toEqual({ received: false });
  });

  describe('Finding C (P1): Workspace Billing & Wallet Isolation for Participants', () => {
    const buyerReq = { params: { workspaceId: 'ws-1' }, user: { userId: 'user-buyer-1' } };
    const vendorReq = { params: { workspaceId: 'ws-1' }, user: { userId: 'user-vendor-1' } };

    it('should deny Buyer participant from accessing billing state', async () => {
      vi.spyOn(prisma.workspaceMember, 'findUnique').mockResolvedValue({
        id: 'member-buyer-1',
        workspace_id: 'ws-1',
        user_id: 'user-buyer-1',
        role: 'MEMBER',
        participant_type: 'BUYER',
        buyer_id: 'buyer-1',
      } as any);

      await expect(
        controller.getBillingState(buyerReq, 'ws-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should deny Buyer participant from accessing wallet balance', async () => {
      vi.spyOn(prisma.workspaceMember, 'findUnique').mockResolvedValue({
        id: 'member-buyer-1',
        workspace_id: 'ws-1',
        user_id: 'user-buyer-1',
        role: 'MEMBER',
        participant_type: 'BUYER',
        buyer_id: 'buyer-1',
      } as any);

      await expect(
        controller.getBalance(buyerReq, 'ws-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should deny Buyer participant from accessing wallet transactions', async () => {
      vi.spyOn(prisma.workspaceMember, 'findUnique').mockResolvedValue({
        id: 'member-buyer-1',
        workspace_id: 'ws-1',
        user_id: 'user-buyer-1',
        role: 'MEMBER',
        participant_type: 'BUYER',
        buyer_id: 'buyer-1',
      } as any);

      await expect(
        controller.getWalletTransactions(buyerReq, 'ws-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should deny Vendor participant from accessing billing state', async () => {
      vi.spyOn(prisma.workspaceMember, 'findUnique').mockResolvedValue({
        id: 'member-vendor-1',
        workspace_id: 'ws-1',
        user_id: 'user-vendor-1',
        role: 'MEMBER',
        participant_type: 'VENDOR',
        vendor_id: 'vendor-1',
      } as any);

      await expect(
        controller.getBillingState(vendorReq, 'ws-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should deny Vendor participant from accessing wallet balance', async () => {
      vi.spyOn(prisma.workspaceMember, 'findUnique').mockResolvedValue({
        id: 'member-vendor-1',
        workspace_id: 'ws-1',
        user_id: 'user-vendor-1',
        role: 'MEMBER',
        participant_type: 'VENDOR',
        vendor_id: 'vendor-1',
      } as any);

      await expect(
        controller.getBalance(vendorReq, 'ws-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should deny Vendor participant from accessing wallet transactions', async () => {
      vi.spyOn(prisma.workspaceMember, 'findUnique').mockResolvedValue({
        id: 'member-vendor-1',
        workspace_id: 'ws-1',
        user_id: 'user-vendor-1',
        role: 'MEMBER',
        participant_type: 'VENDOR',
        vendor_id: 'vendor-1',
      } as any);

      await expect(
        controller.getWalletTransactions(vendorReq, 'ws-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should allow Owner to view billing state, balance, and transactions', async () => {
      const ownerReq = { params: { workspaceId: 'ws-1' }, user: { userId: 'user-owner' } };
      vi.spyOn(prisma.workspaceMember, 'findUnique').mockResolvedValue({
        id: 'member-owner',
        workspace_id: 'ws-1',
        user_id: 'user-owner',
        role: 'OWNER',
        participant_type: null,
      } as any);

      const state = await controller.getBillingState(ownerReq, 'ws-1');
      expect(state).toEqual({ status: 'ok' });

      const bal = await controller.getBalance(ownerReq, 'ws-1');
      expect(bal).toEqual({ balance: 1000 });

      const txs = await controller.getWalletTransactions(ownerReq, 'ws-1');
      expect(txs).toEqual([]);
    });

    it('should allow internal MEMBER with billing access to view billing state', async () => {
      const internalMemberReq = { params: { workspaceId: 'ws-1' }, user: { userId: 'user-internal' } };
      vi.spyOn(prisma.workspaceMember, 'findUnique').mockResolvedValue({
        id: 'member-internal',
        workspace_id: 'ws-1',
        user_id: 'user-internal',
        role: 'MEMBER',
        participant_type: null, // Internal member, not buyer or vendor
      } as any);

      const state = await controller.getBillingState(internalMemberReq, 'ws-1');
      expect(state).toEqual({ status: 'ok' });
    });
  });
});
