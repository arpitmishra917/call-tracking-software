import { PrismaService } from '../prisma/prisma.service.js';
import { UsageService } from '../usage/usage.service.js';
import { CallState, CallAttemptState, Call, CallAttempt } from '@prisma/client';
export declare const VALID_CALL_TRANSITIONS: Record<CallState, CallState[]>;
export declare const VALID_ATTEMPT_TRANSITIONS: Record<CallAttemptState, CallAttemptState[]>;
import { WebhooksService } from '../webhooks/webhooks.service.js';
export declare class CallsService {
    private prisma;
    private usageService;
    private webhooksService;
    constructor(prisma: PrismaService, usageService: UsageService, webhooksService: WebhooksService);
    createCall(data: {
        workspace_id: string;
        campaign_id?: string;
        provider: string;
        provider_call_id: string;
        from_number: string;
        to_number: string;
    }): Promise<Call>;
    transitionCall(callId: string, newState: CallState, durationSecs?: number): Promise<Call>;
    handleCallerHangup(providerCallId: string, durationSecs?: number): Promise<any>;
    createCallAttempt(data: {
        call_id: string;
        buyer_id: string;
        provider_call_id?: string;
    }): Promise<CallAttempt>;
    transitionAttempt(attemptId: string, newState: CallAttemptState, durationSecs?: number): Promise<CallAttempt>;
    private isValidTransition;
    private isValidAttemptTransition;
    private isTerminalCallState;
    getCalls(workspaceId: string, filters: {
        campaignId?: string;
        buyerId?: string;
        status?: CallState;
        callerNumber?: string;
        startDate?: string;
        endDate?: string;
        limit?: number;
        offset?: number;
    }): Promise<{
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
    getMetrics(workspaceId: string, filters: {
        startDate?: string;
        endDate?: string;
    }): Promise<{
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
}
