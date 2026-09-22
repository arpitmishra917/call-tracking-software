import { PrismaService } from '../prisma/prisma.service.js';
import { UsageType } from '@prisma/client';
export declare class UsageService {
    private prisma;
    private readonly logger;
    constructor(prisma: PrismaService);
    recordUsage(workspaceId: string, type: UsageType, quantity: number, sourceId: string | null, idempotencyKey: string): Promise<{
        id: string;
        idempotency_key: string;
        workspace_id: string;
        type: import("@prisma/client").$Enums.UsageType;
        quantity: number;
        source_id: string | null;
        created_at: Date;
        updated_at: Date;
    }>;
}
