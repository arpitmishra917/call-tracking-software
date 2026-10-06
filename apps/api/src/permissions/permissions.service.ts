import { Injectable, OnModuleInit, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditLogsService } from '../audit-logs/audit-logs.service.js';
import { PERMISSIONS_LIST, ADMIN_BASELINE_PERMISSIONS } from './permissions.constants.js';

@Injectable()
export class PermissionsService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService
  ) {}

  async onModuleInit() {
    await this.seedPermissions();
  }

  async seedPermissions() {
    for (const p of PERMISSIONS_LIST) {
      await this.prisma.permission.upsert({
        where: { key: p.key },
        update: { group: p.group, description: p.description },
        create: { key: p.key, group: p.group, description: p.description },
      });
    }
  }

  async getAllPermissions() {
    return this.prisma.permission.findMany({
      orderBy: [{ group: 'asc' }, { key: 'asc' }]
    });
  }

  async getPermissionsForUser(workspaceId: string, userId: string) {
    if (!userId) {
      throw new NotFoundException('User ID is required');
    }
    const member = await this.prisma.workspaceMember.findFirst({
      where: { workspace_id: workspaceId, user_id: userId }
    });
    if (!member) {
      throw new NotFoundException('Workspace member not found');
    }
    return this.getMemberPermissions(workspaceId, member.id);
  }

  async getMemberPermissions(workspaceId: string, memberId: string) {
    const member = await this.prisma.workspaceMember.findUnique({
      where: { id: memberId },
      include: { workspaceMemberPermissions: { include: { permission: true } } }
    });

    if (!member || member.workspace_id !== workspaceId) {
      throw new NotFoundException('Workspace member not found');
    }

    if (member.role === 'OWNER') {
      return PERMISSIONS_LIST.map(p => ({ ...p, scope_type: 'ALL', resource_id: null }));
    }
    
    if (member.role === 'ADMIN') {
      return PERMISSIONS_LIST
        .filter(p => ADMIN_BASELINE_PERMISSIONS.includes(p.key))
        .map(p => ({ ...p, scope_type: 'ALL', resource_id: null }));
    }

    return member.workspaceMemberPermissions.map(wmp => ({
      ...wmp.permission,
      scope_type: wmp.scope_type,
      resource_id: wmp.resource_id
    }));
  }

  async hasPermission(workspaceId: string, userId: string, permissionKey: string): Promise<boolean> {
    const member = await this.prisma.workspaceMember.findUnique({
      where: { workspace_id_user_id: { workspace_id: workspaceId, user_id: userId } }
    });

    if (!member) return false;
    if (member.role === 'OWNER') return true;
    if (member.role === 'ADMIN' && ADMIN_BASELINE_PERMISSIONS.includes(permissionKey)) return true;

    const count = await this.prisma.workspaceMemberPermission.count({
      where: {
        workspace_member_id: member.id,
        permission: { key: permissionKey }
      }
    });
    return count > 0;
  }

  async hasAnyPermission(workspaceId: string, userId: string, permissionKeys: string[]): Promise<boolean> {
    const member = await this.prisma.workspaceMember.findUnique({
      where: { workspace_id_user_id: { workspace_id: workspaceId, user_id: userId } }
    });

    if (!member) return false;
    if (member.role === 'OWNER') return true;
    if (member.role === 'ADMIN' && permissionKeys.some(k => ADMIN_BASELINE_PERMISSIONS.includes(k))) return true;

    const count = await this.prisma.workspaceMemberPermission.count({
      where: {
        workspace_member_id: member.id,
        permission: { key: { in: permissionKeys } }
      }
    });
    return count > 0;
  }

  async hasResourceScope(workspaceId: string, userId: string, permissionKey: string, resourceId: string): Promise<boolean> {
    const member = await this.prisma.workspaceMember.findUnique({
      where: { workspace_id_user_id: { workspace_id: workspaceId, user_id: userId } }
    });

    if (!member) return false;
    if (member.role === 'OWNER') return true;
    if (member.role === 'ADMIN' && ADMIN_BASELINE_PERMISSIONS.includes(permissionKey)) return true;

    const permissions = await this.prisma.workspaceMemberPermission.findMany({
      where: {
        workspace_member_id: member.id,
        permission: { key: permissionKey }
      }
    });

    if (permissions.length === 0) return false;

    if (permissions.some(p => p.scope_type === 'ALL')) return true;
    if (permissions.some(p => p.resource_id === resourceId)) return true;

    // Explicit hierarchical scopes for CALL and RECORDING resources
    const permDef = await this.prisma.permission.findUnique({ where: { key: permissionKey } });
    if (permDef && (permDef.group === 'CALLS' || permDef.group === 'RECORDINGS' || permissionKey === 'call:recording_read')) {
      const call = permDef.group === 'RECORDINGS' || permissionKey === 'call:recording_read' 
        ? (await this.prisma.recording.findUnique({ where: { id: resourceId }, include: { call: { include: { attempts: true } } } }))?.call
        : await this.prisma.call.findUnique({ where: { id: resourceId }, include: { attempts: true } });
        
      if (call) {
        if (permissions.some(p => p.scope_type === 'CAMPAIGN' && p.resource_id === call.campaign_id)) return true;
        
        const phoneScopeIds = permissions.filter(p => p.scope_type === 'PHONE_NUMBER' && p.resource_id).map(p => p.resource_id);
        if (phoneScopeIds.length > 0) {
          const phone = await this.prisma.phoneNumber.findFirst({
            where: { id: { in: phoneScopeIds as string[] }, phone_number: call.to_number }
          });
          if (phone) return true;
        }
        
        const buyerScopeIds = permissions.filter(p => p.scope_type === 'BUYER' && p.resource_id).map(p => p.resource_id);
        if (buyerScopeIds.length > 0) {
          if (call.attempts.some(a => buyerScopeIds.includes(a.buyer_id))) return true;
        }
      }
    }

    if (permissions.some(p => p.scope_type === 'ASSIGNED')) {
      const permDef = await this.prisma.permission.findUnique({ where: { key: permissionKey } });
      if (!permDef) return false;

      // BUYER resource: direct check
      if (permDef.group === 'BUYERS' && member.buyer_id === resourceId) return true;
      
      // VENDOR resource: direct check
      if (permDef.group === 'VENDORS' && member.vendor_id === resourceId) return true;
      
      // CAMPAIGN resource
      if (permDef.group === 'CAMPAIGNS' && member.buyer_id) {
        const cb = await this.prisma.campaignBuyer.findUnique({
          where: { campaign_id_buyer_id: { campaign_id: resourceId, buyer_id: member.buyer_id } }
        });
        if (cb) return true;
      }
      
      // PHONE_NUMBER resource
      if (permDef.group === 'PHONE_NUMBERS' && member.buyer_id) {
        const pn = await this.prisma.phoneNumber.findUnique({
          where: { id: resourceId },
          include: { campaign: { include: { buyers: true } } }
        });
        if (pn?.campaign?.buyers.some(b => b.buyer_id === member.buyer_id)) return true;
      }



      // CALL resource
      if (permDef.group === 'CALLS' && permissionKey !== 'call:recording_read') {
        const call = await this.prisma.call.findUnique({
          where: { id: resourceId },
          include: {
            attempts: true,
            campaign: { include: { buyers: true } }
          }
        });
        if (!call) return false;
        
        // 1. Implicit ASSIGNED scope
        if (member.buyer_id) {
          if (call.attempts.some(a => a.buyer_id === member.buyer_id)) return true;
          if (call.campaign?.buyers.some(b => b.buyer_id === member.buyer_id)) return true;
        }
      }

      // RECORDING resource
      if (permDef.group === 'RECORDINGS' || permissionKey === 'call:recording_read') {
        const rec = await this.prisma.recording.findUnique({
          where: { id: resourceId },
          include: {
            call: {
              include: { attempts: true, campaign: { include: { buyers: true } } }
            }
          }
        });
        if (!rec || !rec.call) return false;
        
        // 1. Implicit ASSIGNED scope
        if (member.buyer_id) {
          if (rec.call.attempts.some(a => a.buyer_id === member.buyer_id)) return true;
          if (rec.call.campaign?.buyers.some(b => b.buyer_id === member.buyer_id)) return true;
        }
      }
    }

    return false;
  }

  async assignPermission(workspaceId: string, callerUserId: string, targetMemberId: string, permissionKey: string, scopeType: string = 'ALL', resourceId?: string) {
    const callerMember = await this.prisma.workspaceMember.findUnique({
      where: { workspace_id_user_id: { workspace_id: workspaceId, user_id: callerUserId } }
    });

    if (!callerMember || (callerMember.role !== 'OWNER' && callerMember.role !== 'ADMIN')) {
      throw new ForbiddenException('You do not have authority to assign permissions in this workspace');
    }

    if (callerMember.id === targetMemberId) {
      throw new ForbiddenException('You cannot modify your own permissions');
    }

    const targetMember = await this.prisma.workspaceMember.findUnique({
      where: { id: targetMemberId }
    });

    if (!targetMember || targetMember.workspace_id !== workspaceId) {
      throw new NotFoundException('Target member not found in this workspace');
    }

    const permission = await this.prisma.permission.findUnique({
      where: { key: permissionKey }
    });

    if (!permission) {
      throw new BadRequestException('Unknown permission key');
    }

    if (scopeType === 'ASSIGNED' && resourceId) throw new BadRequestException('ASSIGNED scope cannot have a specific resource ID');
    if (scopeType === 'ALL' && resourceId) throw new BadRequestException('ALL scope cannot have a specific resource ID');
    if (['CAMPAIGN', 'PHONE_NUMBER', 'BUYER', 'VENDOR'].includes(scopeType) && !resourceId) {
       throw new BadRequestException('Resource ID is required for this scope type');
    }

    if (resourceId) {
      let valid = false;
      if (scopeType === 'CAMPAIGN') {
        const campaign = await this.prisma.campaign.findUnique({ where: { id: resourceId } });
        if (campaign && campaign.workspace_id === workspaceId) valid = true;
      } else if (scopeType === 'PHONE_NUMBER') {
        const pn = await this.prisma.phoneNumber.findUnique({ where: { id: resourceId } });
        if (pn && pn.workspace_id === workspaceId) valid = true;
      } else if (scopeType === 'BUYER') {
        const b = await this.prisma.buyer.findUnique({ where: { id: resourceId } });
        if (b && b.workspace_id === workspaceId) valid = true;
      } else if (scopeType === 'VENDOR') {
        const v = await this.prisma.vendor.findUnique({ where: { id: resourceId } });
        if (v && v.workspace_id === workspaceId) valid = true;
      }
      
      if (!valid) throw new BadRequestException('Invalid or cross-workspace resource ID');
    }

    const existing = await this.prisma.workspaceMemberPermission.findFirst({
      where: {
        workspace_member_id: targetMember.id,
        permission_id: permission.id,
        scope_type: scopeType as any,
        resource_id: resourceId || null
      }
    });

    if (existing) {
      throw new BadRequestException('Permission already assigned to this member');
    }

    const result = await this.prisma.workspaceMemberPermission.create({
      data: {
        workspace_id: workspaceId,
        workspace_member_id: targetMember.id,
        permission_id: permission.id,
        scope_type: scopeType as any,
        resource_id: resourceId || null
      }
    });

    await this.auditLogsService.logAction({
      workspaceId,
      actorUserId: callerUserId,
      actorMemberId: callerMember.id,
      action: 'PERMISSION_ASSIGNED',
      targetType: 'WORKSPACE_MEMBER',
      targetId: targetMember.id,
      metadata: {
        permissionKey,
        scopeType,
        resourceId
      }
    });

    return result;
  }

  async removePermission(workspaceId: string, callerUserId: string, targetMemberId: string, permissionKey: string, scopeType: string = 'ALL', resourceId?: string) {
    const callerMember = await this.prisma.workspaceMember.findUnique({
      where: { workspace_id_user_id: { workspace_id: workspaceId, user_id: callerUserId } }
    });

    if (!callerMember || (callerMember.role !== 'OWNER' && callerMember.role !== 'ADMIN')) {
      throw new ForbiddenException('You do not have authority to manage permissions in this workspace');
    }

    if (callerMember.id === targetMemberId) {
      throw new ForbiddenException('You cannot modify your own permissions');
    }

    const targetMember = await this.prisma.workspaceMember.findUnique({
      where: { id: targetMemberId }
    });

    if (!targetMember || targetMember.workspace_id !== workspaceId) {
      throw new NotFoundException('Target member not found in this workspace');
    }

    const permission = await this.prisma.permission.findUnique({
      where: { key: permissionKey }
    });

    if (!permission) {
      throw new BadRequestException('Unknown permission key');
    }

    const existing = await this.prisma.workspaceMemberPermission.findFirst({
      where: {
        workspace_member_id: targetMember.id,
        permission_id: permission.id,
        scope_type: scopeType as any,
        resource_id: resourceId || null
      }
    });

    if (!existing) {
      throw new BadRequestException('Permission not assigned to this member');
    }

    await this.prisma.workspaceMemberPermission.delete({
      where: { id: existing.id }
    });

    await this.auditLogsService.logAction({
      workspaceId,
      actorUserId: callerUserId,
      actorMemberId: callerMember.id,
      action: 'PERMISSION_REVOKED',
      targetType: 'WORKSPACE_MEMBER',
      targetId: targetMember.id,
      metadata: {
        permissionKey,
        scopeType,
        resourceId
      }
    });

    return { success: true };
  }
}

