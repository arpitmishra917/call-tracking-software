import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AuditLogsModule } from '../audit-logs/audit-logs.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { CommercialEvaluatorService } from './commercial-evaluator.service.js';
import { CommercialDisputesService } from './commercial-disputes.service.js';
import { CommercialDisputesController } from './commercial-disputes.controller.js';
import { CommercialFinalizationService } from './commercial-finalization.service.js';

@Module({
  imports: [PrismaModule, AuditLogsModule, AuthorizationModule, AuthModule],
  controllers: [CommercialDisputesController],
  providers: [
    CommercialEvaluatorService,
    CommercialDisputesService,
    CommercialFinalizationService,
  ],
  exports: [
    CommercialEvaluatorService,
    CommercialDisputesService,
    CommercialFinalizationService,
  ],
})
export class CommercialModule {}
