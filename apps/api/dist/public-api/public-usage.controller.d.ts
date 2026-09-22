import { BillingService } from '../billing/billing.service.js';
export declare class PublicUsageController {
    private readonly billingService;
    constructor(billingService: BillingService);
    getUsage(workspaceId: string): Promise<{
        summary: {
            CALL_MINUTE: number;
            PHONE_NUMBER: number;
            RECORDING_STORAGE: number;
        };
        period_start: Date | null;
        period_end: Date | null;
    }>;
}
