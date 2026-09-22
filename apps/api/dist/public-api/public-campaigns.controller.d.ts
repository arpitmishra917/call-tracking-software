import { CampaignsService } from '../routing/campaigns.service.js';
export declare class PublicCampaignsController {
    private readonly campaignsService;
    constructor(campaignsService: CampaignsService);
    listCampaigns(workspaceId: string): Promise<({
        phone_numbers: {
            id: string;
            workspace_id: string;
            created_at: Date;
            updated_at: Date;
            name: string | null;
            status: import("@prisma/client").$Enums.PhoneNumberStatus;
            campaign_id: string | null;
            provider: string;
            phone_number: string;
            provider_number_id: string | null;
            connection_id: string | null;
        }[];
        buyers: ({
            buyer: {
                id: string;
                workspace_id: string;
                created_at: Date;
                updated_at: Date;
                name: string;
                status: string;
                destination_number: string;
                timeout: number;
            };
        } & {
            id: string;
            workspace_id: string;
            created_at: Date;
            updated_at: Date;
            status: string;
            campaign_id: string;
            buyer_id: string;
            priority: number;
        })[];
    } & {
        id: string;
        workspace_id: string;
        created_at: Date;
        updated_at: Date;
        name: string;
        status: string;
    })[]>;
    createCampaign(workspaceId: string, name: string): Promise<{
        id: string;
        workspace_id: string;
        created_at: Date;
        updated_at: Date;
        name: string;
        status: string;
    }>;
    getCampaign(workspaceId: string, id: string): Promise<{
        phone_numbers: {
            id: string;
            workspace_id: string;
            created_at: Date;
            updated_at: Date;
            name: string | null;
            status: import("@prisma/client").$Enums.PhoneNumberStatus;
            campaign_id: string | null;
            provider: string;
            phone_number: string;
            provider_number_id: string | null;
            connection_id: string | null;
        }[];
        buyers: ({
            buyer: {
                id: string;
                workspace_id: string;
                created_at: Date;
                updated_at: Date;
                name: string;
                status: string;
                destination_number: string;
                timeout: number;
            };
        } & {
            id: string;
            workspace_id: string;
            created_at: Date;
            updated_at: Date;
            status: string;
            campaign_id: string;
            buyer_id: string;
            priority: number;
        })[];
    } & {
        id: string;
        workspace_id: string;
        created_at: Date;
        updated_at: Date;
        name: string;
        status: string;
    }>;
}
