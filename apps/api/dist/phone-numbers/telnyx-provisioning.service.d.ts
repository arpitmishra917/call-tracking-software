export declare class TelnyxProvisioningService {
    private readonly logger;
    private telnyxClient;
    constructor();
    searchNumbers(countryCode?: string, limit?: number): Promise<any[]>;
    provisionNumber(phoneNumber: string, connectionId?: string): Promise<{
        id: string;
        phone_number: string;
        connection_id: string | null;
    }>;
}
