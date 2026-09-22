import { BlockedCallersService } from '../routing/blocked-callers.service.js';
export declare class PublicBlockedNumbersController {
    private readonly blockedCallersService;
    constructor(blockedCallersService: BlockedCallersService);
    listBlockedNumbers(workspaceId: string): Promise<{
        id: string;
        workspace_id: string;
        created_at: Date;
        updated_at: Date;
        phone_number: string;
        reason: string | null;
    }[]>;
    blockNumber(workspaceId: string, phoneNumber: string, reason?: string): Promise<{
        id: string;
        workspace_id: string;
        created_at: Date;
        updated_at: Date;
        phone_number: string;
        reason: string | null;
    }>;
    unblockNumber(workspaceId: string, id: string): Promise<{
        id: string;
        workspace_id: string;
        created_at: Date;
        updated_at: Date;
        phone_number: string;
        reason: string | null;
    }>;
}
