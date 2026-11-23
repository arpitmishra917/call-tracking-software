import { vi, describe, it, expect, beforeEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { BillingController } from '../../src/billing/billing.controller.js';
import { BillingService } from '../../src/billing/billing.service.js';
import { WalletService } from '../../src/billing/wallet.service.js';
import { MockPaymentProvider } from '../../src/billing/mock-payment.provider.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { JwtAuthGuard } from '../../src/auth/jwt-auth.guard.js';
import { WorkspaceRolesGuard } from '../../src/authorization/workspace-roles.guard.js';
import { PermissionsGuard } from '../../src/authorization/permissions.guard.js';
import { PermissionsService } from '../../src/permissions/permissions.service.js';
import { TransactionType } from '@prisma/client';

describe('Layer 5 Contract Regression: Billing & Wallet API Boundaries', () => {
  let controller: BillingController;
  let billingServiceMock: any;
  let walletServiceMock: any;
  let mockPaymentProviderMock: any;
  let prismaMock: any;

  const mockWorkspaceId = 'ws-contract-billing-1';
  const mockUserId = 'usr-contract-billing-1';

  beforeEach(async () => {
    billingServiceMock = {
      getBillingState: vi.fn(),
      getBalance: vi.fn(),
      createCheckoutSession: vi.fn(),
      createPortalSession: vi.fn(),
    };

    walletServiceMock = {
      getWallet: vi.fn(),
      getTransactions: vi.fn(),
      topUp: vi.fn(),
    };

    mockPaymentProviderMock = {
      createWalletTopUp: vi.fn(),
    };

    prismaMock = {
      workspaceMember: {
        findUnique: vi.fn(),
      },
      wallet: {
        findUnique: vi.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [BillingController],
      providers: [
        { provide: BillingService, useValue: billingServiceMock },
        { provide: WalletService, useValue: walletServiceMock },
        { provide: MockPaymentProvider, useValue: mockPaymentProviderMock },
        { provide: PrismaService, useValue: prismaMock },
        {
          provide: PermissionsService,
          useValue: {
            getPermissionsForUser: vi.fn().mockResolvedValue([{ key: 'billing:read', scope_type: 'ALL' }]),
            hasPermission: vi.fn().mockResolvedValue(true),
            hasResourceScope: vi.fn().mockResolvedValue(true),
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
  });

  describe('GET /workspaces/:workspaceId/billing Contract Boundaries', () => {
    it('returns billing state conforming to strict response contract', async () => {
      // Internal Member context (allowed)
      prismaMock.workspaceMember.findUnique.mockResolvedValue({
        id: 'mem-admin',
        workspace_id: mockWorkspaceId,
        user_id: mockUserId,
        role: 'ADMIN',
        participant_type: null,
      });

      const mockBillingState = {
        wallet: {
          id: 'wal-101',
          workspace_id: mockWorkspaceId,
          currency: 'USD',
          balance_micro: '50000000', // $50.00
          balance_display: '50.00',
          active_holds_micro: '1000000', // $1.00
          status: 'ACTIVE',
          updated_at: new Date(),
        },
        payment_methods: [],
        auto_recharge: {
          enabled: false,
          threshold_amount: 10,
          recharge_amount: 50,
        },
      };

      billingServiceMock.getBillingState.mockResolvedValue(mockBillingState);

      const response = await controller.getBillingState(
        { params: { workspaceId: mockWorkspaceId }, user: { userId: mockUserId } } as any,
        mockWorkspaceId,
      );

      expect(response).toHaveProperty('wallet');
      expect(response).toHaveProperty('payment_methods');
      expect(response).toHaveProperty('auto_recharge');

      const wallet = response.wallet;
      expect(wallet).toHaveProperty('id');
      expect(wallet).toHaveProperty('workspace_id');
      expect(wallet).toHaveProperty('currency');
      expect(wallet).toHaveProperty('balance_micro');
      expect(wallet).toHaveProperty('balance_display');
      expect(wallet).toHaveProperty('active_holds_micro');
      expect(wallet).toHaveProperty('status');

      expect(typeof wallet.id).toBe('string');
      expect(typeof wallet.currency).toBe('string');
      expect(wallet.status).toBe('ACTIVE');
    });

    it('rejects access to billing resources when participant_type is BUYER or VENDOR (403 Forbidden)', async () => {
      prismaMock.workspaceMember.findUnique.mockResolvedValue({
        id: 'mem-buyer',
        workspace_id: mockWorkspaceId,
        user_id: mockUserId,
        role: 'MEMBER',
        participant_type: 'BUYER', // Buyer restricted!
      });

      await expect(
        controller.getBillingState(
          { params: { workspaceId: mockWorkspaceId }, user: { userId: mockUserId } } as any,
          mockWorkspaceId,
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('GET /workspaces/:workspaceId/billing/wallet/transactions Contract Boundaries', () => {
    it('returns transactions conforming to { items, total } schema with exact field names', async () => {
      prismaMock.workspaceMember.findUnique.mockResolvedValue({
        id: 'mem-admin',
        workspace_id: mockWorkspaceId,
        user_id: mockUserId,
        role: 'OWNER',
        participant_type: null,
      });

      const mockTransactionsResult = {
        items: [
          {
            id: 'tx-101',
            wallet_id: 'wal-101',
            workspace_id: mockWorkspaceId,
            type: TransactionType.DEBIT,
            amount_micro: '2500000', // $2.50
            reference_type: 'CALL_SETTLEMENT',
            reference_id: 'call-101',
            created_at: new Date('2026-02-01T14:00:00Z'),
          },
        ],
        total: 1,
      };

      walletServiceMock.getTransactions.mockResolvedValue(mockTransactionsResult);

      const response = await controller.getWalletTransactions(
        { params: { workspaceId: mockWorkspaceId }, user: { userId: mockUserId } } as any,
        mockWorkspaceId,
        '20',
        '0',
      );

      expect(response).toHaveProperty('items');
      expect(response).toHaveProperty('total');
      expect(Array.isArray(response.items)).toBe(true);

      const tx = response.items[0];
      expect(tx).toHaveProperty('id');
      expect(tx).toHaveProperty('workspace_id');
      expect(tx).toHaveProperty('type');
      expect(tx).toHaveProperty('amount_micro');
      expect(tx).toHaveProperty('reference_type');
      expect(tx).toHaveProperty('reference_id');
      expect(tx.reference_type).toBe('CALL_SETTLEMENT');
    });
  });

  describe('POST /workspaces/:workspaceId/billing/wallet/mock-topup Request Boundary Validation', () => {
    it('executes mock topup and returns checkout/topup session response contract', async () => {
      prismaMock.workspaceMember.findUnique.mockResolvedValue({
        id: 'mem-owner',
        workspace_id: mockWorkspaceId,
        user_id: mockUserId,
        role: 'OWNER',
        participant_type: null,
      });

      const topupDto = {
        amountMinor: 5000, // $50.00
        returnUrl: 'https://app.example.com/billing',
      };

      const mockTopupResult = {
        url: 'https://mock-payment.example.com/checkout/123',
        sessionId: 'sess_123',
      };

      mockPaymentProviderMock.createWalletTopUp.mockResolvedValue(mockTopupResult);

      const response = await controller.mockTopUp(
        { params: { workspaceId: mockWorkspaceId }, user: { userId: mockUserId } } as any,
        mockWorkspaceId,
        topupDto as any,
      );

      expect(response).toHaveProperty('url');
      expect(response).toHaveProperty('sessionId');
      expect(mockPaymentProviderMock.createWalletTopUp).toHaveBeenCalledWith(
        mockWorkspaceId,
        5000,
        'https://app.example.com/billing',
      );
    });
  });
});
