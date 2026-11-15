import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import {
  assertNonProductionDatabase,
  stripProductionEnvironmentVariables,
} from '../common/database-isolation.util.js';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  async onModuleInit() {
    // Hardened safety: Strip production secrets and assert non-production target unconditionally
    stripProductionEnvironmentVariables();
    assertNonProductionDatabase(process.env.DATABASE_URL, 'PrismaService.onModuleInit');
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
