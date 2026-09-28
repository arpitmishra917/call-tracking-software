import { Test, TestingModule } from '@nestjs/testing';
import { WorkspacesService } from './workspaces.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { BadRequestException, NotFoundException } from '@nestjs/common';
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
            workspace: { create: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
            workspaceMember: { create: vi.fn(), delete: vi.fn(), count: vi.fn(), findUnique: vi.fn(), update: vi.fn(), upsert: vi.fn() },
            workspaceInvitation: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
          },
        },
      ],
    }).compile();

    service = module.get<WorkspacesService>(WorkspacesService);
    prisma = module.get<PrismaService>(PrismaService);
  });

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
});
