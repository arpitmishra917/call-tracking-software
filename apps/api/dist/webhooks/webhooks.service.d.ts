import { OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
export declare class WebhooksService implements OnModuleInit, OnModuleDestroy {
    private readonly prisma;
    private readonly logger;
    private timer;
    private readonly algorithm;
    private readonly keyLength;
    constructor(prisma: PrismaService);
    onModuleInit(): void;
    onModuleDestroy(): void;
    private getEncryptionKey;
    private encrypt;
    private decrypt;
    private generateSecret;
    createWebhook(workspaceId: string, url: string): Promise<{
        secret: string;
        id: string;
        workspace_id: string;
        created_at: Date;
        updated_at: Date;
        url: string;
        secret_encrypted: string;
        status: string;
    }>;
    getWebhooks(workspaceId: string): Promise<{
        id: string;
        created_at: Date;
        url: string;
        status: string;
    }[]>;
    deleteWebhook(workspaceId: string, id: string): Promise<{
        id: string;
        workspace_id: string;
        created_at: Date;
        updated_at: Date;
        url: string;
        secret_encrypted: string;
        status: string;
    }>;
    queueEvent(workspaceId: string, eventType: string, payload: any): Promise<void>;
    private processDeliveries;
    attemptDelivery(delivery: any): Promise<void>;
    private markFailed;
}
