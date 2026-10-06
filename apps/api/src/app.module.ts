import { PermissionsModule } from './permissions/permissions.module.js';
import { Module } from '@nestjs/common';
import { AccountModule } from './account/account.module.js';
import { AuditLogsModule } from './audit-logs/audit-logs.module.js';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { TelephonyModule } from './telephony/telephony.module.js';
import { PhoneNumbersModule } from './phone-numbers/phone-numbers.module.js';
import { RoutingModule } from './routing/routing.module.js';
import { AuthModule } from './auth/auth.module.js';
import { AuthorizationModule } from './authorization/authorization.module.js';
import { WorkspacesModule } from './workspaces/workspaces.module.js';
import { CallsModule } from './calls/calls.module.js';
import { ReportsModule } from './reports/reports.module.js';
import { UsageModule } from './usage/usage.module.js';
import { BillingModule } from './billing/billing.module.js';
import { ApiKeysModule } from './api-keys/api-keys.module.js';
import { PublicApiModule } from './public-api/public-api.module.js';
import { WebhooksModule } from './webhooks/webhooks.module.js';

@Module({
  imports: [
    PermissionsModule,
    AccountModule,
    PrismaModule,
    TelephonyModule,
    PhoneNumbersModule,
    RoutingModule,
    AuthModule,
    AuthorizationModule,
    WorkspacesModule,
    CallsModule,
    ReportsModule,
    UsageModule,
    BillingModule,
    ApiKeysModule,
    PublicApiModule,
    WebhooksModule,
    AuditLogsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
