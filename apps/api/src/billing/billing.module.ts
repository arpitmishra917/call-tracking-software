import { Module } from '@nestjs/common';
import { BillingService } from './billing.service.js';
import { WalletService } from './wallet.service.js';
import { BillingController } from './billing.controller.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';

@Module({
  imports: [PrismaModule, AuthModule, AuthorizationModule],
  controllers: [BillingController],
  providers: [BillingService, WalletService],
  exports: [BillingService, WalletService],
})
export class BillingModule {}
