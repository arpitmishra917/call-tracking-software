import { Injectable, BadRequestException, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import * as crypto from 'crypto';

@Injectable()
export class WorkspacesService {
  constructor(private prisma: PrismaService) {}

  async createWorkspace(userId: string, name: string) {
    if (!name || name.trim().length === 0) {
      throw new BadRequestException('Workspace name is required');
    }

    const baseSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'workspace';
    const slug = `${baseSlug}-${Math.floor(Math.random() * 10000)}`;

    return this.prisma.$transaction(async (tx) => {
      // 1. Ensure Profile exists
      await tx.profile.upsert({
        where: { id: userId },
        update: {},
        create: { id: userId },
      });

      // 2. Create Workspace
      const workspace = await tx.workspace.create({
        data: {
          name: name.trim(),
          slug,
          status: 'ACTIVE',
        },
      });

      // 3. Create WorkspaceMember as OWNER
      await tx.workspaceMember.create({
        data: {
          workspace_id: workspace.id,
          user_id: userId,
          role: 'OWNER',
        },
      });

      return workspace;
    });
  }

  async getUserWorkspaces(userId: string) {
    const memberships = await this.prisma.workspaceMember.findMany({
      where: { user_id: userId },
      include: { workspace: true },
    });
    return memberships.map((m) => ({
      ...m.workspace,
      role: m.role,
    }));
  }

  async getWorkspaceInfo(workspaceId: string) {
    return this.prisma.workspace.findUnique({
      where: { id: workspaceId },
    });
  }

  async getWorkspaceMembers(workspaceId: string) {
    return this.prisma.workspaceMember.findMany({
      where: { workspace_id: workspaceId },
      include: { profile: true },
    });
  }

  async updateWorkspaceSettings(workspaceId: string, data: any) {
    return this.prisma.workspace.update({
      where: { id: workspaceId },
      data: { name: data.name },
    });
  }

  async removeMember(workspaceId: string, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const member = await tx.workspaceMember.findUnique({
        where: { workspace_id_user_id: { workspace_id: workspaceId, user_id: userId } }
      });
      
      if (!member) throw new NotFoundException('Member not found');
      
      if (member.role === 'OWNER') {
        const ownerCount = await tx.workspaceMember.count({
          where: { workspace_id: workspaceId, role: 'OWNER' }
        });
        if (ownerCount <= 1) {
          throw new BadRequestException('Cannot remove the last owner of the workspace');
        }
      }

      return tx.workspaceMember.delete({
        where: {
          workspace_id_user_id: {
            workspace_id: workspaceId,
            user_id: userId,
          },
        },
      });
    });
  }

  async updateWorkspaceStatus(workspaceId: string, status: string, requestingUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      const workspace = await tx.workspace.findUnique({ where: { id: workspaceId } });
      if (!workspace) throw new NotFoundException('Not found');
      return tx.workspace.update({ where: { id: workspaceId }, data: { status } });
    });
  }

  async updateMemberRole(workspaceId: string, targetUserId: string, newRole: string, requestingUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      const member = await tx.workspaceMember.findUnique({
        where: { workspace_id_user_id: { workspace_id: workspaceId, user_id: targetUserId } }
      });
      
      if (!member) throw new NotFoundException('Member not found');

      if (member.role === 'OWNER' && newRole !== 'OWNER') {
        const ownerCount = await tx.workspaceMember.count({
          where: { workspace_id: workspaceId, role: 'OWNER' }
        });
        if (ownerCount <= 1) {
          throw new BadRequestException('Cannot demote the last owner of the workspace');
        }
      }

      return tx.workspaceMember.update({
        where: { workspace_id_user_id: { workspace_id: workspaceId, user_id: targetUserId } },
        data: { role: newRole as any },
      });
    });
  }

  async getWorkspaceInvitations(workspaceId: string) {
    return this.prisma.workspaceInvitation.findMany({
      where: { workspace_id: workspaceId, status: 'PENDING' },
      orderBy: { created_at: 'desc' },
    });
  }

  async createInvitation(workspaceId: string, email: string, role: string, createdByUserId: string) {
    const token = crypto.randomBytes(32).toString('hex');
    const token_hash = crypto.createHash('sha256').update(token).digest('hex');

    const invite = await this.prisma.workspaceInvitation.create({
      data: {
        workspace_id: workspaceId,
        email: email.toLowerCase().trim(),
        role: role as any,
        token_hash: token_hash,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        status: 'PENDING' as any,
        created_by: createdByUserId
      }
    });

    return { ...invite, token };
  }

  async revokeInvitation(workspaceId: string, inviteId: string) {
    return this.prisma.workspaceInvitation.update({
      where: { id: inviteId },
      data: { status: 'REVOKED' as any }
    });
  }

  async acceptInvitation(token: string, userId: string, userEmail: string) {
    if (!token) throw new BadRequestException('Token is required');
    const token_hash = crypto.createHash('sha256').update(token).digest('hex');

    return this.prisma.$transaction(async (tx) => {
      const invitation = await tx.workspaceInvitation.findUnique({
        where: { token_hash },
      });

      if (!invitation) {
        throw new NotFoundException('Invitation not found or invalid');
      }

      if (invitation.status !== 'PENDING') {
        throw new BadRequestException('Invitation is no longer valid');
      }

      if (invitation.expires_at < new Date()) {
        await tx.workspaceInvitation.update({
          where: { id: invitation.id },
          data: { status: 'EXPIRED' as any },
        });
        throw new BadRequestException('Invitation has expired');
      }

      if (invitation.email.toLowerCase() !== userEmail.toLowerCase()) {
        throw new BadRequestException('Invitation was sent to a different email address');
      }

      // Ensure Profile exists
      await tx.profile.upsert({
        where: { id: userId },
        update: {},
        create: { id: userId },
      });

      // Update invitation status
      await tx.workspaceInvitation.update({
        where: { id: invitation.id },
        data: { status: 'ACCEPTED' as any },
      });

      // Create member
      const member = await tx.workspaceMember.upsert({
        where: {
          workspace_id_user_id: {
            workspace_id: invitation.workspace_id,
            user_id: userId,
          },
        },
        update: {
          role: invitation.role,
        },
        create: {
          workspace_id: invitation.workspace_id,
          user_id: userId,
          role: invitation.role,
        },
      });

      return { workspaceId: invitation.workspace_id };
    });
  }
}
