import { Module } from '@nestjs/common';
import { HealthService } from './health.service.js';
import { HealthController } from './health.controller.js';
import { PrismaModule } from '../prisma/prisma.module.js';

@Module({
  imports: [PrismaModule],
  controllers: [HealthController],
  providers: [HealthService],
  exports: [HealthService],
})
export class HealthModule {}
