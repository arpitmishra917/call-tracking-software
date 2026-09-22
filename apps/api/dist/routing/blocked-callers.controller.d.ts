import { BlockedCallersService } from './blocked-callers.service.js';
export declare class BlockedCallersController {
    private readonly blockedCallersService;
    constructor(blockedCallersService: BlockedCallersService);
    list(workspaceId: string): Promise<{
        id: string;
        workspace_id: string;
        created_at: Date;
        updated_at: Date;
        phone_number: string;
        reason: string | null;
    }[]>;
    block(workspaceId: string, body: {
        phoneNumber: string;
        reason?: string;
    }): Promise<{
        id: string;
        workspace_id: string;
        created_at: Date;
        updated_at: Date;
        phone_number: string;
        reason: string | null;
    }>;
    unblock(workspaceId: string, id: string): Promise<{
        id: string;
        workspace_id: string;
        created_at: Date;
        updated_at: Date;
        phone_number: string;
        reason: string | null;
    }>;
}
