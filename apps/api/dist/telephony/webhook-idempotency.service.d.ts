import { PrismaService } from '../prisma/prisma.service.js';
export declare class WebhookIdempotencyService {
    private readonly prisma;
    private readonly logger;
    constructor(prisma: PrismaService);
    acquireLock(provider: string, providerEventId: string, payload: any): Promise<{
        canProcess: boolean;
        id?: string;
    }>;
    markProcessed(id: string): Promise<void>;
    markFailed(id: string, errorMsg: string): Promise<void>;
    markIgnored(id: string, reason?: string): Promise<void>;
}
