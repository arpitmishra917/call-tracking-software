import { PrismaService } from '../prisma/prisma.service.js';
import type { TelephonyProvider } from './telephony.provider.js';
export declare class RecordingsController {
    private readonly prisma;
    private readonly telephonyProvider;
    constructor(prisma: PrismaService, telephonyProvider: TelephonyProvider);
    getRecordingUrl(workspaceId: string, recordingId: string): Promise<{
        url: string;
    }>;
}
