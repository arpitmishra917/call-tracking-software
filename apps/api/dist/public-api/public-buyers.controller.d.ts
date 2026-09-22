import { BuyersService } from '../routing/buyers.service.js';
export declare class PublicBuyersController {
    private readonly buyersService;
    constructor(buyersService: BuyersService);
    listBuyers(workspaceId: string): Promise<{
        id: string;
        workspace_id: string;
        created_at: Date;
        updated_at: Date;
        name: string;
        status: string;
        destination_number: string;
        timeout: number;
    }[]>;
    getBuyer(workspaceId: string, id: string): Promise<{
        id: string;
        workspace_id: string;
        created_at: Date;
        updated_at: Date;
        name: string;
        status: string;
        destination_number: string;
        timeout: number;
    }>;
    createBuyer(workspaceId: string, name: string, destinationNumberE164: string, timeout?: number): Promise<{
        id: string;
        workspace_id: string;
        created_at: Date;
        updated_at: Date;
        name: string;
        status: string;
        destination_number: string;
        timeout: number;
    }>;
}
