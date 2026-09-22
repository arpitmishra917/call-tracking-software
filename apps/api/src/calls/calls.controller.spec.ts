import { Test, TestingModule } from '@nestjs/testing';
import { CallsController } from './calls.controller.js';
import { CallsService } from './calls.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { WorkspaceRolesGuard } from '../authorization/workspace-roles.guard.js';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { CallState } from '@prisma/client';

describe('CallsController', () => {
  let controller: CallsController;
  let service: any;

  beforeEach(async () => {
    service = {
      getCalls: vi.fn(),
      getCallDetail: vi.fn(),
      getMetrics: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CallsController],
      providers: [
        {
          provide: CallsService,
          useValue: service,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: vi.fn(() => true) })
      .overrideGuard(WorkspaceRolesGuard)
      .useValue({ canActivate: vi.fn(() => true) })
      .compile();

    controller = module.get<CallsController>(CallsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should get calls with correct filters', async () => {
    service.getCalls.mockResolvedValue({ items: [], total: 0 });

    await controller.getCalls(
      'ws-1',
      'camp-1',
      undefined,
      CallState.COMPLETED,
      '+123',
      '2026-01-01',
      '2026-01-31',
      '10',
      '0',
    );

    expect(service.getCalls).toHaveBeenCalledWith('ws-1', {
      campaignId: 'camp-1',
      buyerId: undefined,
      status: CallState.COMPLETED,
      callerNumber: '+123',
      startDate: '2026-01-01',
      endDate: '2026-01-31',
      limit: 10,
      offset: 0,
    });
  });

  it('should get call detail', async () => {
    service.getCallDetail.mockResolvedValue({ id: 'call-1' });
    const result = await controller.getCallDetail('ws-1', 'call-1');
    expect(result).toEqual({ id: 'call-1' });
    expect(service.getCallDetail).toHaveBeenCalledWith('ws-1', 'call-1');
  });

  it('should get metrics', async () => {
    service.getMetrics.mockResolvedValue({ total: 5 });
    const result = await controller.getMetrics(
      'ws-1',
      '2026-01-01',
      '2026-01-31',
    );
    expect(result).toEqual({ total: 5 });
    expect(service.getMetrics).toHaveBeenCalledWith('ws-1', {
      startDate: '2026-01-01',
      endDate: '2026-01-31',
    });
  });
});
