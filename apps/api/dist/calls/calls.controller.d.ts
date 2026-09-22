import { CallsService } from './calls.service.js';
import { CallState } from '@prisma/client';
export declare class CallsController {
    private readonly callsService;
    constructor(callsService: CallsService);
    getCalls(workspaceId: string, campaignId?: string, buyerId?: string, status?: CallState, callerNumber?: string, startDate?: string, endDate?: string, limit?: string, offset?: string): Promise<{
        items: ({
            campaign: {
                name: string;
            } | null;
            attempts: ({
                buyer: {
                    name: string;
                };
            } & {
                id: string;
                created_at: Date;
                updated_at: Date;
                provider_call_id: string | null;
                state: import("@prisma/client").$Enums.CallAttemptState;
                duration_secs: number | null;
                call_id: string;
                buyer_id: string;
            })[];
        } & {
            id: string;
            workspace_id: string;
            created_at: Date;
            updated_at: Date;
            campaign_id: string | null;
            provider: string;
            provider_call_id: string;
            from_number: string;
            to_number: string;
            state: import("@prisma/client").$Enums.CallState;
            duration_secs: number | null;
        })[];
        total: number;
    }>;
    getMetrics(workspaceId: string, startDate?: string, endDate?: string): Promise<{
        total: number;
        answered: number;
        missed: number;
        blocked: number;
        avgDuration: number;
        campaigns: Record<string, {
            total: number;
            answered: number;
        }>;
        buyers: Record<string, {
            total: number;
            answered: number;
        }>;
    }>;
    getCallDetail(workspaceId: string, callId: string): Promise<{
        campaign: {
            name: string;
        } | null;
        attempts: ({
            buyer: {
                name: string;
            };
        } & {
            id: string;
            created_at: Date;
            updated_at: Date;
            provider_call_id: string | null;
            state: import("@prisma/client").$Enums.CallAttemptState;
            duration_secs: number | null;
            call_id: string;
            buyer_id: string;
        })[];
        recordings: {
            id: string;
            workspace_id: string;
            created_at: Date;
            updated_at: Date;
            status: import("@prisma/client").$Enums.RecordingStatus;
            duration_secs: number | null;
            call_id: string;
            provider_id: string;
            recording_url: string | null;
        }[];
    } & {
        id: string;
        workspace_id: string;
        created_at: Date;
        updated_at: Date;
        campaign_id: string | null;
        provider: string;
        provider_call_id: string;
        from_number: string;
        to_number: string;
        state: import("@prisma/client").$Enums.CallState;
        duration_secs: number | null;
    }>;
}
