import { PrismaService } from '../prisma/prisma.service.js';
import { TelnyxProvisioningService } from './telnyx-provisioning.service.js';
import { UsageService } from '../usage/usage.service.js';
export declare class PhoneNumbersService {
    private readonly prisma;
    private readonly telnyxProvisioning;
    private readonly usageService;
    constructor(prisma: PrismaService, telnyxProvisioning: TelnyxProvisioningService, usageService: UsageService);
    listWorkspaceNumbers(workspaceId: string): Promise<{
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
    searchAvailableNumbers(countryCode?: string, limit?: number): Promise<any[]>;
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
