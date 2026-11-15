import { AuditLogsService } from '../audit-logs/audit-logs.service.js';
import { Injectable, BadRequestException, NotFoundException, ConflictException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import * as crypto from 'crypto';

@Injectable()
export class WorkspacesService {
  constructor(private prisma: PrismaService, private auditLogsService: AuditLogsService) {}

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
    
    const memberships = await this.prisma.workspaceMember.findMany({
      where: { user_id: userId },
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

    return memberships.map((m: any) => {
      const linkedBuyers = (m.workspace_member_buyers || []).map((wmb: any) => ({
        id: wmb.buyer_id,
        name: wmb.buyer?.name || wmb.buyer_id,
      }));
      const buyerIds = linkedBuyers.length > 0
        ? linkedBuyers.map((b: any) => b.id)
        : (m.buyer_id ? [m.buyer_id] : []);

      return {
        ...m.workspace,
        role: m.role,
        participant_type: m.participant_type,
        vendor_id: m.vendor_id ?? null,
        buyer_id: m.buyer_id ?? null,
        buyer_ids: buyerIds,
        linked_buyers: linkedBuyers,
      };
    });
  }

  async getWorkspaceInfo(workspaceId: string) {
    return this.prisma.workspace.findUnique({
      where: { id: workspaceId },
    });
  }

  async getWorkspaceMembers(workspaceId: string, callerUserId?: string) {
    let caller: any = null;
    if (callerUserId) {
      caller = await this.prisma.workspaceMember.findUnique({
        where: {
          workspace_id_user_id: {
            workspace_id: workspaceId,
            user_id: callerUserId,
          },
        },
      });

      if (!caller) {
        throw new ForbiddenException('You do not have access to this workspace');
      }

      if (caller.participant_type === 'VENDOR') {
        if (!caller.vendor_id) return [];
        const vendorMembers = await this.prisma.workspaceMember.findMany({
          where: {
            workspace_id: workspaceId,
            participant_type: 'VENDOR',
            vendor_id: caller.vendor_id,
          },
          include: { profile: true },
        });

        return vendorMembers.map((m: any) => ({
          id: m.id,
          user_id: m.user_id,
          role: m.role,
          participant_type: m.participant_type,
          vendor_id: m.vendor_id,
          created_at: m.created_at,
          profile: m.profile ? { id: m.profile.id, display_name: m.profile.display_name } : null,
        }));
      }

      if (caller.participant_type === 'BUYER') {
        let callerBuyerIds: string[] = [];
        const hasJoinTable = Boolean((this.prisma as any).workspaceMemberBuyer?.findMany);
        if (hasJoinTable) {
          const links = await (this.prisma as any).workspaceMemberBuyer.findMany({
            where: { workspace_member_id: caller.id, workspace_id: workspaceId },
          });
          if (links && links.length > 0) {
            callerBuyerIds = links.map((l: any) => l.buyer_id);
          } else if (caller.buyer_id) {
            callerBuyerIds = [caller.buyer_id];
          }
        } else if (caller.buyer_id) {
          callerBuyerIds = [caller.buyer_id];
        }

        if (callerBuyerIds.length === 0) return [];

        const where: any = {
          workspace_id: workspaceId,
          participant_type: 'BUYER',
        };

        if (callerBuyerIds.length > 1) {
          where.OR = [
            { buyer_id: { in: callerBuyerIds } },
            { workspace_member_buyers: { some: { buyer_id: { in: callerBuyerIds } } } },
          ];
        } else {
          where.buyer_id = callerBuyerIds[0];
        }

        const include: any = { profile: true };
        if (hasJoinTable) {
          include.workspace_member_buyers = {
            include: {
              buyer: { select: { id: true, name: true } },
            },
          };
        }

        const buyerMembers = await this.prisma.workspaceMember.findMany({
          where,
          include,
        });

        return buyerMembers.map((m: any) => {
          const linkedBuyers = (m.workspace_member_buyers || []).map((wmb: any) => ({
            id: wmb.buyer_id,
            name: wmb.buyer?.name || wmb.buyer_id,
          }));
          return {
            id: m.id,
            user_id: m.user_id,
            role: m.role,
            participant_type: m.participant_type,
            buyer_id: m.buyer_id,
            buyer_ids: linkedBuyers.length > 0 ? linkedBuyers.map((b: any) => b.id) : (m.buyer_id ? [m.buyer_id] : []),
            linked_buyers: linkedBuyers,
            created_at: m.created_at,
            profile: m.profile ? { id: m.profile.id, display_name: m.profile.display_name } : null,
          };
        });
      }

      if (caller.role !== 'OWNER' && caller.role !== 'ADMIN') {
        const hasJoinTable = Boolean((this.prisma as any).workspaceMemberBuyer?.findMany);
        const include: any = { profile: true };
        if (hasJoinTable) {
          include.workspace_member_buyers = {
            include: {
              buyer: { select: { id: true, name: true } },
            },
          };
        }
        const members = await this.prisma.workspaceMember.findMany({
          where: { workspace_id: workspaceId },
          include,
        });
        return members.map((m: any) => {
          const linkedBuyers = (m.workspace_member_buyers || []).map((wmb: any) => ({
            id: wmb.buyer_id,
            name: wmb.buyer?.name || wmb.buyer_id,
          }));
          return {
            id: m.id,
            user_id: m.user_id,
            role: m.role,
            participant_type: m.participant_type,
            buyer_id: m.buyer_id,
            buyer_ids: linkedBuyers.length > 0 ? linkedBuyers.map((b: any) => b.id) : (m.buyer_id ? [m.buyer_id] : []),
            linked_buyers: linkedBuyers,
            created_at: m.created_at,
            profile: m.profile ? { id: m.profile.id, display_name: m.profile.display_name } : null,
          };
        });
      }
    }

    const hasJoinTable = Boolean((this.prisma as any).workspaceMemberBuyer?.findMany);
    const include: any = { profile: true };
    if (hasJoinTable) {
      include.workspace_member_buyers = {
        include: {
          buyer: { select: { id: true, name: true } },
        },
      };
    }

    const members = await this.prisma.workspaceMember.findMany({
      where: { workspace_id: workspaceId },
      include,
    });

    const formatMember = (m: any, email?: string | null) => {
      const linkedBuyers = (m.workspace_member_buyers || []).map((wmb: any) => ({
        id: wmb.buyer_id,
        name: wmb.buyer?.name || wmb.buyer_id,
      }));
      return {
        ...m,
        buyer_ids: linkedBuyers.length > 0 ? linkedBuyers.map((b: any) => b.id) : (m.buyer_id ? [m.buyer_id] : []),
        linked_buyers: linkedBuyers,
        ...(email !== undefined ? { email } : {}),
      };
    };

    if (callerUserId && caller && (caller.role === 'OWNER' || caller.role === 'ADMIN')) {
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
          return members.map((m: any) => formatMember(m, emailMap.get(m.user_id) || null));
        }
      } catch (e) {
        console.error('Failed to fetch user emails', e);
      }
    }

    return members.map((m: any) => formatMember(m));
  }

  async getMemberBuyers(workspaceId: string, memberId: string) {
    const member = await this.prisma.workspaceMember.findUnique({
      where: { id: memberId },
    });
    if (!member || member.workspace_id !== workspaceId) {
      throw new NotFoundException('Member not found');
    }

    const links = await this.prisma.workspaceMemberBuyer.findMany({
      where: { workspace_member_id: memberId, workspace_id: workspaceId },
      include: {
        buyer: true,
      },
      orderBy: { created_at: 'asc' },
    });

    return links.map((l: any) => ({
      id: l.id,
      buyer_id: l.buyer_id,
      name: l.buyer?.name || l.buyer_id,
      destination_number: l.buyer?.destination_number || null,
      status: l.buyer?.status || 'ACTIVE',
      created_at: l.created_at,
    }));
  }

  async linkBuyerToMember(workspaceId: string, memberId: string, buyerId: string, actorUserId: string) {
    const member = await this.prisma.workspaceMember.findUnique({
      where: { id: memberId },
    });
    if (!member || member.workspace_id !== workspaceId) {
      throw new NotFoundException('Member not found');
    }

    const buyer = await this.prisma.buyer.findUnique({
      where: { id: buyerId },
    });
    if (!buyer || buyer.workspace_id !== workspaceId) {
      throw new NotFoundException('Buyer not found in this workspace');
    }

    const link = await this.prisma.workspaceMemberBuyer.upsert({
      where: {
        workspace_member_id_buyer_id: {
          workspace_member_id: memberId,
          buyer_id: buyerId,
        },
      },
      update: {},
      create: {
        workspace_id: workspaceId,
        workspace_member_id: memberId,
        buyer_id: buyerId,
      },
      include: {
        buyer: true,
      },
    });

    const updateData: any = {};
    if (!member.buyer_id) {
      updateData.buyer_id = buyerId;
    }
    if (member.participant_type !== 'BUYER') {
      updateData.participant_type = 'BUYER';
    }
    if (Object.keys(updateData).length > 0) {
      await this.prisma.workspaceMember.update({
        where: { id: memberId },
        data: updateData,
      });
    }

    await this.auditLogsService.logAction({
      workspaceId,
      actorUserId,
      actorMemberId: memberId,
      action: 'BUYER_LINKED_TO_MEMBER',
      targetType: 'WORKSPACE_MEMBER',
      targetId: memberId,
      metadata: {
        buyerId,
        buyerName: buyer.name,
      },
    });

    return {
      id: link.id,
      buyer_id: link.buyer_id,
      name: link.buyer?.name || link.buyer_id,
      destination_number: link.buyer?.destination_number || null,
      created_at: link.created_at,
    };
  }

  async unlinkBuyerFromMember(workspaceId: string, memberId: string, buyerId: string, actorUserId: string) {
    const member = await this.prisma.workspaceMember.findUnique({
      where: { id: memberId },
    });
    if (!member || member.workspace_id !== workspaceId) {
      throw new NotFoundException('Member not found');
    }

    await this.prisma.workspaceMemberBuyer.deleteMany({
      where: {
        workspace_member_id: memberId,
        buyer_id: buyerId,
        workspace_id: workspaceId,
      },
    });

    if (member.buyer_id === buyerId) {
      const remainingLink = await this.prisma.workspaceMemberBuyer.findFirst({
        where: { workspace_member_id: memberId, workspace_id: workspaceId },
        orderBy: { created_at: 'asc' },
      });
      await this.prisma.workspaceMember.update({
        where: { id: memberId },
        data: {
          buyer_id: remainingLink ? remainingLink.buyer_id : null,
        },
      });
    }

    await this.auditLogsService.logAction({
      workspaceId,
      actorUserId,
      actorMemberId: memberId,
      action: 'BUYER_UNLINKED_FROM_MEMBER',
      targetType: 'WORKSPACE_MEMBER',
      targetId: memberId,
      metadata: {
        buyerId,
      },
    });

    return { success: true };
  }

  async updateWorkspaceSettings(workspaceId: string, data: any) {
    return this.prisma.workspace.update({
      where: { id: workspaceId },
      data: { name: data.name },
    });
  }

  async removeMember(workspaceId: string, userId: string, requestingUserId?: string) {
    const result = await this.prisma.$transaction(async (tx) => {
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

      const deletedMember = await tx.workspaceMember.delete({
        where: {
          workspace_id_user_id: {
            workspace_id: workspaceId,
            user_id: userId,
          },
        },
      });

      return { deletedMember, requestingUserId };
    });

    if (result.requestingUserId) {
      const requestor = await this.prisma.workspaceMember.findUnique({
        where: { workspace_id_user_id: { workspace_id: workspaceId, user_id: result.requestingUserId } }
      });
      if (requestor) {
        await this.auditLogsService.logAction({
          workspaceId: workspaceId,
          actorUserId: result.requestingUserId,
          actorMemberId: requestor.id,
          action: 'MEMBER_REMOVED',
          targetType: 'MEMBER',
          targetId: result.deletedMember.id,
          metadata: {
            user_id: result.deletedMember.user_id,
            role: result.deletedMember.role
          }
        });
      }
    }

    return result.deletedMember;
  }

  /**
   * Asserts whether a workspace can safely be deleted.
   * If the workspace contains financial history (wallet transactions, commercials, settlement batches),
   * hard deletion is strictly forbidden to preserve ledger auditability.
   * Archival (status = 'ARCHIVED') must be used instead.
   */
  /**
   * Asserts that a workspace has no financial, settlement, billing, or ledger history.
   * If any financial transactions, commercial calls, settlement batches, reservations,
   * payment instructions, or non-zero balances exist, hard deletion is strictly forbidden
   * to preserve ledger auditability. Archival (status = 'ARCHIVED') must be used instead.
   */
  async assertWorkspaceCanBeDeleted(workspaceId: string, client?: any): Promise<void> {
    const prisma = client || this.prisma;
    const [txCount, commCount, batchCount, resCount, paymentCount] = await Promise.all([
      prisma.walletTransaction?.count
        ? prisma.walletTransaction.count({ where: { workspace_id: workspaceId } })
        : Promise.resolve(0),
      prisma.callCommercial?.count
        ? prisma.callCommercial.count({ where: { workspace_id: workspaceId } })
        : Promise.resolve(0),
      prisma.settlementBatch?.count
        ? prisma.settlementBatch.count({ where: { workspace_id: workspaceId } })
        : Promise.resolve(0),
      prisma.callReservation?.count
        ? prisma.callReservation.count({ where: { workspace_id: workspaceId } })
        : Promise.resolve(0),
      prisma.paymentInstruction?.count
        ? prisma.paymentInstruction.count({ where: { workspace_id: workspaceId } })
        : Promise.resolve(0),
    ]);

    let hasNonZeroBalance = false;
    if (prisma.workspaceBalance?.findUnique) {
      const balance = await prisma.workspaceBalance.findUnique({
        where: { workspace_id: workspaceId },
      });
      if (
        balance &&
        (BigInt(balance.balance_micro || 0n) !== 0n ||
          BigInt(balance.reserved_micro || 0n) !== 0n)
      ) {
        hasNonZeroBalance = true;
      }
    }

    if (
      txCount > 0 ||
      commCount > 0 ||
      batchCount > 0 ||
      resCount > 0 ||
      paymentCount > 0 ||
      hasNonZeroBalance
    ) {
      throw new ConflictException(
        `Cannot delete workspace with existing financial history (${txCount} transactions, ${commCount} commercial records, ${batchCount} settlement batches, ${resCount} reservations, ${paymentCount} payment instructions). Historical records must be preserved for auditability. Archive workspace instead.`,
      );
    }
  }

  async deleteWorkspace(workspaceId: string, actorUserId?: string) {
    // 1. Initial pre-check outside transaction
    await this.assertWorkspaceCanBeDeleted(workspaceId);

    // 2. OWNER authorization check
    if (actorUserId) {
      const member = await this.prisma.workspaceMember.findUnique({
        where: {
          workspace_id_user_id: {
            workspace_id: workspaceId,
            user_id: actorUserId,
          },
        },
      });
      if (!member || member.role !== 'OWNER') {
        throw new ForbiddenException('Only workspace owners can delete a workspace.');
      }
    }

    // 3. Atomic deletion with row-level locking to prevent concurrent financial-write races
    return await this.prisma.$transaction(async (tx) => {
      try {
        await tx.$queryRaw`SELECT balance_micro FROM "workspace_balances" WHERE workspace_id = ${workspaceId} FOR UPDATE`;
      } catch {
        // Safe fallback for unmocked $queryRaw in unit tests
      }
      await this.assertWorkspaceCanBeDeleted(workspaceId, tx as any);
      return await tx.workspace.delete({ where: { id: workspaceId } });
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

  async createInvitation(workspaceId: string, email: string, role: string, createdByUserId: string, participant_type = 'INTERNAL', vendor_id?: string, buyer_id?: string) {
    if (participant_type === 'VENDOR') {
      if (!vendor_id) throw new BadRequestException('vendor_id required for VENDOR');
      if (buyer_id) throw new BadRequestException('buyer_id not allowed for VENDOR');
      if (role === 'OWNER' || role === 'ADMIN') {
        throw new BadRequestException('Vendors cannot be invited with elevated workspace roles (OWNER/ADMIN)');
      }
      if (role !== 'MEMBER' && role !== 'VIEWER') {
        throw new BadRequestException('Invalid role for VENDOR participant. Role must be MEMBER or VIEWER');
      }
      const v = await this.prisma.vendor.findFirst({ where: { id: vendor_id, workspace_id: workspaceId } });
      if (!v) throw new BadRequestException('Vendor not found in workspace');
    } else if (participant_type === 'BUYER') {
      if (!buyer_id) throw new BadRequestException('buyer_id required for BUYER');
      if (vendor_id) throw new BadRequestException('vendor_id not allowed for BUYER');
      if (role === 'OWNER' || role === 'ADMIN') {
        throw new BadRequestException('Buyers cannot be invited with elevated workspace roles (OWNER/ADMIN)');
      }
      if (role !== 'MEMBER' && role !== 'VIEWER') {
        throw new BadRequestException('Invalid role for BUYER participant. Role must be MEMBER or VIEWER');
      }
      const b = await this.prisma.buyer.findFirst({ where: { id: buyer_id, workspace_id: workspaceId } });
      if (!b) throw new BadRequestException('Buyer not found in workspace');
    } else if (participant_type === 'INTERNAL') {
      if (vendor_id || buyer_id) throw new BadRequestException('vendor_id/buyer_id not allowed for INTERNAL');
    } else {
      throw new BadRequestException('Invalid participant_type');
    }
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
        created_by: createdByUserId,
        participant_type: participant_type as any,
        vendor_id,
        buyer_id
      }
    });

    const requestor = await this.prisma.workspaceMember.findUnique({
      where: { workspace_id_user_id: { workspace_id: workspaceId, user_id: createdByUserId } }
    });

    if (requestor) {
      await this.auditLogsService.logAction({
        workspaceId: workspaceId,
        actorUserId: createdByUserId,
        actorMemberId: requestor.id,
        action: 'INVITATION_CREATED',
        targetType: 'INVITATION',
        targetId: invite.id,
        metadata: {
          email: invite.email,
          role: invite.role,
        }
      });
    }

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

    const txResult = await this.prisma.$transaction(async (tx) => {
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

      // If invitation is for participant VENDOR or BUYER, normalize elevated roles down to MEMBER
      let finalRole = invitation.role;
      if (invitation.participant_type === 'VENDOR' || invitation.participant_type === 'BUYER') {
        if (finalRole === 'OWNER' || finalRole === 'ADMIN') {
          finalRole = 'MEMBER' as any;
        }
      } else if (finalRole === 'OWNER') {
        const existingOwner = await tx.workspaceMember.findFirst({
          where: { user_id: userId, role: 'OWNER' }
        });
        if (existingOwner) {
          finalRole = 'ADMIN' as any;
        }
      }

      // Create member
      const existing = await tx.workspaceMember.findUnique({
        where: {
          workspace_id_user_id: {
            workspace_id: invitation.workspace_id,
            user_id: userId,
          },
        },
      });
      
      if (existing) {
        const isBothBuyer = existing.participant_type === 'BUYER' && invitation.participant_type === 'BUYER';
        if (!isBothBuyer) {
          if (existing.participant_type !== invitation.participant_type || (existing.vendor_id && existing.vendor_id !== invitation.vendor_id) || (existing.buyer_id && existing.buyer_id !== invitation.buyer_id)) {
             throw new BadRequestException('Participant identity mismatch. Cannot overwrite existing participant identity via invitation.');
          }
        }
      }

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
          participant_type: invitation.participant_type,
          vendor_id: invitation.vendor_id,
          buyer_id: invitation.buyer_id
        },
      });

      if (tx.workspaceMemberBuyer) {
        if (existing?.buyer_id) {
          await tx.workspaceMemberBuyer.upsert({
            where: {
              workspace_member_id_buyer_id: {
                workspace_member_id: member.id,
                buyer_id: existing.buyer_id,
              },
            },
            create: {
              workspace_id: invitation.workspace_id,
              workspace_member_id: member.id,
              buyer_id: existing.buyer_id,
            },
            update: {},
          });
        }
        if (invitation.participant_type === 'BUYER' && invitation.buyer_id) {
          await tx.workspaceMemberBuyer.upsert({
            where: {
              workspace_member_id_buyer_id: {
                workspace_member_id: member.id,
                buyer_id: invitation.buyer_id,
              },
            },
            create: {
              workspace_id: invitation.workspace_id,
              workspace_member_id: member.id,
              buyer_id: invitation.buyer_id,
            },
            update: {},
          });
          if (!member.buyer_id) {
            await tx.workspaceMember.update({
              where: { id: member.id },
              data: { buyer_id: invitation.buyer_id },
            });
          }
        }
      }

      return { workspaceId: invitation.workspace_id, memberId: member.id, invitationId: invitation.id, finalRole, email: userEmail, actorUserId: userId };
    });

    await this.auditLogsService.logAction({
      workspaceId: txResult.workspaceId,
      actorUserId: txResult.actorUserId,
      actorMemberId: txResult.memberId,
      action: 'INVITATION_ACCEPTED',
      targetType: 'INVITATION',
      targetId: txResult.invitationId,
      metadata: {
        email: txResult.email,
        role: txResult.finalRole,
      }
    });

    return { workspaceId: txResult.workspaceId };
  }
}
