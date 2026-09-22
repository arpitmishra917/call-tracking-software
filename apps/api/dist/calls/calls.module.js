var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { Module } from '@nestjs/common';
import { CallsService } from './calls.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { CallsController } from './calls.controller.js';
import { UsageModule } from '../usage/usage.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { WebhooksModule } from '../webhooks/webhooks.module.js';
let CallsModule = class CallsModule {
};
CallsModule = __decorate([
    Module({
        imports: [PrismaModule, UsageModule, AuthModule, WebhooksModule],
        controllers: [CallsController],
        providers: [CallsService],
        exports: [CallsService],
    })
], CallsModule);
export { CallsModule };
//# sourceMappingURL=calls.module.js.map