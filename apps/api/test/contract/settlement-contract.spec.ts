import { vi, describe, it, expect, beforeEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { SettlementController } from '../../src/settlement/settlement.controller.js';
import { SettlementBatchService } from '../../src/settlement/settlement-batch.service.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { JwtAuthGuard } from '../../src/auth/jwt-auth.guard.js';
import { WorkspaceRolesGuard } from '../../src/authorization/workspace-roles.guard.js';
import { PermissionsGuard } from '../../src/authorization/permissions.guard.js';
import { PermissionsService } from '../../src/permissions/permissions.service.js';
import { SettlementParticipantType, SettlementStatus, PaymentStatus, ReconciliationStatus, WorkspaceRole } from '@prisma/client';

describe('Layer 5 Contract Regression: Settlement API & Financial Sanitization Boundaries', () => {
  let controller: SettlementController;
  let batchServiceMock: any;
  let prismaMock: any;

  const mockWorkspaceId = 'ws-contract-settle-1';
  const mockUserId = 'usr-contract-settle-1';
  const mockBatchId = 'batch-contract-101';

  beforeEach(async () => {
    batchServiceMock = {
      getBatches: vi.fn(),
      generateBuyerSettlement: vi.fn(),
      generateVendorSettlement: vi.fn(),
    };

    prismaMock = {
      workspaceMember: {
        findUnique: vi.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SettlementController],
      providers: [
        { provide: SettlementBatchService, useValue: batchServiceMock },
        { provide: PrismaService, useValue: prismaMock },
        {
          provide: PermissionsService,
          useValue: {
            getPermissionsForUser: vi.fn().mockResolvedValue([{ key: 'settlement:read', scope_type: 'ALL' }]),
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

    controller = module.get<SettlementController>(SettlementController);
  });

  describe('GET /workspaces/:workspaceId/settlements/batches List Boundary Contract', () => {
    it('returns paginated settlement batches conforming to { items, batches, total } contract schema', async () => {
      // Owner member context
      prismaMock.workspaceMember.findUnique.mockResolvedValue({
        id: 'member-1',
        workspace_id: mockWorkspaceId,
        user_id: mockUserId,
        role: WorkspaceRole.OWNER,
        participant_type: null,
      });

      const mockBatch = {
        id: mockBatchId,
        workspace_id: mockWorkspaceId,
        batch_number: 'BATCH-2026-0001',
        settlement_status: SettlementStatus.DRAFT,
        payment_status: PaymentStatus.UNPROCESSED,
        reconciliation_status: ReconciliationStatus.UNRECONCILED,
        participant_type: SettlementParticipantType.BUYER,
        buyer_id: 'buyer-contract-1',
        vendor_id: null,
        net_amount: '1250.0000',
        currency: 'USD',
        item_count: 25,
        created_at: new Date('2026-02-01T12:00:00Z'),
      };

      batchServiceMock.getBatches.mockResolvedValue({
        batches: [mockBatch],
        total: 1,
        limit: 20,
        offset: 0,
      });

      const response = await controller.getBatches(
        mockWorkspaceId,
        { user: { userId: mockUserId } },
        { limit: 20, offset: 0 } as any,
      );

      expect(response).toHaveProperty('items');
      expect(response).toHaveProperty('batches');
      expect(response).toHaveProperty('total');
      expect(Array.isArray(response.items)).toBe(true);
      expect(typeof response.total).toBe('number');
      expect(response.total).toBe(1);

      const item = response.items[0];
      // Breaking field removal / rename checks
      expect(item).toHaveProperty('id');
      expect(item).toHaveProperty('workspace_id');
      expect(item).toHaveProperty('batch_number');
      expect(item).toHaveProperty('settlement_status');
      expect(item).toHaveProperty('participant_type');
      expect(item).toHaveProperty('currency');
      expect(item).toHaveProperty('item_count');

      // Type checks
      expect(typeof item.id).toBe('string');
      expect(typeof item.batch_number).toBe('string');
      expect(item.settlement_status).toBe(SettlementStatus.DRAFT);
      expect(typeof item.currency).toBe('string');
    });

    it('enforces participant financial redaction (Buyer never sees payout, cost, or profit)', async () => {
      // Buyer member context
      prismaMock.workspaceMember.findUnique.mockResolvedValue({
        id: 'member-buyer',
        workspace_id: mockWorkspaceId,
        user_id: mockUserId,
        role: WorkspaceRole.MEMBER,
        participant_type: 'BUYER',
        buyer_id: 'buyer-contract-1',
      });

      const rawBatch = {
        id: mockBatchId,
        workspace_id: mockWorkspaceId,
        batch_number: 'BATCH-2026-0002',
        settlement_status: SettlementStatus.DRAFT,
        participant_type: SettlementParticipantType.BUYER,
        buyer_id: 'buyer-contract-1',
        vendor_id: 'vendor-secret-1', // Should be deleted!
        revenue: '500.0000',
        payout: '300.0000',          // Should be deleted!
        cost: '25.0000',             // Should be deleted!
        profit: '175.0000',          // Should be deleted!
        currency: 'USD',
        created_at: new Date(),
      };

      batchServiceMock.getBatches.mockResolvedValue({
        batches: [rawBatch],
        total: 1,
        limit: 10,
        offset: 0,
      });

      const response = await controller.getBatches(
        mockWorkspaceId,
        { user: { userId: mockUserId } },
        { limit: 10, offset: 0 } as any,
      );

      const item = response.items[0];
      expect(item.revenue).toBe('500.0000');
      expect(item.vendor_id).toBeUndefined();
      expect(item.payout).toBeUndefined();
      expect(item.cost).toBeUndefined();
      expect(item.profit).toBeUndefined();
    });

    it('enforces participant financial redaction (Vendor never sees revenue, cost, or profit)', async () => {
      // Vendor member context
      prismaMock.workspaceMember.findUnique.mockResolvedValue({
        id: 'member-vendor',
        workspace_id: mockWorkspaceId,
        user_id: mockUserId,
        role: WorkspaceRole.MEMBER,
        participant_type: 'VENDOR',
        vendor_id: 'vendor-contract-1',
      });

      const rawBatch = {
        id: mockBatchId,
        workspace_id: mockWorkspaceId,
        batch_number: 'BATCH-2026-0003',
        settlement_status: SettlementStatus.DRAFT,
        participant_type: SettlementParticipantType.VENDOR,
        vendor_id: 'vendor-contract-1',
        buyer_id: 'buyer-secret-1',  // Should be deleted!
        revenue: '500.0000',         // Should be deleted!
        payout: '300.0000',
        cost: '25.0000',             // Should be deleted!
        profit: '175.0000',          // Should be deleted!
        currency: 'USD',
        created_at: new Date(),
      };

      batchServiceMock.getBatches.mockResolvedValue({
        batches: [rawBatch],
        total: 1,
        limit: 10,
        offset: 0,
      });

      const response = await controller.getBatches(
        mockWorkspaceId,
        { user: { userId: mockUserId } },
        { limit: 10, offset: 0 } as any,
      );

      const item = response.items[0];
      expect(item.payout).toBe('300.0000');
      expect(item.buyer_id).toBeUndefined();
      expect(item.revenue).toBeUndefined();
      expect(item.cost).toBeUndefined();
      expect(item.profit).toBeUndefined();
    });

    it('rejects access when user is not a member of the workspace (403 Forbidden)', async () => {
      prismaMock.workspaceMember.findUnique.mockResolvedValue(null);

      await expect(
        controller.getBatches(
          mockWorkspaceId,
          { user: { userId: 'intruder-user' } },
          { limit: 10, offset: 0 } as any,
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('POST /workspaces/:workspaceId/settlements/batches/generate Request Boundary Contract', () => {
    it('generates settlement batch conforming to exact response contract', async () => {
      prismaMock.workspaceMember.findUnique.mockResolvedValue({
        id: 'member-owner',
        workspace_id: mockWorkspaceId,
        user_id: mockUserId,
        role: WorkspaceRole.OWNER,
        participant_type: null,
      });

      const generateDto = {
        participant_type: SettlementParticipantType.BUYER,
        buyer_id: 'buyer-contract-1',
        period_start: '2026-01-01T00:00:00.000Z',
        period_end: '2026-01-31T23:59:59.000Z',
      };

      const mockCreatedSummary = {
        workspace_id: mockWorkspaceId,
        period_start: new Date('2026-01-01T00:00:00.000Z'),
        period_end: new Date('2026-01-31T23:59:59.000Z'),
        participant_type: SettlementParticipantType.BUYER,
        batches: [
          {
            batch_id: mockBatchId,
            batch_number: 'BATCH-2026-0004',
            settlement_status: SettlementStatus.DRAFT,
            payment_status: PaymentStatus.UNPROCESSED,
            reconciliation_status: ReconciliationStatus.UNRECONCILED,
            gross_amount: '2500.0000',
            adjustments_amount: '0.0000',
            net_amount: '2500.0000',
            currency: 'USD',
            item_count: 50,
          },
        ],
        skipped_calls_count: 0,
      };

      batchServiceMock.generateBuyerSettlement.mockResolvedValue(mockCreatedSummary);

      const response = await controller.generateBatch(
        mockWorkspaceId,
        { user: { userId: mockUserId } },
        generateDto as any,
      );

      expect(response).toHaveProperty('workspace_id');
      expect(response).toHaveProperty('batches');
      expect(response).toHaveProperty('participant_type');
      expect(response.batches).toHaveLength(1);
      expect(response.batches[0].batch_number).toBe('BATCH-2026-0004');
      expect(response.batches[0].net_amount).toBe('2500.0000');
    });

    it('rejects generateBatch when period_start >= period_end (400 Bad Request)', async () => {
      prismaMock.workspaceMember.findUnique.mockResolvedValue({
        id: 'member-owner',
        workspace_id: mockWorkspaceId,
        user_id: mockUserId,
        role: WorkspaceRole.OWNER,
        participant_type: null,
      });

      const invalidDateDto = {
        participant_type: SettlementParticipantType.BUYER,
        buyer_id: 'buyer-contract-1',
        period_start: '2026-02-01T00:00:00.000Z',
        period_end: '2026-01-01T00:00:00.000Z', // start > end!
      };

      await expect(
        controller.generateBatch(
          mockWorkspaceId,
          { user: { userId: mockUserId } },
          invalidDateDto as any,
        ),
      ).rejects.toThrow(/period_start must be before period_end/i);
    });
  });
});
