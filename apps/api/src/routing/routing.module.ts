import { Module } from '@nestjs/common';
import { PermissionsModule } from '../permissions/permissions.module.js';
import { CampaignsService } from './campaigns.service.js';
import { CampaignsController } from './campaigns.controller.js';
import { BuyersService } from './buyers.service.js';
import { BuyersController } from './buyers.controller.js';
import { DestinationNumbersService } from './destination-numbers.service.js';
import { DestinationNumbersController } from './destination-numbers.controller.js';
import { BlockedCallersService } from './blocked-callers.service.js';
import { BlockedCallersController } from './blocked-callers.controller.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [PrismaModule, AuthModule, PermissionsModule],
  controllers: [
    CampaignsController,
    BuyersController,
    DestinationNumbersController,
    BlockedCallersController,
  ],
  providers: [
    CampaignsService,
    BuyersService,
    DestinationNumbersService,
    BlockedCallersService,
  ],
  exports: [
    CampaignsService,
    BuyersService,
    DestinationNumbersService,
    BlockedCallersService,
  ],
})
export class RoutingModule {}
