import type { Request, Response } from 'express';
import { CallController } from '../call-controller.js';
import { TwilioProvider } from './twilio.provider.js';
import { WebhookIdempotencyService } from '../webhook-idempotency.service.js';
export declare class TwilioWebhookController {
    private readonly callController;
    private readonly twilioProvider;
    private readonly idempotency;
    private readonly logger;
    constructor(callController: CallController, twilioProvider: TwilioProvider, idempotency: WebhookIdempotencyService);
    handleWebhook(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
    private normalizeTwilioEvent;
}
