import { Module } from '@nestjs/common';
import { WorkspacesController } from './workspaces.controller.js';
import { InvitationsController } from './invitations.controller.js';
import { VendorsController } from './vendors.controller.js';
import { WorkspacesService } from './workspaces.service.js';
import { VendorsService } from './vendors.service.js';

import { PrismaModule } from '../prisma/prisma.module.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [WorkspacesController, InvitationsController, VendorsController],
  providers: [WorkspacesService, VendorsService],
  exports: [WorkspacesService, VendorsService],
})
export class WorkspacesModule {}
