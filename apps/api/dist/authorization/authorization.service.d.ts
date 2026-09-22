import { PrismaService } from '../prisma/prisma.service.js';
import { WorkspaceRole } from '@prisma/client';
export declare class AuthorizationService {
    private prisma;
    constructor(prisma: PrismaService);
    getUserWorkspaceRole(userId: string, workspaceId: string): Promise<WorkspaceRole | null>;
    hasPermission(userRole: WorkspaceRole, allowedRoles: WorkspaceRole[]): boolean;
    validateWorkspaceAccess(userId: string, workspaceId: string, allowedRoles?: WorkspaceRole[]): Promise<import("@prisma/client").$Enums.WorkspaceRole>;
}
