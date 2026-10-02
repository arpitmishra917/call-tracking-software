import { Module } from '@nestjs/common';
import { BillingService } from './billing.service.js';
import { WalletService } from './wallet.service.js';
import { UsageBillingService } from './usage-billing.service.js';
import { MockPaymentProvider } from './mock-payment.provider.js';
import { BillingController } from './billing.controller.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';

@Module({
  imports: [PrismaModule, AuthModule, AuthorizationModule],
  controllers: [BillingController],
  providers: [BillingService, WalletService, MockPaymentProvider, UsageBillingService],
  exports: [BillingService, WalletService, MockPaymentProvider, UsageBillingService],
})
export class BillingModule {}
