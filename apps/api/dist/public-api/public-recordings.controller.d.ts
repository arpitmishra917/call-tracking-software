import { PrismaService } from '../prisma/prisma.service.js';
import type { TelephonyProvider } from '../telephony/telephony.provider.js';
export declare class PublicRecordingsController {
    private readonly prisma;
    private readonly telephonyProvider;
    constructor(prisma: PrismaService, telephonyProvider: TelephonyProvider);
    listRecordings(workspaceId: string): Promise<{
        id: string;
        workspace_id: string;
        created_at: Date;
        updated_at: Date;
        status: import("@prisma/client").$Enums.RecordingStatus;
        duration_secs: number | null;
        call_id: string;
        provider_id: string;
        recording_url: string | null;
    }[]>;
    getRecording(workspaceId: string, id: string): Promise<{
        url: string;
        id: string;
        workspace_id: string;
        created_at: Date;
        updated_at: Date;
        status: import("@prisma/client").$Enums.RecordingStatus;
        duration_secs: number | null;
        call_id: string;
        provider_id: string;
        recording_url: string | null;
    }>;
}
