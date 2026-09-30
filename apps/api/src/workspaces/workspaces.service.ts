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

    // Check if user already owns a workspace
    const existingOwnerMembership = await this.prisma.workspaceMember.findFirst({
      where: { user_id: userId, role: 'OWNER' },
      include: { workspace: true }
    });

    if (existingOwnerMembership) {
      return existingOwnerMembership.workspace;
    }

    const baseSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'workspace';
    const slug = `${baseSlug}-${Math.floor(Math.random() * 10000)}`;

    try {
      return await this.prisma.$transaction(async (tx) => {
        // 1. Ensure Profile exists
        await tx.profile.upsert({
          where: { id: userId },
          update: {},
          create: { id: userId },
        });

        // 2. Double check inside transaction for race conditions
        const racedMembership = await tx.workspaceMember.findFirst({
          where: { user_id: userId, role: 'OWNER' },
          include: { workspace: true }
        });
        
        if (racedMembership) {
          return racedMembership.workspace;
        }

        // 3. Create Workspace
        const workspace = await tx.workspace.create({
          data: {
            name: name.trim(),
            slug,
            status: 'ACTIVE',
          },
        });

        // 4. Create WorkspaceMember as OWNER
        await tx.workspaceMember.create({
          data: {
            workspace_id: workspace.id,
            user_id: userId,
            role: 'OWNER',
          },
        });

        return workspace;
      });
    } catch (error: any) {
      if (error.code === 'P2002' || error.code === 'P2010') { // Prisma unique constraint or raw sql error
        const existing = await this.prisma.workspaceMember.findFirst({
          where: { user_id: userId, role: 'OWNER' },
          include: { workspace: true }
        });
        if (existing) return existing.workspace;
      }
      throw error;
    }
  }

  async getUserWorkspaces(userId: string) {
    console.log('[WorkspacesService] DIAGNOSTICS - getUserWorkspaces called');
    console.log('[WorkspacesService] DIAGNOSTICS - req.user.userId:', userId);
    
    const memberships = await this.prisma.workspaceMember.findMany({
      where: { user_id: userId },
      include: { workspace: true },
    });
    
    console.log('[WorkspacesService] DIAGNOSTICS - memberships count:', memberships.length);
    memberships.forEach(m => {
      console.log(`[WorkspacesService] DIAGNOSTICS - Workspace ID: ${m.workspace.id}, Name: ${m.workspace.name}, Role: ${m.role}`);
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
    const members = await this.prisma.workspaceMember.findMany({
      where: { workspace_id: workspaceId },
      include: { profile: true },
    });

    try {
      const res = await fetch(`${process.env.SUPABASE_URL}/auth/v1/admin/users`, {
        headers: {
          'apikey': process.env.SUPABASE_SECRET_KEY as string,
          'Authorization': `Bearer ${process.env.SUPABASE_SECRET_KEY}`
        }
      });
      
      if (res.ok) {
        const data = await res.json();
        const users = data.users || [];
        const emailMap = new Map<string, string>();
        for (const u of users) {
          emailMap.set(u.id, u.email);
        }
        return members.map((m: any) => ({
          ...m,
          email: emailMap.get(m.user_id) || null
        }));
      }
    } catch (e) {
      console.error('Failed to fetch user emails', e);
    }

    return members;
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

  async verifyInvitationToken(token: string) {
    if (!token) throw new BadRequestException('Token is required');
    const token_hash = crypto.createHash('sha256').update(token).digest('hex');

    const invitation = await this.prisma.workspaceInvitation.findUnique({
      where: { token_hash },
      include: { workspace: true }
    });

    if (!invitation) {
      throw new NotFoundException('Invitation not found or invalid');
    }

    if (invitation.status === 'PENDING' && invitation.expires_at < new Date()) {
      await this.prisma.workspaceInvitation.update({
        where: { id: invitation.id },
        data: { status: 'EXPIRED' as any },
      });
      invitation.status = 'EXPIRED' as any;
    }

    return {
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      status: invitation.status,
      workspace_name: invitation.workspace.name,
      expires_at: invitation.expires_at
    };
  }

  async acceptInvitation(token: string, userId: string, userEmail: string, fullName?: string) {
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
        update: {
          ...(fullName && { display_name: fullName })
        },
        create: { 
          id: userId,
          display_name: fullName || null 
        },
      });

      // Update invitation status
      await tx.workspaceInvitation.update({
        where: { id: invitation.id },
        data: { status: 'ACCEPTED' as any },
      });

      // If invitation is for OWNER, ensure they don't already own a workspace
      let finalRole = invitation.role;
      if (finalRole === 'OWNER') {
        const existingOwner = await tx.workspaceMember.findFirst({
          where: { user_id: userId, role: 'OWNER' }
        });
        if (existingOwner) {
          finalRole = 'ADMIN' as any;
        }
      }

      // Create member
      const member = await tx.workspaceMember.upsert({
        where: {
          workspace_id_user_id: {
            workspace_id: invitation.workspace_id,
            user_id: userId,
          },
        },
        update: {
          role: finalRole,
        },
        create: {
          workspace_id: invitation.workspace_id,
          user_id: userId,
          role: finalRole,
        },
      });

      return { workspaceId: invitation.workspace_id };
    });
  }
}
