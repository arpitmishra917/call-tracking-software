import { Injectable, OnModuleInit, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { PERMISSIONS_LIST, ADMIN_BASELINE_PERMISSIONS } from './permissions.constants.js';

@Injectable()
export class PermissionsService implements OnModuleInit {
  constructor(private readonly prisma: PrismaService) {}

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

    if (permissions.some(p => p.scope_type === 'ASSIGNED')) {
      const permDef = await this.prisma.permission.findUnique({ where: { key: permissionKey } });
      if (!permDef) return false;

      if (permDef.group === 'BUYERS' && member.buyer_id === resourceId) return true;
      if (permDef.group === 'VENDORS' && member.vendor_id === resourceId) return true;
      if (permDef.group === 'CAMPAIGNS' && member.buyer_id) {
        const cb = await this.prisma.campaignBuyer.findUnique({
          where: { campaign_id_buyer_id: { campaign_id: resourceId, buyer_id: member.buyer_id } }
        });
        if (cb) return true;
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

    return this.prisma.workspaceMemberPermission.create({
      data: {
        workspace_id: workspaceId,
        workspace_member_id: targetMember.id,
        permission_id: permission.id,
        scope_type: scopeType as any,
        resource_id: resourceId || null
      }
    });
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

    return { success: true };
  }
}

