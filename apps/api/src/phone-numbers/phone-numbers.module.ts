import { Module } from '@nestjs/common';
import { PhoneNumbersController } from './phone-numbers.controller.js';
import { PhoneNumbersService } from './phone-numbers.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { TelnyxProvisioningService } from './telnyx-provisioning.service.js';
import { UsageModule } from '../usage/usage.module.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [PrismaModule, UsageModule, AuthModule],
  controllers: [PhoneNumbersController],
  providers: [PhoneNumbersService, TelnyxProvisioningService],
  exports: [PhoneNumbersService],
})
export class PhoneNumbersModule {}
