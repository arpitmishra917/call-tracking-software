var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
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
let PublicApiModule = class PublicApiModule {
};
PublicApiModule = __decorate([
    Module({
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
], PublicApiModule);
export { PublicApiModule };
//# sourceMappingURL=public-api.module.js.map