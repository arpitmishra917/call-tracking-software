var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { Module } from '@nestjs/common';
import { CampaignsService } from './campaigns.service.js';
import { CampaignsController } from './campaigns.controller.js';
import { BuyersService } from './buyers.service.js';
import { BuyersController } from './buyers.controller.js';
import { BlockedCallersService } from './blocked-callers.service.js';
import { BlockedCallersController } from './blocked-callers.controller.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AuthModule } from '../auth/auth.module.js';
let RoutingModule = class RoutingModule {
};
RoutingModule = __decorate([
    Module({
        imports: [PrismaModule, AuthModule],
        controllers: [
            CampaignsController,
            BuyersController,
            BlockedCallersController,
        ],
        providers: [CampaignsService, BuyersService, BlockedCallersService],
        exports: [CampaignsService, BuyersService, BlockedCallersService],
    })
], RoutingModule);
export { RoutingModule };
//# sourceMappingURL=routing.module.js.map