import { BuyersService } from './buyers.service.js';
export declare class BuyersController {
    private readonly buyersService;
    constructor(buyersService: BuyersService);
    list(workspaceId: string): Promise<{
        id: string;
        workspace_id: string;
        created_at: Date;
        updated_at: Date;
        name: string;
        status: string;
        destination_number: string;
        timeout: number;
    }[]>;
    get(workspaceId: string, id: string): Promise<{
        id: string;
        workspace_id: string;
        created_at: Date;
        updated_at: Date;
        name: string;
        status: string;
        destination_number: string;
        timeout: number;
    }>;
    create(workspaceId: string, body: {
        name: string;
        destinationNumber: string;
        timeout?: number;
    }): Promise<{
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
