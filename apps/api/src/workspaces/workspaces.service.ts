import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

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
    return this.prisma.workspaceMember.delete({
      where: {
        workspace_id_user_id: {
          workspace_id: workspaceId,
          user_id: userId,
        },
      },
    });
  }
}
