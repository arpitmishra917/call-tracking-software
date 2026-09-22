import { PrismaService } from '../prisma/prisma.service.js';
export declare class BlockedCallersService {
    private prisma;
    constructor(prisma: PrismaService);
    listBlockedCallers(workspaceId: string): Promise<{
        id: string;
        workspace_id: string;
        created_at: Date;
        updated_at: Date;
        phone_number: string;
        reason: string | null;
    }[]>;
    blockCaller(workspaceId: string, phoneNumber: string, reason?: string): Promise<{
        id: string;
        workspace_id: string;
        created_at: Date;
        updated_at: Date;
        phone_number: string;
        reason: string | null;
    }>;
    unblockCaller(workspaceId: string, id: string): Promise<{
        id: string;
        workspace_id: string;
        created_at: Date;
        updated_at: Date;
        phone_number: string;
        reason: string | null;
    }>;
}
