import { Module } from '@nestjs/common';
import { PublicWorkspacesController } from './public-workspaces.controller.js';
import { PublicPhoneNumbersController } from './public-phone-numbers.controller.js';
import { PublicCampaignsController } from './public-campaigns.controller.js';
import { PublicBuyersController } from './public-buyers.controller.js';
import { PublicBlockedNumbersController } from './public-blocked-numbers.controller.js';
import { PublicCallsController } from './public-calls.controller.js';
import { PublicRecordingsController } from './public-recordings.controller.js';
import { PublicUsageController } from './public-usage.controller.js';
import { PublicBillingController } from './public-billing.controller.js';

import { WorkspacesModule } from '../workspaces/workspaces.module.js';
import { PhoneNumbersModule } from '../phone-numbers/phone-numbers.module.js';
import { RoutingModule } from '../routing/routing.module.js';
import { CallsModule } from '../calls/calls.module.js';
import { TelephonyModule } from '../telephony/telephony.module.js';
import { UsageModule } from '../usage/usage.module.js';
import { BillingModule } from '../billing/billing.module.js';
import { ApiKeysModule } from '../api-keys/api-keys.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';

@Module({
  imports: [
    WorkspacesModule,
    PhoneNumbersModule,
    RoutingModule,
    CallsModule,
    TelephonyModule,
    UsageModule,
    BillingModule,
    ApiKeysModule,
    PrismaModule,
  ],
  controllers: [
    PublicWorkspacesController,
    PublicPhoneNumbersController,
    PublicCampaignsController,
    PublicBuyersController,
    PublicBlockedNumbersController,
    PublicCallsController,
    PublicRecordingsController,
    PublicUsageController,
    PublicBillingController,
  ],
})
export class PublicApiModule {}
