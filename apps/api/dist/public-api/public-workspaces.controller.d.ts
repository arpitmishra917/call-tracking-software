import { WorkspacesService } from '../workspaces/workspaces.service.js';
export declare class PublicWorkspacesController {
    private readonly workspacesService;
    constructor(workspacesService: WorkspacesService);
    getWorkspace(workspaceId: string): Promise<{
        id: string;
        created_at: Date;
        updated_at: Date;
        name: string;
        status: string;
        slug: string;
    } | null>;
}
