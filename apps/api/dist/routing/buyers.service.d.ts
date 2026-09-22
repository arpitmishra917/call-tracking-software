import { PrismaService } from '../prisma/prisma.service.js';
export declare class BuyersService {
    private prisma;
    constructor(prisma: PrismaService);
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
    createBuyer(workspaceId: string, name: string, destinationNumber: string, timeout?: number): Promise<{
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
