import { Test, TestingModule } from '@nestjs/testing';
import { CallsService } from './calls.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { UsageService } from '../usage/usage.service.js';
import { WebhooksService } from '../webhooks/webhooks.service.js';
import { CallState, CallAttemptState, Call, CallAttempt } from '@prisma/client';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { vi } from 'vitest';

describe('CallsService (Stage 13)', () => {
  let service: CallsService;
  let prisma: any;
  let usage: any;

  beforeEach(async () => {
    prisma = {
      $transaction: vi.fn((cb) => cb(prisma)),
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'call_1', state: CallState.ROUTING }]),
      call: {
        create: vi.fn(),
        update: vi.fn(),
        findUnique: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
      },
      callAttempt: {
        create: vi.fn(),
        update: vi.fn(),
        findUnique: vi.fn(),
        findMany: vi.fn(),
      },
    };

    usage = {
      recordUsage: vi.fn(),
    };

    const webhooks = {
      queueEvent: vi.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CallsService,
        { provide: PrismaService, useValue: prisma },
        { provide: UsageService, useValue: usage },
        { provide: WebhooksService, useValue: webhooks },
      ],
    }).compile();

    service = module.get<CallsService>(CallsService);
  });

  describe('Call State Machine', () => {
    it('allows valid transition INITIATED -> ROUTING', async () => {
      prisma.call.findUnique.mockResolvedValue({
        id: 'call_1',
        state: CallState.INITIATED,
      });
      prisma.call.update.mockResolvedValue({
        id: 'call_1',
        state: CallState.ROUTING,
      });

      const res = await service.transitionCall('call_1', CallState.ROUTING);
      expect(res.state).toBe(CallState.ROUTING);
    });

    it('rejects invalid transition COMPLETED -> ROUTING', async () => {
      prisma.call.findUnique.mockResolvedValue({
        id: 'call_1',
        state: CallState.COMPLETED,
      });

      await expect(
        service.transitionCall('call_1', CallState.ROUTING),
      ).rejects.toThrow(BadRequestException);
    });

    it('handles caller hangup for active call', async () => {
      prisma.call.findUnique.mockResolvedValue({
        id: 'call_1',
        state: CallState.ROUTING,
        created_at: new Date(),
        duration_secs: null,
        attempts: [{ id: 'att_1', state: CallAttemptState.RINGING }],
      });
      prisma.call.update.mockResolvedValue({
        id: 'call_1',
        state: CallState.CANCELED,
        duration_secs: 0,
      });
      prisma.callAttempt.update.mockResolvedValue({
        id: 'att_1',
        state: CallAttemptState.CANCELED,
      });

      await service.handleCallerHangup('prov_123');

      expect(prisma.callAttempt.update).toHaveBeenCalledWith({
        where: { id: 'att_1' },
        data: { state: CallAttemptState.CANCELED },
      });

      expect(prisma.call.update).toHaveBeenCalledWith({
        where: { id: 'call_1' },
        data: { state: CallState.CANCELED, duration_secs: 0 },
      });
    });

    it('prevents attempt creation if call is in terminal state', async () => {
      prisma.call.findUnique.mockResolvedValue({
        id: 'call_1',
        state: CallState.COMPLETED,
      });

      await expect(
        service.createCallAttempt({
          call_id: 'call_1',
          buyer_id: 'buyer_1',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('Call Logs & Metrics (Stage 17)', () => {
    it('should query calls with filters', async () => {
      prisma.call.findMany = vi.fn().mockResolvedValue([{ id: 'call_1' }]);
      prisma.call.count = vi.fn().mockResolvedValue(1);

      const res = await service.getCalls('ws_1', {
        campaignId: 'camp_1',
        status: CallState.COMPLETED,
        callerNumber: '+123',
      });

      expect(res.items.length).toBe(1);
      expect(res.total).toBe(1);
      expect(prisma.call.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            workspace_id: 'ws_1',
            campaign_id: 'camp_1',
            state: CallState.COMPLETED,
            from_number: { contains: '+123' },
          }),
        }),
      );
    });

    it('should calculate metrics correctly', async () => {
      prisma.call.findMany = vi.fn().mockResolvedValue([
        {
          state: CallState.COMPLETED,
          duration_secs: 60,
          campaign_id: 'camp_1',
        },
        {
          state: CallState.NO_ANSWER,
          duration_secs: null,
          campaign_id: 'camp_1',
        },
        { state: CallState.FAILED, duration_secs: null, campaign_id: 'camp_2' },
      ]);
      prisma.callAttempt.findMany = vi.fn().mockResolvedValue([
        { state: CallAttemptState.COMPLETED, buyer_id: 'buyer_1' },
        { state: CallAttemptState.FAILED, buyer_id: 'buyer_1' },
      ]);

      const metrics = await service.getMetrics('ws_1', {});

      expect(metrics.total).toBe(3);
      expect(metrics.answered).toBe(1);
      expect(metrics.missed).toBe(2);
      expect(metrics.blocked).toBe(1);
      expect(metrics.avgDuration).toBe(60);
      expect(metrics.campaigns['camp_1'].total).toBe(2);
      expect(metrics.campaigns['camp_1'].answered).toBe(1);
      expect(metrics.buyers['buyer_1'].total).toBe(2);
      expect(metrics.buyers['buyer_1'].answered).toBe(1);
    });

    describe('ACL & TCL Metrics Calculation', () => {
      it('1. No calls ACL = null TCL = null', async () => {
        prisma.call.findMany = vi.fn().mockResolvedValue([]);
        prisma.callAttempt.findMany = vi.fn().mockResolvedValue([]);
        const metrics = await service.getMetrics('ws_1', {});
        expect(metrics.aclSecs).toBeNull();
        expect(metrics.tclSecs).toBeNull();
      });

      it('2. One eligible call duration = 120 (ACL = 120, TCL = 120)', async () => {
        prisma.call.findMany = vi.fn().mockResolvedValue([
          {
            state: 'COMPLETED',
            started_at: new Date('2026-09-30T10:00:00Z'),
            ended_at: new Date('2026-09-30T10:02:00Z')
          }
        ]);
        prisma.callAttempt.findMany = vi.fn().mockResolvedValue([]);
        const metrics = await service.getMetrics('ws_1', {});
        expect(metrics.aclSecs).toBe(120);
        expect(metrics.tclSecs).toBe(120);
      });

      it('3. Multiple calls: 60 + 120 + 180 (ACL = 120, TCL = 360)', async () => {
        prisma.call.findMany = vi.fn().mockResolvedValue([
          { started_at: new Date('2026-09-30T10:00:00Z'), ended_at: new Date('2026-09-30T10:01:00Z') },
          { started_at: new Date('2026-09-30T10:00:00Z'), ended_at: new Date('2026-09-30T10:02:00Z') },
          { started_at: new Date('2026-09-30T10:00:00Z'), ended_at: new Date('2026-09-30T10:03:00Z') },
        ]);
        prisma.callAttempt.findMany = vi.fn().mockResolvedValue([]);
        const metrics = await service.getMetrics('ws_1', {});
        expect(metrics.aclSecs).toBe(120);
        expect(metrics.tclSecs).toBe(360);
      });

      it('4. Call with started_at but no ended_at excluded from ACL/TCL', async () => {
        prisma.call.findMany = vi.fn().mockResolvedValue([
          { started_at: new Date('2026-09-30T10:00:00Z'), ended_at: null }
        ]);
        prisma.callAttempt.findMany = vi.fn().mockResolvedValue([]);
        const metrics = await service.getMetrics('ws_1', {});
        expect(metrics.aclSecs).toBeNull();
        expect(metrics.tclSecs).toBeNull();
      });

      it('5. Call with ended_at before started_at excluded', async () => {
        prisma.call.findMany = vi.fn().mockResolvedValue([
          { started_at: new Date('2026-09-30T10:02:00Z'), ended_at: new Date('2026-09-30T10:00:00Z') }
        ]);
        prisma.callAttempt.findMany = vi.fn().mockResolvedValue([]);
        const metrics = await service.getMetrics('ws_1', {});
        expect(metrics.aclSecs).toBeNull();
        expect(metrics.tclSecs).toBeNull();
      });

      it('6. Legacy call with duration_secs but no lifecycle timestamps excluded from ACL/TCL', async () => {
        prisma.call.findMany = vi.fn().mockResolvedValue([
          { duration_secs: 100, started_at: null, ended_at: null }
        ]);
        prisma.callAttempt.findMany = vi.fn().mockResolvedValue([]);
        const metrics = await service.getMetrics('ws_1', {});
        expect(metrics.avgDuration).toBe(100);
        expect(metrics.aclSecs).toBeNull();
        expect(metrics.tclSecs).toBeNull();
      });

      it('7. Date filter: only calls inside selected period included', async () => {
        prisma.call.findMany = vi.fn().mockResolvedValue([]);
        prisma.callAttempt.findMany = vi.fn().mockResolvedValue([]);
        await service.getMetrics('ws_1', { startDate: '2026-09-01T00:00:00Z', endDate: '2026-09-30T00:00:00Z' });
        expect(prisma.call.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              created_at: {
                gte: new Date('2026-09-01T00:00:00Z'),
                lte: new Date('2026-09-30T00:00:00Z')
              }
            })
          })
        );
      });

      it('12. Tenant isolation: Workspace A cannot aggregate Workspace B calls', async () => {
        prisma.call.findMany = vi.fn().mockResolvedValue([]);
        prisma.callAttempt.findMany = vi.fn().mockResolvedValue([]);
        await service.getMetrics('ws_secure', {});
        expect(prisma.call.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({ workspace_id: 'ws_secure' })
          })
        );
      });

      it('13. Campaign aggregation: each campaign receives independent ACL/TCL', async () => {
        prisma.call.findMany = vi.fn().mockResolvedValue([
          { campaign_id: 'c1', started_at: new Date('2026-09-30T10:00:00Z'), ended_at: new Date('2026-09-30T10:01:00Z') },
          { campaign_id: 'c2', started_at: new Date('2026-09-30T10:00:00Z'), ended_at: new Date('2026-09-30T10:02:00Z') },
        ]);
        prisma.callAttempt.findMany = vi.fn().mockResolvedValue([]);
        const metrics = await service.getMetrics('ws_1', {});
        expect(metrics.campaigns['c1'].aclSecs).toBe(60);
        expect(metrics.campaigns['c1'].tclSecs).toBe(60);
        expect(metrics.campaigns['c2'].aclSecs).toBe(120);
        expect(metrics.campaigns['c2'].tclSecs).toBe(120);
      });

      it('14. No division-by-zero', async () => {
        prisma.call.findMany = vi.fn().mockResolvedValue([
          { started_at: null, ended_at: null }
        ]);
        prisma.callAttempt.findMany = vi.fn().mockResolvedValue([]);
        const metrics = await service.getMetrics('ws_1', {});
        expect(metrics.aclSecs).toBeNull();
      });

      it('15. Decimal ACL is rounded consistently to whole seconds', async () => {
        prisma.call.findMany = vi.fn().mockResolvedValue([
          { started_at: new Date('2026-09-30T10:00:00Z'), ended_at: new Date('2026-09-30T10:00:10Z') },
          { started_at: new Date('2026-09-30T10:00:00Z'), ended_at: new Date('2026-09-30T10:00:11Z') },
          { started_at: new Date('2026-09-30T10:00:00Z'), ended_at: new Date('2026-09-30T10:00:11Z') },
        ]);
        prisma.callAttempt.findMany = vi.fn().mockResolvedValue([]);
        const metrics = await service.getMetrics('ws_1', {});
        expect(metrics.aclSecs).toBe(11);
      });
    });
  });
});
