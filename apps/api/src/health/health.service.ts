import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

export interface HealthCheckResult {
  status: 'healthy' | 'unhealthy';
  timestamp: string;
  services: {
    database: {
      status: 'up' | 'down';
    };
  };
}

export interface LivenessResult {
  status: 'ok';
  timestamp: string;
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(private readonly prisma: PrismaService) {}

  async checkReadiness(): Promise<HealthCheckResult> {
    const timestamp = new Date().toISOString();
    let dbStatus: 'up' | 'down' = 'down';

    try {
      // Execute a lightweight ping query with timeout protection
      await this.prisma.$queryRaw`SELECT 1`;
      dbStatus = 'up';
    } catch (err: unknown) {
      // Log internally without exposing stack traces or DB connection strings to clients
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Readiness check failed: Database unreachable (${message})`);
      dbStatus = 'down';
    }

    const isHealthy = dbStatus === 'up';

    return {
      status: isHealthy ? 'healthy' : 'unhealthy',
      timestamp,
      services: {
        database: {
          status: dbStatus,
        },
      },
    };
  }

  checkLiveness(): LivenessResult {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }
}
