import { ApiKeysService } from './api-keys.service.js';
export declare class ApiKeysController {
    private readonly apiKeysService;
    constructor(apiKeysService: ApiKeysService);
    listKeys(workspaceId: string): Promise<{
        id: string;
        workspace_id: string;
        created_at: Date;
        name: string;
        key_prefix: string;
        last_used_at: Date | null;
        revoked_at: Date | null;
    }[]>;
    createKey(workspaceId: string, name: string, req: any): Promise<{
        rawSecret: string;
        id: string;
        workspace_id: string;
        created_at: Date;
        name: string;
        user_id: string;
        key_prefix: string;
        hashed_secret: string;
        last_used_at: Date | null;
        revoked_at: Date | null;
    }>;
    revokeKey(workspaceId: string, id: string): Promise<{
        id: string;
        workspace_id: string;
        created_at: Date;
        name: string;
        user_id: string;
        key_prefix: string;
        hashed_secret: string;
        last_used_at: Date | null;
        revoked_at: Date | null;
    }>;
}
