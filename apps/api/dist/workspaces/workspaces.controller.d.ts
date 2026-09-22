import { WorkspacesService } from './workspaces.service.js';
export declare class WorkspacesController {
    private readonly workspacesService;
    constructor(workspacesService: WorkspacesService);
    createWorkspace(req: any, body: {
        name: string;
    }): Promise<{
        id: string;
        created_at: Date;
        updated_at: Date;
        name: string;
        status: string;
        slug: string;
    }>;
    getUserWorkspaces(req: any): Promise<{
        role: import("@prisma/client").$Enums.WorkspaceRole;
        id: string;
        created_at: Date;
        updated_at: Date;
        name: string;
        status: string;
        slug: string;
    }[]>;
    getWorkspace(workspaceId: string): Promise<{
        id: string;
        created_at: Date;
        updated_at: Date;
        name: string;
        status: string;
        slug: string;
    } | null>;
    getMembers(workspaceId: string): Promise<({
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
    updateSettings(workspaceId: string, data: {
        name: string;
    }): Promise<{
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
