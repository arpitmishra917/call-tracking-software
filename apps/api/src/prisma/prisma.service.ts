import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
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
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit() {
    if (process.env.NODE_ENV === 'production') {
      // In production, connect directly to DATABASE_URL without stripping
      // production variables or enforcing non-production database constraints.
      this.logger.log('PrismaService initialized for production environment');
      await this.$connect();
      return;
    }

    // In automated testing (Vitest / test runner) or QA environments,
    // enforce strict non-production database isolation and strip inherited secrets.
    const isTestOrQa =
      process.env.NODE_ENV === 'test' ||
      process.env.APP_ENV === 'qa' ||
      process.env.VITEST === 'true' ||
      Boolean(process.env.VITEST);

    if (isTestOrQa) {
      stripProductionEnvironmentVariables();
      assertNonProductionDatabase(
        process.env.DATABASE_URL,
        'PrismaService.onModuleInit',
      );
    }

    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
