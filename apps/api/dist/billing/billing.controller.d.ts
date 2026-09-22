import { BillingService } from './billing.service.js';
export declare class BillingController {
    private readonly billingService;
    constructor(billingService: BillingService);
    getBillingState(req: any): Promise<{
        subscription: ({
            plan: {
                id: string;
                created_at: Date;
                updated_at: Date;
                name: string;
                currency: string;
                description: string | null;
                provider_product_id: string | null;
                provider_price_id: string | null;
                amount: number | null;
                interval: string;
                active: boolean;
            } | null;
        } & {
            id: string;
            workspace_id: string;
            created_at: Date;
            updated_at: Date;
            status: import("@prisma/client").$Enums.SubscriptionStatus;
            plan_id: string | null;
            provider_subscription_id: string;
            current_period_start: Date;
            current_period_end: Date;
            cancel_at_period_end: boolean;
        }) | null;
        customer: {
            id: string;
            workspace_id: string;
            created_at: Date;
            updated_at: Date;
            provider_customer_id: string;
        } | null;
        invoices: {
            id: string;
            workspace_id: string;
            created_at: Date;
            updated_at: Date;
            status: import("@prisma/client").$Enums.InvoiceStatus;
            subscription_id: string | null;
            provider_invoice_id: string;
            amount_due: number;
            amount_paid: number;
            currency: string;
            hosted_invoice_url: string | null;
            invoice_date: Date;
        }[];
        plans: {
            id: string;
            created_at: Date;
            updated_at: Date;
            name: string;
            currency: string;
            description: string | null;
            provider_product_id: string | null;
            provider_price_id: string | null;
            amount: number | null;
            interval: string;
            active: boolean;
        }[];
        usage: {
            summary: {
                CALL_MINUTE: number;
                PHONE_NUMBER: number;
                RECORDING_STORAGE: number;
            };
            period_start: Date | null;
            period_end: Date | null;
        };
    }>;
    createCheckout(req: any, body: {
        planId: string;
        returnUrl: string;
    }): Promise<{
        url: string | null;
    }>;
    createPortal(req: any, body: {
        returnUrl: string;
    }): Promise<{
        url: string;
    }>;
    handleWebhook(req: any, signature: string): Promise<{
        received: boolean;
    }>;
}
