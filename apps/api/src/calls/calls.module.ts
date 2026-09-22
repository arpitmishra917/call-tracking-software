import { Module } from '@nestjs/common';
import { CallsService } from './calls.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { CallsController } from './calls.controller.js';
import { UsageModule } from '../usage/usage.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { WebhooksModule } from '../webhooks/webhooks.module.js';

@Module({
  imports: [PrismaModule, UsageModule, AuthModule, WebhooksModule],
  controllers: [CallsController],
  providers: [CallsService],
  exports: [CallsService],
})
export class CallsModule {}
