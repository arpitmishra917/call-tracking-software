import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { SettlementBatchService } from './settlement-batch.service.js';
import { SettlementController } from './settlement.controller.js';

@Module({
  imports: [PrismaModule, AuthModule, AuthorizationModule],
  controllers: [SettlementController],
  providers: [SettlementBatchService],
  exports: [SettlementBatchService],
})
export class SettlementModule {}
