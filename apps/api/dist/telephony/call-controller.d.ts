import type { TelephonyProvider } from './telephony.provider.js';
import { NormalizedCallEvent } from './telephony.events.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CallsService } from '../calls/calls.service.js';
import { UsageService } from '../usage/usage.service.js';
import { WebhooksService } from '../webhooks/webhooks.service.js';
export declare const TELEPHONY_PROVIDER = "TELEPHONY_PROVIDER";
export declare class CallController {
    private readonly provider;
    private readonly prisma;
    private readonly callsService;
    private readonly usageService;
    private readonly webhooksService;
    private readonly logger;
    constructor(provider: TelephonyProvider, prisma: PrismaService, callsService: CallsService, usageService: UsageService, webhooksService: WebhooksService);
    handleEvent(event: NormalizedCallEvent): Promise<void>;
    private dialNextBuyer;
    getCallState(_id: string): any;
}
