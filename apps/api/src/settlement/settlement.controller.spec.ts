import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Reflector } from '@nestjs/core';
import { ForbiddenException } from '@nestjs/common';
import { SettlementController } from './settlement.controller.js';
import { PermissionsGuard } from '../authorization/permissions.guard.js';
import { SettlementParticipantType, WorkspaceRole } from '@prisma/client';

describe('SettlementController & PermissionsGuard Integration', () => {
  let controller: SettlementController;
  let prisma: any;
  let settlementBatchService: any;
  let permissionsService: any;
  let guard: PermissionsGuard;
  let reflector: Reflector;

  const mockVendorMember = {
    id: 'member-v-1',
    workspace_id: 'ws-1',
    user_id: 'user-v-1',
    role: WorkspaceRole.MEMBER,
    participant_type: 'VENDOR',
    vendor_id: 'vendor-123',
    buyer_id: null,
  };

  beforeEach(() => {
    reflector = new Reflector();

    prisma = {
      workspaceMember: {
        findUnique: vi.fn(),
      },
    };

    settlementBatchService = {
      getBatches: vi.fn().mockResolvedValue({
        batches: [
          {
            id: 'batch-1',
            batch_number: 'SB-001',
            workspace_id: 'ws-1',
            participant_type: 'VENDOR',
            vendor_id: 'vendor-123',
            buyer_id: 'secret-buyer-id',
            revenue: 500,
            payout: 400,
            cost: 50,
            profit: 50,
            net_amount: 400,
          },
        ],
        total: 1,
        limit: 50,
        offset: 0,
      }),
      getBatchById: vi.fn(),
      getBatchItems: vi.fn(),
      generateVendorSettlement: vi.fn(),
    };

    permissionsService = {
      hasPermission: vi.fn(),
      hasResourceScope: vi.fn(),
    };

    guard = new PermissionsGuard(reflector, permissionsService);
    controller = new SettlementController(prisma, settlementBatchService);
  });

  function createMockContext(options: {
    user?: { userId: string };
    params?: Record<string, string>;
    query?: Record<string, string>;
    handler?: any;
  }) {
    const req = {
      user: options.user || { userId: 'user-v-1' },
      params: options.params || { workspaceId: 'ws-1' },
      query: options.query || {},
      body: {},
      method: 'GET',
    };

    return {
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => ({}),
      }),
      getHandler: () => options.handler || controller.getBatches,
      getClass: () => SettlementController,
    } as any;
  }

  describe('PermissionsGuard check on getBatches', () => {
    it('should allow execution when permissionsService grants settlement:read for vendor member', async () => {
      permissionsService.hasPermission.mockResolvedValue(true);
      const ctx = createMockContext({
        user: { userId: 'user-v-1' },
        params: { workspaceId: 'ws-1' },
      });

      const canActivate = await guard.canActivate(ctx);
      expect(canActivate).toBe(true);
      expect(permissionsService.hasPermission).toHaveBeenCalledWith('ws-1', 'user-v-1', 'settlement:read');
    });

    it('should throw ForbiddenException when permissionsService denies settlement:read', async () => {
      permissionsService.hasPermission.mockResolvedValue(false);
      const ctx = createMockContext({
        user: { userId: 'user-unauth' },
        params: { workspaceId: 'ws-1' },
      });

      await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('SettlementController.getBatches Execution & Sanitization', () => {
    beforeEach(() => {
      prisma.workspaceMember.findUnique.mockResolvedValue(mockVendorMember);
    });

    it('should scope query to member vendor_id and strip buyer_id, revenue, cost, profit', async () => {
      const result = await controller.getBatches('ws-1', { user: { userId: 'user-v-1' } }, {} as any);

      expect(settlementBatchService.getBatches).toHaveBeenCalledWith('ws-1', expect.objectContaining({
        participant_type: 'VENDOR',
        vendor_id: 'vendor-123',
      }));

      expect(result.batches).toHaveLength(1);
      const batch = result.batches[0];
      // Vendor economics preserved
      expect(batch.vendor_id).toBe('vendor-123');
      expect(batch.payout).toBe(400);

      // Financial isolation: buyer economics must be stripped
      expect(batch.buyer_id).toBeUndefined();
      expect(batch.revenue).toBeUndefined();
      expect(batch.cost).toBeUndefined();
      expect(batch.profit).toBeUndefined();
    });

    it('should reject vendor attempting to query buyer settlements', async () => {
      await expect(
        controller.getBatches(
          'ws-1',
          { user: { userId: 'user-v-1' } },
          { participant_type: SettlementParticipantType.BUYER } as any,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should reject vendor attempting to query another vendor id', async () => {
      await expect(
        controller.getBatches(
          'ws-1',
          { user: { userId: 'user-v-1' } },
          { vendor_id: 'other-vendor' } as any,
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('generateBatch Owner Invariant', () => {
    it('should reject non-OWNER attempting to generate settlement batch', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue(mockVendorMember);

      await expect(
        controller.generateBatch(
          'ws-1',
          { user: { userId: 'user-v-1' } },
          {
            participant_type: SettlementParticipantType.VENDOR,
            vendor_id: 'vendor-123',
            period_start: '2026-10-01T00:00:00Z',
            period_end: '2026-10-08T00:00:00Z',
          } as any,
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
