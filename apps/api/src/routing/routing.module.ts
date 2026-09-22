import { Module } from '@nestjs/common';
import { CampaignsService } from './campaigns.service.js';
import { CampaignsController } from './campaigns.controller.js';
import { BuyersService } from './buyers.service.js';
import { BuyersController } from './buyers.controller.js';
import { BlockedCallersService } from './blocked-callers.service.js';
import { BlockedCallersController } from './blocked-callers.controller.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [
    CampaignsController,
    BuyersController,
    BlockedCallersController,
  ],
  providers: [CampaignsService, BuyersService, BlockedCallersService],
  exports: [CampaignsService, BuyersService, BlockedCallersService],
})
export class RoutingModule {}
