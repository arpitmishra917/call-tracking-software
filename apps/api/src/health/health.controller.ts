import { Controller, Get, Head, Res, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { HealthService } from './health.service.js';
import type { HealthCheckResult, LivenessResult, PingResult } from './health.service.js';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  async getHealth(@Res({ passthrough: true }) res: Response): Promise<HealthCheckResult> {
    const result = await this.healthService.checkReadiness();
    if (result.status === 'unhealthy') {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
    }
    return result;
  }

  @Get('ready')
  async getReady(@Res({ passthrough: true }) res: Response): Promise<HealthCheckResult> {
    const result = await this.healthService.checkReadiness();
    if (result.status === 'unhealthy') {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
    }
    return result;
  }

  @Get('live')
  getLive(): LivenessResult {
    return this.healthService.checkLiveness();
  }

  @Get('ping')
  getPing(): PingResult {
    return this.healthService.getPing();
  }

  @Head('ping')
  headPing(): PingResult {
    return this.healthService.getPing();
  }
}
