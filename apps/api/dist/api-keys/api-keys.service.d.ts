import { PrismaService } from '../prisma/prisma.service.js';
export declare class ApiKeysService {
    private prisma;
    constructor(prisma: PrismaService);
    createApiKey(workspaceId: string, userId: string, name: string): Promise<{
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
    listApiKeys(workspaceId: string): Promise<{
        id: string;
        workspace_id: string;
        created_at: Date;
        name: string;
        key_prefix: string;
        last_used_at: Date | null;
        revoked_at: Date | null;
    }[]>;
    revokeApiKey(workspaceId: string, id: string): Promise<{
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
    validateApiKey(token: string): Promise<{
        id: string;
        workspace_id: string;
        created_at: Date;
        name: string;
        user_id: string;
        key_prefix: string;
        hashed_secret: string;
        last_used_at: Date | null;
        revoked_at: Date | null;
    } | null>;
}
