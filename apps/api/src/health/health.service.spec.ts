import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { HealthService } from './health.service.js';
import { HealthController } from './health.controller.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { HttpStatus } from '@nestjs/common';

describe('Health & Readiness Verification (Operational Staging Readiness)', () => {
  let service: HealthService;
  let controller: HealthController;
  let prisma: { $queryRaw: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    prisma = {
      $queryRaw: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        HealthService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<HealthService>(HealthService);
    controller = module.get<HealthController>(HealthController);
  });

  describe('HealthService', () => {
    it('1. Healthy case: returns healthy status and database up when query succeeds', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([{ '1': 1 }]);

      const result = await service.checkReadiness();

      expect(result.status).toBe('healthy');
      expect(result.services.database.status).toBe('up');
      expect(result.timestamp).toBeDefined();
      expect(new Date(result.timestamp).getTime()).not.toBeNaN();
    });

    it('2. Unavailable dependency case: returns unhealthy status and database down without leaking stack trace', async () => {
      // Simulate fatal database connection failure
      prisma.$queryRaw.mockRejectedValueOnce(
        new Error('FATAL: password authentication failed for user "postgres" at host 10.0.0.1:5432'),
      );

      const result = await service.checkReadiness();

      expect(result.status).toBe('unhealthy');
      expect(result.services.database.status).toBe('down');
      expect(result.timestamp).toBeDefined();

      // Ensure no raw database connection strings, passwords, or stack traces leak in the response payload
      const jsonStr = JSON.stringify(result);
      expect(jsonStr).not.toContain('FATAL');
      expect(jsonStr).not.toContain('password');
      expect(jsonStr).not.toContain('postgres');
      expect(jsonStr).not.toContain('10.0.0.1');
    });

    it('3. Liveness check returns status ok', () => {
      const result = service.checkLiveness();
      expect(result.status).toBe('ok');
      expect(result.timestamp).toBeDefined();
    });
  });

  describe('HealthController', () => {
    it('4. GET /health returns 200 HTTP status when healthy', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([{ '1': 1 }]);

      const mockRes: any = {
        status: vi.fn(),
      };

      const result = await controller.getHealth(mockRes);

      expect(result.status).toBe('healthy');
      expect(mockRes.status).not.toHaveBeenCalled(); // defaults to 200
    });

    it('5. GET /health sets 503 Service Unavailable when database dependency is down', async () => {
      prisma.$queryRaw.mockRejectedValueOnce(new Error('Connection timeout'));

      const mockRes: any = {
        status: vi.fn(),
      };

      const result = await controller.getHealth(mockRes);

      expect(result.status).toBe('unhealthy');
      expect(mockRes.status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
    });

    it('6. GET /health/ready sets 503 Service Unavailable when database dependency is down', async () => {
      prisma.$queryRaw.mockRejectedValueOnce(new Error('Connection refused'));

      const mockRes: any = {
        status: vi.fn(),
      };

      const result = await controller.getReady(mockRes);

      expect(result.status).toBe('unhealthy');
      expect(mockRes.status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
    });

    it('7. GET /health/live returns ok', () => {
      const result = controller.getLive();
      expect(result.status).toBe('ok');
    });
  });
});
