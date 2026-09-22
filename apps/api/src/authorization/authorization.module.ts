import { Module, Global } from '@nestjs/common';
import { AuthorizationService } from './authorization.service.js';

import { PrismaModule } from '../prisma/prisma.module.js';

@Global()
@Module({
  imports: [PrismaModule],
  providers: [AuthorizationService],
  exports: [AuthorizationService],
})
export class AuthorizationModule {}
