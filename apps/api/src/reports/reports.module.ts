import { PermissionsModule } from '../permissions/permissions.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller.js';
import { ReportsService } from './reports.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { CallsModule } from '../calls/calls.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';

@Module({
  imports: [PermissionsModule, AuthModule, PrismaModule, AuthorizationModule, CallsModule],
  controllers: [ReportsController],
  providers: [ReportsService],
  exports: [ReportsService],
})
export class ReportsModule {}
