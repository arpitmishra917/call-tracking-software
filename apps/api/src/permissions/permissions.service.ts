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

    // Implicit permissions based on role
    if (member.role === 'OWNER') {
      return PERMISSIONS_LIST;
    }
    
    if (member.role === 'ADMIN') {
      return PERMISSIONS_LIST.filter(p => ADMIN_BASELINE_PERMISSIONS.includes(p.key));
    }

    // Explicit permissions for MEMBER / VIEWER
    return member.workspaceMemberPermissions.map(wmp => wmp.permission);
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

  async assignPermission(workspaceId: string, callerUserId: string, targetMemberId: string, permissionKey: string) {
    // 1. Authenticate caller and their authority
    const callerMember = await this.prisma.workspaceMember.findUnique({
      where: { workspace_id_user_id: { workspace_id: workspaceId, user_id: callerUserId } }
    });

    if (!callerMember || (callerMember.role !== 'OWNER' && callerMember.role !== 'ADMIN')) {
      throw new ForbiddenException('You do not have authority to assign permissions in this workspace');
    }

    // 2. Prevent self-escalation
    if (callerMember.id === targetMemberId) {
      throw new ForbiddenException('You cannot modify your own permissions');
    }

    // 3. Verify target member belongs to the exact same workspace
    const targetMember = await this.prisma.workspaceMember.findUnique({
      where: { id: targetMemberId }
    });

    if (!targetMember || targetMember.workspace_id !== workspaceId) {
      throw new NotFoundException('Target member not found in this workspace');
    }

    // 4. Verify permission exists
    const permission = await this.prisma.permission.findUnique({
      where: { key: permissionKey }
    });

    if (!permission) {
      throw new BadRequestException('Unknown permission key');
    }

    // 5. Check if already assigned
    const existing = await this.prisma.workspaceMemberPermission.findUnique({
      where: {
        workspace_member_id_permission_id: {
          workspace_member_id: targetMember.id,
          permission_id: permission.id
        }
      }
    });

    if (existing) {
      throw new BadRequestException('Permission already assigned to this member');
    }

    // 6. Assign
    return this.prisma.workspaceMemberPermission.create({
      data: {
        workspace_id: workspaceId,
        workspace_member_id: targetMember.id,
        permission_id: permission.id
      }
    });
  }

  async removePermission(workspaceId: string, callerUserId: string, targetMemberId: string, permissionKey: string) {
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

    const existing = await this.prisma.workspaceMemberPermission.findUnique({
      where: {
        workspace_member_id_permission_id: {
          workspace_member_id: targetMember.id,
          permission_id: permission.id
        }
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
