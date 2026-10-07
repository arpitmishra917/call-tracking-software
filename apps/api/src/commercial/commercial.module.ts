import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { CommercialEvaluatorService } from './commercial-evaluator.service.js';

@Module({
  imports: [PrismaModule],
  providers: [CommercialEvaluatorService],
  exports: [CommercialEvaluatorService],
})
export class CommercialModule {}
