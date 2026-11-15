import { Test, TestingModule } from '@nestjs/testing';
import { WorkspacesService } from './workspaces.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditLogsService } from '../audit-logs/audit-logs.service.js';
import { BadRequestException, NotFoundException, ForbiddenException, ConflictException } from '@nestjs/common';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import * as crypto from 'crypto';

describe('WorkspacesService', () => {
  let service: WorkspacesService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkspacesService,
        {
          provide: PrismaService,
          useValue: {
            $transaction: vi.fn(async (cb) => cb(prisma)),
            profile: { upsert: vi.fn() },
            workspace: { create: vi.fn(), update: vi.fn(), findUnique: vi.fn(), delete: vi.fn() },
            workspaceMember: { create: vi.fn(), delete: vi.fn(), count: vi.fn(), findUnique: vi.fn(), update: vi.fn(), upsert: vi.fn(), findMany: vi.fn() },
            workspaceInvitation: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
            walletTransaction: { count: vi.fn() },
            callCommercial: { count: vi.fn() },
            settlementBatch: { count: vi.fn() },
            vendor: { findFirst: vi.fn() },
            buyer: { findFirst: vi.fn() },
          },
        },
        {
          provide: AuditLogsService,
          useValue: {
            logAction: vi.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<WorkspacesService>(WorkspacesService);
    prisma = module.get<PrismaService>(PrismaService);
  }, 30000);

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createInvitation', () => {
    it('should create an invitation with a hashed token', async () => {
      const mockInvite = { id: 'invite-1', workspace_id: 'ws-1', role: 'MEMBER' };
      vi.mocked(prisma.workspaceInvitation.create).mockResolvedValue(mockInvite as any);

      const result = await service.createInvitation('ws-1', 'test@test.com', 'MEMBER', 'user-1');
      
      expect(prisma.workspaceInvitation.create).toHaveBeenCalled();
      const callArgs = vi.mocked(prisma.workspaceInvitation.create).mock.calls[0][0];
      
      expect(callArgs.data.token_hash).toBeDefined();
      expect(callArgs.data.token_hash).not.toBe('hash'); // no longer hardcoded
      expect(result.token).toBeDefined(); // returns unhashed token
    });
  });

  describe('acceptInvitation', () => {
    it('should accept a valid invitation for matching email', async () => {
      const token = 'my-secret-token';
      const token_hash = crypto.createHash('sha256').update(token).digest('hex');
      const mockInvite = {
        id: 'invite-1',
        workspace_id: 'ws-1',
        status: 'PENDING',
        expires_at: new Date(Date.now() + 10000), // future
        role: 'MEMBER',
        email: 'test@test.com'
      };

      vi.mocked(prisma.workspaceInvitation.findUnique).mockResolvedValue(mockInvite as any);
      vi.mocked(prisma.workspaceInvitation.update).mockResolvedValue(mockInvite as any);
      vi.mocked(prisma.workspaceMember.upsert).mockResolvedValue({} as any);

      const result = await service.acceptInvitation(token, 'user-1', 'test@test.com');

      expect(prisma.workspaceInvitation.findUnique).toHaveBeenCalledWith({ where: { token_hash } });
      expect(prisma.workspaceInvitation.update).toHaveBeenCalledWith({
        where: { id: 'invite-1' },
        data: { status: 'ACCEPTED' }
      });
      expect(result.workspaceId).toBe('ws-1');
    });

    it('should reject if authenticated email does not match invitation email', async () => {
      const token = 'my-secret-token';
      const mockInvite = {
        id: 'invite-1',
        workspace_id: 'ws-1',
        status: 'PENDING',
        expires_at: new Date(Date.now() + 10000), // future
        role: 'MEMBER',
        email: 'test@test.com'
      };

      vi.mocked(prisma.workspaceInvitation.findUnique).mockResolvedValue(mockInvite as any);

      await expect(service.acceptInvitation(token, 'user-2', 'hacker@hacker.com')).rejects.toThrow(BadRequestException);
    });

    it('should throw if expired', async () => {
      const token = 'my-secret-token';
      const token_hash = crypto.createHash('sha256').update(token).digest('hex');
      const mockInvite = {
        id: 'invite-1',
        workspace_id: 'ws-1',
        status: 'PENDING',
        expires_at: new Date(Date.now() - 10000), // past
        role: 'MEMBER',
        email: 'test@test.com'
      };

      vi.mocked(prisma.workspaceInvitation.findUnique).mockResolvedValue(mockInvite as any);
      vi.mocked(prisma.workspaceInvitation.update).mockResolvedValue({} as any);

      await expect(service.acceptInvitation(token, 'user-1', 'test@test.com')).rejects.toThrow(BadRequestException);
    });
  });

  describe('removeMember', () => {
    it('should throw if removing the last owner', async () => {
      vi.mocked(prisma.workspaceMember.findUnique).mockResolvedValue({ role: 'OWNER' } as any);
      vi.mocked(prisma.workspaceMember.count).mockResolvedValue(1);

      await expect(service.removeMember('ws-1', 'user-1')).rejects.toThrow(BadRequestException);
    });

    it('should allow removing an owner if there are other owners', async () => {
      vi.mocked(prisma.workspaceMember.findUnique).mockResolvedValue({ role: 'OWNER' } as any);
      vi.mocked(prisma.workspaceMember.count).mockResolvedValue(2);
      vi.mocked(prisma.workspaceMember.delete).mockResolvedValue({} as any);

      await expect(service.removeMember('ws-1', 'user-1')).resolves.toBeDefined();
    });
  });

  describe('getUserWorkspaces', () => {
    it('should return memberships with participant identity fields for INTERNAL, BUYER, and VENDOR', async () => {
      const mockMemberships = [
        {
          role: 'OWNER',
          participant_type: 'INTERNAL',
          vendor_id: null,
          buyer_id: null,
          workspace: { id: 'ws-1', name: 'Internal WS', slug: 'internal-ws', status: 'ACTIVE' },
        },
        {
          role: 'MEMBER',
          participant_type: 'BUYER',
          vendor_id: null,
          buyer_id: 'buyer-uuid-123',
          workspace: { id: 'ws-2', name: 'Buyer WS', slug: 'buyer-ws', status: 'ACTIVE' },
        },
        {
          role: 'MEMBER',
          participant_type: 'VENDOR',
          vendor_id: 'vendor-uuid-456',
          buyer_id: null,
          workspace: { id: 'ws-3', name: 'Vendor WS', slug: 'vendor-ws', status: 'ACTIVE' },
        },
      ];

      vi.mocked(prisma.workspaceMember.findMany).mockResolvedValue(mockMemberships as any);

      const result = await service.getUserWorkspaces('user-1');

      expect(prisma.workspaceMember.findMany).toHaveBeenCalledWith({
        where: { user_id: 'user-1' },
        include: {
          workspace: true,
          workspace_member_buyers: {
            include: {
              buyer: {
                select: { id: true, name: true },
              },
            },
          },
        },
        orderBy: { created_at: 'asc' },
      });

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({
        id: 'ws-1',
        name: 'Internal WS',
        slug: 'internal-ws',
        status: 'ACTIVE',
        role: 'OWNER',
        participant_type: 'INTERNAL',
        vendor_id: null,
        buyer_id: null,
        buyer_ids: [],
        linked_buyers: [],
      });
      expect(result[1]).toEqual({
        id: 'ws-2',
        name: 'Buyer WS',
        slug: 'buyer-ws',
        status: 'ACTIVE',
        role: 'MEMBER',
        participant_type: 'BUYER',
        vendor_id: null,
        buyer_id: 'buyer-uuid-123',
        buyer_ids: ['buyer-uuid-123'],
        linked_buyers: [],
      });
      expect(result[2]).toEqual({
        id: 'ws-3',
        name: 'Vendor WS',
        slug: 'vendor-ws',
        status: 'ACTIVE',
        role: 'MEMBER',
        participant_type: 'VENDOR',
        vendor_id: 'vendor-uuid-456',
        buyer_id: null,
        buyer_ids: [],
        linked_buyers: [],
      });
    });

    it('should normalize undefined vendor_id and buyer_id to null', async () => {
      const mockMemberships = [
        {
          role: 'MEMBER',
          participant_type: 'INTERNAL',
          vendor_id: undefined,
          buyer_id: undefined,
          workspace: { id: 'ws-4', name: 'WS 4', slug: 'ws-4', status: 'ACTIVE' },
        },
      ];

      vi.mocked(prisma.workspaceMember.findMany).mockResolvedValue(mockMemberships as any);

      const result = await service.getUserWorkspaces('user-2');

      expect(result[0].vendor_id).toBeNull();
      expect(result[0].buyer_id).toBeNull();
    });
  });

  describe('V1 Security: getWorkspaceMembers least privilege & PII disclosure prevention', () => {
    it('should reject caller not belonging to the workspace with ForbiddenException', async () => {
      vi.mocked(prisma.workspaceMember.findUnique).mockResolvedValue(null);

      await expect(service.getWorkspaceMembers('ws-1', 'unauth-user')).rejects.toThrow(ForbiddenException);
    });

    it('should strictly isolate Vendor caller to members of the same vendor_id and suppress emails', async () => {
      vi.mocked(prisma.workspaceMember.findUnique).mockResolvedValue({
        id: 'member-caller',
        workspace_id: 'ws-1',
        user_id: 'user-vendor',
        participant_type: 'VENDOR',
        vendor_id: 'vendor-123',
        role: 'MEMBER',
      } as any);

      const mockVendorMembers = [
        {
          id: 'member-v1',
          user_id: 'user-v1',
          role: 'MEMBER',
          participant_type: 'VENDOR',
          vendor_id: 'vendor-123',
          created_at: new Date(),
          profile: { id: 'user-v1', display_name: 'Vendor Colleague' },
        },
      ];
      vi.mocked(prisma.workspaceMember.findMany).mockResolvedValue(mockVendorMembers as any);

      const members = await service.getWorkspaceMembers('ws-1', 'user-vendor');

      expect(prisma.workspaceMember.findMany).toHaveBeenCalledWith({
        where: {
          workspace_id: 'ws-1',
          participant_type: 'VENDOR',
          vendor_id: 'vendor-123',
        },
        include: { profile: true },
      });
      expect(members).toHaveLength(1);
      expect((members[0] as any).email).toBeUndefined();
      expect(members[0].vendor_id).toBe('vendor-123');
    });

    it('should strictly isolate Buyer caller to members of the same buyer_id and suppress emails', async () => {
      vi.mocked(prisma.workspaceMember.findUnique).mockResolvedValue({
        id: 'member-caller',
        workspace_id: 'ws-1',
        user_id: 'user-buyer',
        participant_type: 'BUYER',
        buyer_id: 'buyer-456',
        role: 'MEMBER',
      } as any);

      const mockBuyerMembers = [
        {
          id: 'member-b1',
          user_id: 'user-b1',
          role: 'MEMBER',
          participant_type: 'BUYER',
          buyer_id: 'buyer-456',
          created_at: new Date(),
          profile: { id: 'user-b1', display_name: 'Buyer Colleague' },
        },
      ];
      vi.mocked(prisma.workspaceMember.findMany).mockResolvedValue(mockBuyerMembers as any);

      const members = await service.getWorkspaceMembers('ws-1', 'user-buyer');

      expect(prisma.workspaceMember.findMany).toHaveBeenCalledWith({
        where: {
          workspace_id: 'ws-1',
          participant_type: 'BUYER',
          buyer_id: 'buyer-456',
        },
        include: { profile: true },
      });
      expect(members).toHaveLength(1);
      expect((members[0] as any).email).toBeUndefined();
    });

    it('should suppress Supabase emails for INTERNAL MEMBER callers', async () => {
      vi.mocked(prisma.workspaceMember.findUnique).mockResolvedValue({
        id: 'member-internal',
        workspace_id: 'ws-1',
        user_id: 'user-internal',
        participant_type: 'INTERNAL',
        role: 'MEMBER',
      } as any);

      vi.mocked(prisma.workspaceMember.findMany).mockResolvedValue([
        {
          id: 'm1',
          user_id: 'u1',
          role: 'OWNER',
          participant_type: 'INTERNAL',
          created_at: new Date(),
          profile: { id: 'u1', display_name: 'Owner User' },
        },
      ] as any);

      const members = await service.getWorkspaceMembers('ws-1', 'user-internal');
      expect((members[0] as any).email).toBeUndefined();
    });
  });

  describe('V2 Security: Vendor invitation role escalation prevention', () => {
    it('should reject creating a VENDOR invitation with OWNER role', async () => {
      await expect(
        service.createInvitation('ws-1', 'vendor@test.com', 'OWNER' as any, 'admin-user', 'VENDOR', 'vendor-123')
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject creating a VENDOR invitation with ADMIN role', async () => {
      await expect(
        service.createInvitation('ws-1', 'vendor@test.com', 'ADMIN' as any, 'admin-user', 'VENDOR', 'vendor-123')
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject creating a VENDOR invitation with missing vendor_id', async () => {
      await expect(
        service.createInvitation('ws-1', 'vendor@test.com', 'MEMBER' as any, 'admin-user', 'VENDOR')
      ).rejects.toThrow(BadRequestException);
    });

    it('should accept creating a VENDOR invitation with MEMBER role and valid vendor_id', async () => {
      vi.mocked(prisma.vendor.findFirst).mockResolvedValue({ id: 'vendor-123', workspace_id: 'ws-1' } as any);
      vi.mocked(prisma.workspaceInvitation.create).mockResolvedValue({
        id: 'inv-v1',
        workspace_id: 'ws-1',
        email: 'vendor@test.com',
        role: 'MEMBER',
        participant_type: 'VENDOR',
        vendor_id: 'vendor-123',
      } as any);

      const res = await service.createInvitation('ws-1', 'vendor@test.com', 'MEMBER' as any, 'admin-user', 'VENDOR', 'vendor-123');
      expect(res.id).toBe('inv-v1');
    });

    it('should normalize VENDOR invitation role down to MEMBER upon acceptance if stored as ADMIN or OWNER', async () => {
      const token = 'escalated-token';
      const token_hash = crypto.createHash('sha256').update(token).digest('hex');
      const escalatedInvite = {
        id: 'invite-esc',
        workspace_id: 'ws-1',
        status: 'PENDING',
        expires_at: new Date(Date.now() + 100000),
        role: 'ADMIN', // Maliciously altered in DB
        participant_type: 'VENDOR',
        vendor_id: 'vendor-123',
        email: 'vendor@test.com',
      };

      vi.mocked(prisma.workspaceInvitation.findUnique).mockResolvedValue(escalatedInvite as any);
      vi.mocked(prisma.workspaceInvitation.update).mockResolvedValue(escalatedInvite as any);
      vi.mocked(prisma.workspaceMember.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.workspaceMember.upsert).mockResolvedValue({ id: 'm-new' } as any);

      await service.acceptInvitation(token, 'user-vendor-1', 'vendor@test.com');

      expect(prisma.workspaceMember.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            role: 'MEMBER', // Normalized down from ADMIN
            participant_type: 'VENDOR',
            vendor_id: 'vendor-123',
          }),
        })
      );
    });
  });

  describe('Financial History Protection & Safe Workspace Deletion', () => {
    it('blocks workspace deletion when wallet transactions exist', async () => {
      vi.mocked(prisma.walletTransaction.count).mockResolvedValue(5);
      vi.mocked(prisma.callCommercial.count).mockResolvedValue(0);
      vi.mocked(prisma.settlementBatch.count).mockResolvedValue(0);

      await expect(service.deleteWorkspace('ws-1')).rejects.toThrow(ConflictException);
      await expect(service.deleteWorkspace('ws-1')).rejects.toThrow(
        /Cannot delete workspace with existing financial history/,
      );
      expect(prisma.workspace.delete).not.toHaveBeenCalled();
    });

    it('blocks workspace deletion when commercial records exist', async () => {
      vi.mocked(prisma.walletTransaction.count).mockResolvedValue(0);
      vi.mocked(prisma.callCommercial.count).mockResolvedValue(3);
      vi.mocked(prisma.settlementBatch.count).mockResolvedValue(0);

      await expect(service.deleteWorkspace('ws-1')).rejects.toThrow(ConflictException);
      expect(prisma.workspace.delete).not.toHaveBeenCalled();
    });

    it('blocks workspace deletion when settlement batches exist', async () => {
      vi.mocked(prisma.walletTransaction.count).mockResolvedValue(0);
      vi.mocked(prisma.callCommercial.count).mockResolvedValue(0);
      vi.mocked(prisma.settlementBatch.count).mockResolvedValue(1);

      await expect(service.deleteWorkspace('ws-1')).rejects.toThrow(ConflictException);
      expect(prisma.workspace.delete).not.toHaveBeenCalled();
    });

    it('allows workspace deletion when zero financial records exist', async () => {
      vi.mocked(prisma.walletTransaction.count).mockResolvedValue(0);
      vi.mocked(prisma.callCommercial.count).mockResolvedValue(0);
      vi.mocked(prisma.settlementBatch.count).mockResolvedValue(0);
      vi.mocked(prisma.workspace.delete).mockResolvedValue({ id: 'ws-empty' } as any);

      const result = await service.deleteWorkspace('ws-empty');
      expect(prisma.workspace.delete).toHaveBeenCalledWith({ where: { id: 'ws-empty' } });
      expect(result).toEqual({ id: 'ws-empty' });
    });
  });
});
