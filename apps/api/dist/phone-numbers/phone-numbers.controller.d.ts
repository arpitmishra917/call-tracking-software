import { PhoneNumbersService } from './phone-numbers.service.js';
export declare class PhoneNumbersController {
    private readonly phoneNumbersService;
    constructor(phoneNumbersService: PhoneNumbersService);
    listNumbers(workspaceId: string): Promise<{
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
    }[]>;
    searchNumbers(workspaceId: string, countryCode?: string, limit?: string): Promise<any[]>;
    provisionNumber(workspaceId: string, phoneNumber: string, name?: string): Promise<{
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
    }>;
    updateNumber(workspaceId: string, id: string, name: string): Promise<{
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
    }>;
    releaseNumber(workspaceId: string, id: string): Promise<{
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
    }>;
}
