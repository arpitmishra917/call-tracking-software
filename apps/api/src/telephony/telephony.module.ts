import { PermissionsModule } from '../permissions/permissions.module.js';
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
import { ReservationRecoveryService } from './reservation-recovery.service.js';
import { QaTelephonyGuardService } from './qa/qa-telephony-guard.service.js';
import { AsteriskAriClientService } from './qa/asterisk-ari-client.service.js';
import { QaSipUriAdapterService } from './qa/qa-sip-uri-adapter.service.js';
import { QaAudioAnalyzerService } from './qa/qa-audio-analyzer.service.js';
import { QaOrchestratorService } from './qa/qa-orchestrator.service.js';
import { QaTestController } from './qa/qa-test.controller.js';
import { QaAuthGuard } from './qa/qa-auth.guard.js';
import { RingbackController } from './ringback.controller.js';

import { AuthModule } from '../auth/auth.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { RoutingModule } from '../routing/routing.module.js';
import { UsageModule } from '../usage/usage.module.js';
import { WebhooksModule } from '../webhooks/webhooks.module.js';
import { BillingModule } from '../billing/billing.module.js';
import { CommercialModule } from '../commercial/commercial.module.js';

@Module({
  imports: [
    PermissionsModule,
    PrismaModule,
    RoutingModule,
    CallsModule,
    AuthModule,
    AuthorizationModule,
    UsageModule,
    WebhooksModule,
    BillingModule,
    CommercialModule,
  ],
  providers: [
    WebhookIdempotencyService,
    TelnyxProvider,
    TwilioProvider,
    {
      provide: TELEPHONY_PROVIDER,
      useFactory: (telnyx: TelnyxProvider) => {
        const configuredProvider = (
          process.env.TELEPHONY_PROVIDER ||
          process.env.ACTIVE_TELEPHONY_PROVIDER ||
          ''
        ).toLowerCase();
        if (configuredProvider === 'twilio') {
          throw new Error(
            'FATAL: Twilio provider has been retired and disabled. CallFlow exclusively uses Telnyx as its telephony provider.',
          );
        }
        return telnyx;
      },
      inject: [TelnyxProvider],
    },
    CallController,
    ReservationRecoveryService,
    QaTelephonyGuardService,
    AsteriskAriClientService,
    QaSipUriAdapterService,
    QaAudioAnalyzerService,
    QaOrchestratorService,
    QaAuthGuard,
  ],
  controllers: [
    TelnyxWebhookController,
    RecordingsController,
    QaTestController,
    RingbackController,
  ],
  exports: [
    CallController,
    TELEPHONY_PROVIDER,
    QaTelephonyGuardService,
    AsteriskAriClientService,
    QaSipUriAdapterService,
    QaAudioAnalyzerService,
    QaOrchestratorService,
    QaAuthGuard,
  ],
})
export class TelephonyModule {}
