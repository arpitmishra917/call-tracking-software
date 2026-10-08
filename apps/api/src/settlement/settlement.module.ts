import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { SettlementBatchService } from './settlement-batch.service.js';
import { PaymentService } from './payment.service.js';
import { ReconciliationService } from './reconciliation.service.js';
import { SettlementController } from './settlement.controller.js';
import { PaymentController } from './payment.controller.js';
import { ReconciliationController } from './reconciliation.controller.js';

@Module({
  imports: [PrismaModule, AuthModule, AuthorizationModule],
  controllers: [
    SettlementController,
    PaymentController,
    ReconciliationController,
  ],
  providers: [
    SettlementBatchService,
    PaymentService,
    ReconciliationService,
  ],
  exports: [
    SettlementBatchService,
    PaymentService,
    ReconciliationService,
  ],
})
export class SettlementModule {}
