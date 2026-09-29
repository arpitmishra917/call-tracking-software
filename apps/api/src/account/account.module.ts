import { Module } from '@nestjs/common';
import { AccountController } from './account.controller.js';
import { AccountService } from './account.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';

@Module({
  imports: [PrismaModule],
  controllers: [AccountController],
  providers: [AccountService],
})
export class AccountModule {}
