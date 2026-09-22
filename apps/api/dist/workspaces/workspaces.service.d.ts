import { PrismaService } from '../prisma/prisma.service.js';
export declare class WorkspacesService {
    private prisma;
    constructor(prisma: PrismaService);
    createWorkspace(userId: string, name: string): Promise<{
        id: string;
        created_at: Date;
        updated_at: Date;
        name: string;
        status: string;
        slug: string;
    }>;
    getUserWorkspaces(userId: string): Promise<{
        role: import("@prisma/client").$Enums.WorkspaceRole;
        id: string;
        created_at: Date;
        updated_at: Date;
        name: string;
        status: string;
        slug: string;
    }[]>;
    getWorkspaceInfo(workspaceId: string): Promise<{
        id: string;
        created_at: Date;
        updated_at: Date;
        name: string;
        status: string;
        slug: string;
    } | null>;
    getWorkspaceMembers(workspaceId: string): Promise<({
        profile: {
            id: string;
            created_at: Date;
            updated_at: Date;
            display_name: string | null;
        };
    } & {
        id: string;
        workspace_id: string;
        created_at: Date;
        updated_at: Date;
        user_id: string;
        role: import("@prisma/client").$Enums.WorkspaceRole;
    })[]>;
    updateWorkspaceSettings(workspaceId: string, data: any): Promise<{
        id: string;
        created_at: Date;
        updated_at: Date;
        name: string;
        status: string;
        slug: string;
    }>;
    removeMember(workspaceId: string, userId: string): Promise<{
        id: string;
        workspace_id: string;
        created_at: Date;
        updated_at: Date;
        user_id: string;
        role: import("@prisma/client").$Enums.WorkspaceRole;
    }>;
}
