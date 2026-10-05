import { Module, Global, forwardRef } from '@nestjs/common';
import { AuthorizationService } from './authorization.service.js';
import { PermissionsGuard } from './permissions.guard.js';

import { PrismaModule } from '../prisma/prisma.module.js';
import { PermissionsModule } from '../permissions/permissions.module.js';

@Global()
@Module({
  imports: [PrismaModule, forwardRef(() => PermissionsModule)],
  providers: [AuthorizationService, PermissionsGuard],
  exports: [AuthorizationService, PermissionsGuard],
})
export class AuthorizationModule {}
