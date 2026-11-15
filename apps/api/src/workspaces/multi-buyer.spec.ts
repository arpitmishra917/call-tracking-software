import { Test, TestingModule } from '@nestjs/testing';
import { WorkspacesService } from './workspaces.service.js';
import { CallsService } from '../calls/calls.service.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { UsageService } from '../usage/usage.service.js';
import { WebhooksService } from '../webhooks/webhooks.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditLogsService } from '../audit-logs/audit-logs.service.js';
import { BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import * as crypto from 'crypto';

describe('Option B: Multiple Buyers Linked to One Workspace Member', () => {
  let workspacesService: WorkspacesService;
  let callsService: CallsService;
  let permissionsService: PermissionsService;
  let prisma: any;
  let auditLogsService: any;

  beforeEach(async () => {
    prisma = {
      $transaction: vi.fn(async (cb) => cb(prisma)),
      profile: { upsert: vi.fn().mockResolvedValue({}) },
      workspace: { create: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
      buyer: { findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn() },
      workspaceMember: {
        create: vi.fn(),
        delete: vi.fn(),
        count: vi.fn(),
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        update: vi.fn(),
        upsert: vi.fn(),
        findMany: vi.fn(),
      },
      workspaceMemberBuyer: {
        create: vi.fn(),
        deleteMany: vi.fn(),
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        findMany: vi.fn(),
        upsert: vi.fn(),
      },
      workspaceInvitation: {
        create: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      call: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        count: vi.fn(),
      },
      callAttempt: {
        findMany: vi.fn(),
      },
      campaignBuyer: {
        findFirst: vi.fn(),
        findUnique: vi.fn(),
      },
      phoneNumber: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
      },
      recording: {
        findUnique: vi.fn(),
      },
      permission: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
        upsert: vi.fn(),
      },
      workspaceMemberPermission: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      $queryRaw: vi.fn().mockResolvedValue([]),
    };

    auditLogsService = {
      logAction: vi.fn().mockResolvedValue({}),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkspacesService,
        CallsService,
        PermissionsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditLogsService, useValue: auditLogsService },
        { provide: UsageService, useValue: { recordUsage: vi.fn() } },
        { provide: WebhooksService, useValue: { queueEvent: vi.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();

    workspacesService = module.get<WorkspacesService>(WorkspacesService);
    callsService = module.get<CallsService>(CallsService);
    permissionsService = module.get<PermissionsService>(PermissionsService);
  }, 30000);

  describe('1. Invitation Flow & Non-destructive Acceptance', () => {
    it('allows an existing user with BUYER membership to accept an invitation for another Buyer in the same workspace', async () => {
      const token = 'valid_token_123';
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

      prisma.workspaceInvitation.findUnique.mockResolvedValue({
        id: 'invite_2',
        token_hash: tokenHash,
        status: 'PENDING',
        workspace_id: 'ws_1',
        email: 'buyer@example.com',
        role: 'MEMBER',
        participant_type: 'BUYER',
        buyer_id: 'buyer_2',
        expires_at: new Date(Date.now() + 86400000),
      });

      // Existing member already has buyer_1
      prisma.workspaceMember.findUnique.mockResolvedValue({
        id: 'member_1',
        workspace_id: 'ws_1',
        user_id: 'user_1',
        role: 'MEMBER',
        participant_type: 'BUYER',
        buyer_id: 'buyer_1',
      });

      prisma.workspaceMember.upsert.mockResolvedValue({
        id: 'member_1',
        workspace_id: 'ws_1',
        user_id: 'user_1',
        role: 'MEMBER',
        participant_type: 'BUYER',
        buyer_id: 'buyer_1',
      });

      const result = await workspacesService.acceptInvitation(token, 'user_1', 'buyer@example.com', 'Buyer User');

      expect(result).toEqual({ workspaceId: 'ws_1' });
      // Verifies workspace_member_buyers upserted both the existing buyer and new buyer
      expect(prisma.workspaceMemberBuyer.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            workspace_id: 'ws_1',
            workspace_member_id: 'member_1',
            buyer_id: 'buyer_1',
          }),
        })
      );
      expect(prisma.workspaceMemberBuyer.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            workspace_id: 'ws_1',
            workspace_member_id: 'member_1',
            buyer_id: 'buyer_2',
          }),
        })
      );
    });

    it('rejects identity collision when invitation participant_type does not match existing participant_type', async () => {
      const token = 'token_vendor';
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

      prisma.workspaceInvitation.findUnique.mockResolvedValue({
        id: 'invite_v',
        token_hash: tokenHash,
        status: 'PENDING',
        workspace_id: 'ws_1',
        email: 'user@example.com',
        role: 'MEMBER',
        participant_type: 'VENDOR',
        vendor_id: 'vendor_1',
        expires_at: new Date(Date.now() + 86400000),
      });

      // Existing member is a BUYER
      prisma.workspaceMember.findUnique.mockResolvedValue({
        id: 'member_1',
        workspace_id: 'ws_1',
        user_id: 'user_1',
        role: 'MEMBER',
        participant_type: 'BUYER',
        buyer_id: 'buyer_1',
      });

      await expect(
        workspacesService.acceptInvitation(token, 'user_1', 'user@example.com', 'User')
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('2. Direct Member-Buyer Linking and Unlinking Management', () => {
    it('links a valid workspace buyer to a member and writes audit log', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({
        id: 'member_1',
        workspace_id: 'ws_1',
        user_id: 'user_1',
        role: 'MEMBER',
        participant_type: 'BUYER',
        buyer_id: 'buyer_1',
      });
      prisma.buyer.findUnique.mockResolvedValue({
        id: 'buyer_2',
        workspace_id: 'ws_1',
        name: 'Second Buyer',
        destination_number: '+15552223333',
        status: 'ACTIVE',
      });
      prisma.workspaceMemberBuyer.upsert.mockResolvedValue({
        id: 'link_2',
        workspace_id: 'ws_1',
        workspace_member_id: 'member_1',
        buyer_id: 'buyer_2',
        created_at: new Date(),
        buyer: {
          name: 'Second Buyer',
          destination_number: '+15552223333',
        },
      });

      const res = await workspacesService.linkBuyerToMember('ws_1', 'member_1', 'buyer_2', 'admin_user');

      expect(res.buyer_id).toBe('buyer_2');
      expect(res.name).toBe('Second Buyer');
      expect(auditLogsService.logAction).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: 'ws_1',
          action: 'BUYER_LINKED_TO_MEMBER',
          metadata: expect.objectContaining({ buyerId: 'buyer_2' }),
        })
      );
    });

    it('unlinks a buyer from a member and reassigns member.buyer_id without deleting buyer or calls', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({
        id: 'member_1',
        workspace_id: 'ws_1',
        user_id: 'user_1',
        role: 'MEMBER',
        participant_type: 'BUYER',
        buyer_id: 'buyer_1',
      });

      prisma.workspaceMemberBuyer.deleteMany.mockResolvedValue({ count: 1 });
      prisma.workspaceMemberBuyer.findFirst.mockResolvedValue({
        id: 'link_2',
        buyer_id: 'buyer_2',
      });

      const res = await workspacesService.unlinkBuyerFromMember('ws_1', 'member_1', 'buyer_1', 'admin_user');

      expect(res).toEqual({ success: true });
      expect(prisma.workspaceMemberBuyer.deleteMany).toHaveBeenCalledWith({
        where: {
          workspace_member_id: 'member_1',
          buyer_id: 'buyer_1',
          workspace_id: 'ws_1',
        },
      });
      // Legacy buyer_id shifted to remaining link
      expect(prisma.workspaceMember.update).toHaveBeenCalledWith({
        where: { id: 'member_1' },
        data: { buyer_id: 'buyer_2' },
      });
      expect(auditLogsService.logAction).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: 'ws_1',
          action: 'BUYER_UNLINKED_FROM_MEMBER',
          metadata: { buyerId: 'buyer_1' },
        })
      );
    });
  });

  describe('3. Calls Query Scoping & Consolidated Reporting', () => {
    beforeEach(() => {
      const mockMember = {
        id: 'member_1',
        workspace_id: 'ws_1',
        user_id: 'user_1',
        role: 'MEMBER',
        participant_type: 'BUYER',
        buyer_id: 'buyer_1',
        workspaceMemberPermissions: [],
      };
      prisma.workspaceMember.findUnique.mockResolvedValue(mockMember);
      prisma.workspaceMember.findFirst.mockResolvedValue(mockMember);
      // Member is linked to both buyer_1 and buyer_2
      prisma.workspaceMemberBuyer.findMany.mockResolvedValue([
        { id: 'l1', workspace_member_id: 'member_1', buyer_id: 'buyer_1' },
        { id: 'l2', workspace_member_id: 'member_1', buyer_id: 'buyer_2' },
      ]);
    });

    it('queries consolidated calls across all linked buyers when no individual buyerId is specified', async () => {
      let capturedWhere: any = null;
      prisma.call.findMany.mockImplementation(({ where }: any) => {
        capturedWhere = where;
        return Promise.resolve([]);
      });
      prisma.call.count.mockResolvedValue(0);

      await callsService.getCalls('ws_1', 'user_1', {});

      expect(capturedWhere.workspace_id).toBe('ws_1');
      expect(capturedWhere.OR).toEqual([
        { commercial: { buyer_id: { in: ['buyer_1', 'buyer_2'] } } },
        { attempts: { some: { buyer_id: { in: ['buyer_1', 'buyer_2'] } } } },
      ]);
    });

    it('filters calls strictly to a single authorized linked buyer when buyerId filter is provided', async () => {
      let capturedWhere: any = null;
      prisma.call.findMany.mockImplementation(({ where }: any) => {
        capturedWhere = where;
        return Promise.resolve([]);
      });
      prisma.call.count.mockResolvedValue(0);

      await callsService.getCalls('ws_1', 'user_1', { buyerId: 'buyer_2' });

      expect(capturedWhere.OR).toEqual([
        { commercial: { buyer_id: 'buyer_2' } },
        { attempts: { some: { buyer_id: 'buyer_2' } } },
      ]);
    });

    it('rejects query and returns empty results when filtering by an unauthorized buyerId', async () => {
      const res = await callsService.getCalls('ws_1', 'user_1', { buyerId: 'unauthorized_buyer' });
      expect(res).toEqual({ items: [], total: 0 });
      expect(prisma.call.findMany).not.toHaveBeenCalled();
    });

    it('filters attempts in call results so only attempts for authorized linked buyers are returned', async () => {
      const mockCall = {
        id: 'call_1',
        workspace_id: 'ws_1',
        state: 'COMPLETED',
        from_number: '+15551234567',
        to_number: '+15559876543',
        created_at: new Date(),
        commercial: {
          id: 'comm_1',
          buyer_id: 'buyer_2',
          revenue: 25.0,
          payout: 10.0,
          profit: 15.0,
          buyer: { id: 'buyer_2', name: 'Buyer 2' },
        },
        attempts: [
          { id: 'att_1', buyer_id: 'buyer_1', state: 'NO_ANSWER' },
          { id: 'att_2', buyer_id: 'buyer_2', state: 'COMPLETED' },
          { id: 'att_3', buyer_id: 'competitor_buyer_3', state: 'NO_ANSWER' },
        ],
        recordings: [{ id: 'rec_1', status: 'AVAILABLE' }],
      };

      prisma.call.findMany.mockResolvedValue([mockCall]);
      prisma.call.count.mockResolvedValue(1);

      const res = await callsService.getCalls('ws_1', 'user_1', {});

      expect(res.items).toHaveLength(1);
      const returnedCall = res.items[0];

      // Attempts must only contain buyer_1 and buyer_2; competitor_buyer_3 is stripped
      expect(returnedCall.attempts).toHaveLength(2);
      expect(returnedCall.attempts.map((a: any) => a.buyer_id)).toEqual(['buyer_1', 'buyer_2']);

      // Financial sanitization: payout and profit must be deleted for buyer
      expect(returnedCall.commercial.payout).toBeUndefined();
      expect(returnedCall.commercial.profit).toBeUndefined();
      expect(returnedCall.commercial.revenue).toBe(25.0);

      // Recording is available because call was won by buyer_2 (one of user's linked buyers)
      expect(returnedCall.recordings).toHaveLength(1);
    });
  });

  describe('4. Metrics Scoping and Financial Sanitization', () => {
    beforeEach(() => {
      const mockMember = {
        id: 'member_1',
        workspace_id: 'ws_1',
        user_id: 'user_1',
        role: 'MEMBER',
        participant_type: 'BUYER',
        buyer_id: 'buyer_1',
        workspaceMemberPermissions: [],
      };
      prisma.workspaceMember.findUnique.mockResolvedValue(mockMember);
      prisma.workspaceMember.findFirst.mockResolvedValue(mockMember);
      prisma.workspaceMemberBuyer.findMany.mockResolvedValue([
        { id: 'l1', workspace_member_id: 'member_1', buyer_id: 'buyer_1' },
        { id: 'l2', workspace_member_id: 'member_1', buyer_id: 'buyer_2' },
      ]);
    });

    it('aggregates metrics for multiple linked buyers and strips payout, cost, and profit', async () => {
      prisma.$queryRaw.mockImplementation((sql: any) => {
        const text = sql.strings ? sql.strings.join('') : '';
        if (text.includes('FROM calls c')) {
          return Promise.resolve([
            {
              total: 5,
              answered: 4,
              missed: 1,
              failed: 0,
              blocked: 0,
              total_duration: 300,
              talk_duration: 250,
              tcl_secs: 280,
              eligible_calls: 4,
              answered_duration: 240,
            },
          ]);
        }
        if (text.includes('call_commercials ccom')) {
          return Promise.resolve([
            {
              commercial_total: 4,
              revenue: 100.0,
              payout: 40.0,
              cost: 10.0,
              profit: 50.0,
              converted: 3,
              qualified: 4,
              duplicate: 0,
            },
          ]);
        }
        return Promise.resolve([]);
      });

      const metrics = await callsService.getMetrics('ws_1', 'user_1', {});

      expect(metrics.total).toBe(5);
      expect(metrics.revenue).toBe(100.0);
      // Strictly verify sensitive financial fields are deleted
      expect(metrics.payout).toBeUndefined();
      expect(metrics.cost).toBeUndefined();
      expect(metrics.profit).toBeUndefined();
    });
  });

  describe('5. Permissions Authorization across Linked Buyers', () => {
    beforeEach(() => {
      prisma.workspaceMember.findUnique.mockResolvedValue({
        id: 'member_1',
        workspace_id: 'ws_1',
        user_id: 'user_1',
        role: 'MEMBER',
        participant_type: 'BUYER',
        buyer_id: 'buyer_1',
        workspaceMemberPermissions: [],
      });
      prisma.workspaceMemberBuyer.findMany.mockResolvedValue([
        { id: 'l1', workspace_member_id: 'member_1', buyer_id: 'buyer_1' },
        { id: 'l2', workspace_member_id: 'member_1', buyer_id: 'buyer_2' },
      ]);
    });

    it('authorizes buyer:read for all linked buyers and denies for unlinked buyer', async () => {
      const canReadBuyer1 = await permissionsService.hasResourceScope(
        'ws_1',
        'member_1',
        'buyer:read',
        'buyer_1'
      );
      const canReadBuyer2 = await permissionsService.hasResourceScope(
        'ws_1',
        'member_1',
        'buyer:read',
        'buyer_2'
      );
      const canReadBuyer3 = await permissionsService.hasResourceScope(
        'ws_1',
        'member_1',
        'buyer:read',
        'buyer_3'
      );

      expect(canReadBuyer1).toBe(true);
      expect(canReadBuyer2).toBe(true);
      expect(canReadBuyer3).toBe(false);
    });

    it('authorizes call:read when call is attributed to either linked buyer', async () => {
      prisma.call.findUnique.mockResolvedValue({
        id: 'call_b2',
        workspace_id: 'ws_1',
        commercial: { buyer_id: 'buyer_2' },
        attempts: [],
      });

      const canRead = await permissionsService.hasResourceScope(
        'ws_1',
        'member_1',
        'call:read',
        'call_b2'
      );

      expect(canRead).toBe(true);
    });

    it('denies call:read and call:recording_read when call commercial buyer_id is null', async () => {
      prisma.call.findUnique.mockResolvedValue({
        id: 'call_null',
        workspace_id: 'ws_1',
        commercial: { buyer_id: null },
        attempts: [],
      });

      const canRead = await permissionsService.hasResourceScope(
        'ws_1',
        'member_1',
        'call:read',
        'call_null'
      );
      expect(canRead).toBe(false);

      prisma.recording.findUnique.mockResolvedValue({
        id: 'rec_null',
        call: {
          workspace_id: 'ws_1',
          commercial: { buyer_id: null },
        },
      });

      const canReadRec = await permissionsService.hasResourceScope(
        'ws_1',
        'member_1',
        'call:recording_read',
        'rec_null'
      );
      expect(canReadRec).toBe(false);
    });

    it('denies access when all buyer links are revoked (empty buyerIds), even if legacy buyer_id remains on member', async () => {
      // Member has legacy buyer_id 'buyer_1', but join table returned empty array (all links revoked)
      prisma.workspaceMemberBuyer.findMany.mockResolvedValue([]);

      const canReadBuyer1 = await permissionsService.hasResourceScope(
        'ws_1',
        'member_1',
        'buyer:read',
        'buyer_1'
      );
      expect(canReadBuyer1).toBe(false);

      prisma.call.findUnique.mockResolvedValue({
        id: 'call_b1',
        workspace_id: 'ws_1',
        commercial: { buyer_id: 'buyer_1' },
        attempts: [],
      });

      const canReadCall = await permissionsService.hasResourceScope(
        'ws_1',
        'member_1',
        'call:read',
        'call_b1'
      );
      expect(canReadCall).toBe(false);
    });
  });

  describe('6. Edge Cases & Sanitization Security', () => {
    it('sanitizes commercial data correctly for multi-buyer participant context', () => {
      const raw = {
        id: 'comm_1',
        buyer_id: 'buyer_2',
        revenue: 100,
        payout: 50,
        cost: 10,
        profit: 40,
        currency: 'USD',
      };

      // Allowed buyer context: ['buyer_1', 'buyer_2']
      const sanitized = callsService.sanitizeCommercial(raw, {
        isOwnerOrAdmin: false,
        isBuyer: true,
        buyerIds: ['buyer_1', 'buyer_2'],
        isVendor: false,
        isInternalMember: false,
      });

      expect(sanitized).toBeDefined();
      expect(sanitized.revenue).toBe(100);
      expect((sanitized as any).payout).toBeUndefined();
      expect((sanitized as any).cost).toBeUndefined();
      expect((sanitized as any).profit).toBeUndefined();

      // Unlinked buyer context: returns null
      const unlinked = callsService.sanitizeCommercial(raw, {
        isOwnerOrAdmin: false,
        isBuyer: true,
        buyerIds: ['buyer_3'],
        isVendor: false,
        isInternalMember: false,
      });
      expect(unlinked).toBeNull();

      // Null buyer_id commercial: returns null
      const nullBuyerComm = callsService.sanitizeCommercial({ ...raw, buyer_id: null }, {
        isOwnerOrAdmin: false,
        isBuyer: true,
        buyerIds: ['buyer_1', 'buyer_2'],
        isVendor: false,
        isInternalMember: false,
      });
      expect(nullBuyerComm).toBeNull();
    });

    it('sanitizes metrics correctly with multi-buyer context and strips unlinked buyers and financial metrics', () => {
      const rawMetrics = {
        total: 10,
        revenue: 200,
        payout: 100,
        cost: 20,
        profit: 80,
        buyers: {
          buyer_1: { revenue: 100, payout: 50, cost: 10, profit: 40 },
          buyer_2: { revenue: 100, payout: 50, cost: 10, profit: 40 },
          buyer_3: { revenue: 50, payout: 25, cost: 5, profit: 20 },
        },
      };

      const sanitized = callsService.sanitizeMetrics(rawMetrics, {
        isOwnerOrAdmin: false,
        isBuyer: true,
        buyerIds: ['buyer_1', 'buyer_2'],
        isVendor: false,
        isInternalMember: false,
      });

      expect(sanitized.revenue).toBe(200);
      expect(sanitized.payout).toBeUndefined();
      expect(sanitized.cost).toBeUndefined();
      expect(sanitized.profit).toBeUndefined();

      // buyer_1 and buyer_2 kept without financial fields
      expect(sanitized.buyers.buyer_1).toBeDefined();
      expect(sanitized.buyers.buyer_1.revenue).toBe(100);
      expect(sanitized.buyers.buyer_1.payout).toBeUndefined();
      expect(sanitized.buyers.buyer_2).toBeDefined();

      // buyer_3 (unlinked) stripped completely
      expect(sanitized.buyers.buyer_3).toBeUndefined();
    });

    it('denies call detail when call commercial buyer_id is null and no attempts match', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({
        id: 'member_1',
        workspace_id: 'ws_1',
        user_id: 'user_1',
        role: 'MEMBER',
        participant_type: 'BUYER',
        buyer_id: 'buyer_1',
      });
      prisma.workspaceMemberBuyer.findMany.mockResolvedValue([
        { id: 'l1', workspace_member_id: 'member_1', buyer_id: 'buyer_1' },
      ]);
      prisma.call.findUnique.mockResolvedValue({
        id: 'call_null_buyer',
        workspace_id: 'ws_1',
        commercial: { buyer_id: null },
        attempts: [{ buyer_id: null }, { buyer_id: 'unlinked_buyer' }],
      });

      await expect(
        callsService.getCallDetail('ws_1', 'call_null_buyer', 'user_1')
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
