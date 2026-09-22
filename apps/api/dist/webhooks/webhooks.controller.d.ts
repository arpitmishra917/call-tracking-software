import { WebhooksService } from './webhooks.service.js';
export declare class WebhooksController {
    private readonly webhooksService;
    constructor(webhooksService: WebhooksService);
    listWebhooks(workspaceId: string): Promise<{
        id: string;
        created_at: Date;
        url: string;
        status: string;
    }[]>;
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
    deleteWebhook(workspaceId: string, id: string): Promise<{
        id: string;
        workspace_id: string;
        created_at: Date;
        updated_at: Date;
        url: string;
        secret_encrypted: string;
        status: string;
    }>;
}
