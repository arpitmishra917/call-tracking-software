import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { SettlementBatchService } from './settlement-batch.service.js';

@Module({
  imports: [PrismaModule],
  providers: [SettlementBatchService],
  exports: [SettlementBatchService],
})
export class SettlementModule {}
