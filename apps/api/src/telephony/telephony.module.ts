import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { CallController, TELEPHONY_PROVIDER } from './call-controller.js';
import { TelnyxProvider } from './telnyx/telnyx.provider.js';
import { TelnyxWebhookController } from './telnyx/telnyx.webhook.controller.js';
import { TwilioProvider } from './twilio/twilio.provider.js';
import { TwilioWebhookController } from './twilio/twilio.webhook.controller.js';
import { WebhookIdempotencyService } from './webhook-idempotency.service.js';
import { CallsModule } from '../calls/calls.module.js';
import { RecordingsController } from './recordings.controller.js';

import { AuthModule } from '../auth/auth.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { RoutingModule } from '../routing/routing.module.js';
import { UsageModule } from '../usage/usage.module.js';
import { WebhooksModule } from '../webhooks/webhooks.module.js';

@Module({
  imports: [
    PrismaModule,
    RoutingModule,
    CallsModule,
    AuthModule,
    AuthorizationModule,
    UsageModule,
    WebhooksModule,
  ],
  providers: [
    WebhookIdempotencyService,
    TelnyxProvider,
    TwilioProvider,
    {
      provide: TELEPHONY_PROVIDER,
      useFactory: (telnyx: TelnyxProvider, twilio: TwilioProvider) => {
        return process.env.ACTIVE_TELEPHONY_PROVIDER === 'twilio'
          ? twilio
          : telnyx;
      },
      inject: [TelnyxProvider, TwilioProvider],
    },
    CallController,
  ],
  controllers: [
    TelnyxWebhookController,
    TwilioWebhookController,
    RecordingsController,
  ],
  exports: [CallController, TELEPHONY_PROVIDER],
})
export class TelephonyModule {}
