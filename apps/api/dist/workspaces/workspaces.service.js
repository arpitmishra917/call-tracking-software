var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
let WorkspacesService = class WorkspacesService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async createWorkspace(userId, name) {
        if (!name || name.trim().length === 0) {
            throw new BadRequestException('Workspace name is required');
        }
        const baseSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'workspace';
        const slug = `${baseSlug}-${Math.floor(Math.random() * 10000)}`;
        return this.prisma.$transaction(async (tx) => {
            await tx.profile.upsert({
                where: { id: userId },
                update: {},
                create: { id: userId },
            });
            const workspace = await tx.workspace.create({
                data: {
                    name: name.trim(),
                    slug,
                    status: 'ACTIVE',
                },
            });
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
    async getUserWorkspaces(userId) {
        const memberships = await this.prisma.workspaceMember.findMany({
            where: { user_id: userId },
            include: { workspace: true },
        });
        return memberships.map((m) => ({
            ...m.workspace,
            role: m.role,
        }));
    }
    async getWorkspaceInfo(workspaceId) {
        return this.prisma.workspace.findUnique({
            where: { id: workspaceId },
        });
    }
    async getWorkspaceMembers(workspaceId) {
        return this.prisma.workspaceMember.findMany({
            where: { workspace_id: workspaceId },
            include: { profile: true },
        });
    }
    async updateWorkspaceSettings(workspaceId, data) {
        return this.prisma.workspace.update({
            where: { id: workspaceId },
            data: { name: data.name },
        });
    }
    async removeMember(workspaceId, userId) {
        return this.prisma.workspaceMember.delete({
            where: {
                workspace_id_user_id: {
                    workspace_id: workspaceId,
                    user_id: userId,
                },
            },
        });
    }
};
WorkspacesService = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [PrismaService])
], WorkspacesService);
export { WorkspacesService };
//# sourceMappingURL=workspaces.service.js.map