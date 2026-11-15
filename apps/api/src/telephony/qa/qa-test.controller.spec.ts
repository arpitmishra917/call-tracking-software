import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { QaTestController } from './qa-test.controller.js';
import { QaOrchestratorService } from './qa-orchestrator.service.js';
import { QaTelephonyGuardService } from './qa-telephony-guard.service.js';
import { QaAuthGuard } from './qa-auth.guard.js';

describe('QaTestController & QaAuthGuard (BUG-BE-011)', () => {
  let controller: QaTestController;
  let orchestrator: any;
  let guardService: any;
  let guard: QaAuthGuard;

  beforeEach(async () => {
    orchestrator = {
      getActiveRun: vi.fn().mockReturnValue(null),
      executeTestRun: vi.fn().mockResolvedValue({
        runId: 'test-run-1',
        success: true,
      }),
    };

    guardService = {
      isQaEnabled: vi.fn().mockReturnValue(true),
      validateConfiguration: vi.fn().mockReturnValue({ valid: true, errors: [] }),
      registerActiveTestRun: vi.fn(),
      openInboundTestLease: vi.fn().mockReturnValue({ leaseId: 'mock-lease-123', expiresAt: Date.now() + 120000 }),
      releaseCallBinding: vi.fn(),
      unregisterActiveTestRun: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [QaTestController],
      providers: [
        { provide: QaOrchestratorService, useValue: orchestrator },
        { provide: QaTelephonyGuardService, useValue: guardService },
        QaAuthGuard,
      ],
    }).compile();

    controller = module.get<QaTestController>(QaTestController);
    guard = module.get<QaAuthGuard>(QaAuthGuard);
  });

  describe('QaAuthGuard', () => {
    it('1. Rejects anonymous calls without authentication header with 401', async () => {
      const mockContext: any = {
        switchToHttp: () => ({
          getRequest: () => ({
            headers: {},
          }),
        }),
      };

      await expect(guard.canActivate(mockContext)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('2. Rejects invalid credentials with 401', async () => {
      const mockContext: any = {
        switchToHttp: () => ({
          getRequest: () => ({
            headers: { authorization: 'Bearer invalid-token-xyz' },
          }),
        }),
      };

      await expect(guard.canActivate(mockContext)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('3. Accepts authorized QA secret header', async () => {
      process.env.TELEPHONY_QA_SECRET = 'secret-qa-token-123';
      const req: any = {
        headers: { 'x-qa-secret': 'secret-qa-token-123' },
      };
      const mockContext: any = {
        switchToHttp: () => ({
          getRequest: () => req,
        }),
      };

      const result = await guard.canActivate(mockContext);
      expect(result).toBe(true);
      expect(req.user).toBeDefined();
      expect(req.user.role).toBe('QA_AUTOMATION');
    });

    it('4. Accepts authorized Bearer secret', async () => {
      process.env.TELEPHONY_QA_SECRET = 'secret-qa-token-123';
      const req: any = {
        headers: { authorization: 'Bearer secret-qa-token-123' },
      };
      const mockContext: any = {
        switchToHttp: () => ({
          getRequest: () => req,
        }),
      };

      const result = await guard.canActivate(mockContext);
      expect(result).toBe(true);
      expect(req.user).toBeDefined();
    });
  });

  describe('QaTestController logic', () => {
    it('5. getStatus returns QA telemetry and configuration status', () => {
      const status = controller.getStatus();
      expect(status.qaEnabled).toBe(true);
      expect(status.configValid).toBe(true);
      expect(orchestrator.getActiveRun).toHaveBeenCalled();
    });

    it('6. executeTestRun rejects when QA is disabled with 403', async () => {
      guardService.isQaEnabled.mockReturnValue(false);

      await expect(controller.executeTestRun({})).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('7. executeTestRun runs test and returns result when enabled and valid', async () => {
      const res = await controller.executeTestRun({
        trackingDid: '+17252574041',
      });
      expect(res.success).toBe(true);
      expect(orchestrator.executeTestRun).toHaveBeenCalled();
    });

    it('8. openLease registers test run and opens inbound lease when authorized', () => {
      const res = controller.openLease({
        callerCli: '+17207159445',
        callerSipUri: 'sip:arpitmishra917@sip.telnyx.com',
      });
      expect(res.success).toBe(true);
      expect(res.leaseId).toBe('mock-lease-123');
      expect(guardService.registerActiveTestRun).toHaveBeenCalled();
      expect(guardService.openInboundTestLease).toHaveBeenCalled();
    });

    it('9. openLease rejects when QA is disabled with 403', () => {
      guardService.isQaEnabled.mockReturnValue(false);
      expect(() => controller.openLease({})).toThrow(ForbiddenException);
    });

    it('10. releaseBinding cleans up call binding and active test run', () => {
      const res = controller.releaseBinding({
        callId: 'call-uuid-1',
        runId: 'run-uuid-1',
      });
      expect(res.success).toBe(true);
      expect(guardService.releaseCallBinding).toHaveBeenCalledWith('call-uuid-1');
      expect(guardService.unregisterActiveTestRun).toHaveBeenCalledWith('run-uuid-1');
    });
  });
});
