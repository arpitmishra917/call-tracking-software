import type { RawBodyRequest } from '@nestjs/common';
import type { Request, Response } from 'express';
import { CallController } from '../call-controller.js';
import { WebhookIdempotencyService } from '../webhook-idempotency.service.js';
export declare class TelnyxWebhookController {
    private readonly callController;
    private readonly idempotency;
    private readonly logger;
    constructor(callController: CallController, idempotency: WebhookIdempotencyService);
    handleWebhook(req: RawBodyRequest<Request>, res: Response): Promise<Response<any, Record<string, any>>>;
    private normalizeTelnyxEvent;
}
