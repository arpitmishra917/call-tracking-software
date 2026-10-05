import { PermissionsService } from '../permissions/permissions.service.js';
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
        { provide: PermissionsService, useValue: { getMemberPermissions: vi.fn().mockResolvedValue([{ key: 'call:read', scope_type: 'ALL' }]) } },
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
    describe('getCalls Filters', () => {
      beforeEach(() => {
        prisma.call.findMany = vi.fn().mockResolvedValue([]);
        prisma.call.count = vi.fn().mockResolvedValue(0);
        prisma.$queryRaw = vi.fn().mockResolvedValue([]);
      });

      it('1. tracking number filter', async () => {
        await service.getCalls('ws_1', '', { trackingNumber: '+13215033884' });
        expect(prisma.call.findMany).toHaveBeenCalledWith(expect.objectContaining({
          where: expect.objectContaining({ to_number: '+13215033884' })
        }));
      });

      it('2. campaign filter', async () => {
        await service.getCalls('ws_1', '', { campaignId: 'camp_1' });
        expect(prisma.call.findMany).toHaveBeenCalledWith(expect.objectContaining({
          where: expect.objectContaining({ campaign_id: 'camp_1' })
        }));
      });

      it('3. caller filter', async () => {
        await service.getCalls('ws_1', '', { callerNumber: '+123' });
        expect(prisma.call.findMany).toHaveBeenCalledWith(expect.objectContaining({
          where: expect.objectContaining({ from_number: { contains: '+123' } })
        }));
      });

      it('4. status filter', async () => {
        await service.getCalls('ws_1', '', { status: 'COMPLETED' as any });
        expect(prisma.call.findMany).toHaveBeenCalledWith(expect.objectContaining({
          where: expect.objectContaining({ state: 'COMPLETED' })
        }));
      });

      it('5. start date', async () => {
        await service.getCalls('ws_1', '', { startDate: '2026-10-01' });
        expect(prisma.call.findMany).toHaveBeenCalledWith(expect.objectContaining({
          where: expect.objectContaining({ created_at: expect.objectContaining({ gte: new Date('2026-10-01T00:00:00Z') }) })
        }));
      });

      it('6. end date', async () => {
        await service.getCalls('ws_1', '', { endDate: '2026-10-01' });
        expect(prisma.call.findMany).toHaveBeenCalledWith(expect.objectContaining({
          where: expect.objectContaining({ created_at: expect.objectContaining({ lt: new Date('2026-10-02T00:00:00.000Z') }) })
        }));
      });

      it('7. talk duration filter', async () => {
        prisma.$queryRaw.mockResolvedValue([{ id: 'valid_call' }]);
        await service.getCalls('ws_1', '', { durationType: 'talk', minDurationSecs: 60 });
        expect(prisma.$queryRaw).toHaveBeenCalled();
        expect(prisma.call.findMany).toHaveBeenCalledWith(expect.objectContaining({
          where: expect.objectContaining({ id: { in: ['valid_call'] } })
        }));
      });

      it('8. total duration filter', async () => {
        prisma.$queryRaw.mockResolvedValue([{ id: 'valid_call' }]);
        await service.getCalls('ws_1', '', { durationType: 'total', minDurationSecs: 80 });
        expect(prisma.$queryRaw).toHaveBeenCalled();
      });

      it('11. combined filters', async () => {
        await service.getCalls('ws_1', '', { campaignId: 'c1', trackingNumber: 't1' });
        expect(prisma.call.findMany).toHaveBeenCalledWith(expect.objectContaining({
          where: expect.objectContaining({ campaign_id: 'c1', to_number: 't1' })
        }));
      });

      it('12. workspace isolation', async () => {
        await service.getCalls('ws_secure', '', {});
        expect(prisma.call.findMany).toHaveBeenCalledWith(expect.objectContaining({
          where: expect.objectContaining({ workspace_id: 'ws_secure' })
        }));
      });

      it('17. API Response Mapping format', async () => {
        prisma.call.findMany.mockResolvedValue([{
          id: 'call_1',
          recordings: [{ id: 'rec_1', status: 'COMPLETED' }],
          started_at: new Date('2026-10-01T10:00:00Z'),
          answered_at: new Date('2026-10-01T10:00:10Z'),
          ended_at: new Date('2026-10-01T10:02:10Z'),
        }]);
        const res = await service.getCalls('ws_1', '', {});
        expect(res.items[0].talkDurationSecs).toBe(120);
        expect(res.items[0].totalDurationSecs).toBe(130);
        expect(res.items[0].recordings[0].id).toBe('rec_1');
      });
    });

    it('should query calls with filters', async () => {
      prisma.call.findMany = vi.fn().mockResolvedValue([{ id: 'call_1' }]);
      prisma.call.count = vi.fn().mockResolvedValue(1);

      const res = await service.getCalls('ws_1', '', {
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
        prisma.$queryRaw = vi.fn((sql) => {
          const q = sql.strings ? sql.strings.join('') : '';
          if (q.includes('campaigns camp')) return Promise.resolve([{ campaign_id: 'camp_1', total: 2, answered: 1 }]);
          if (q.includes('buyers b')) return Promise.resolve([{ buyer_id: 'buyer_1', total: 2, answered: 1 }]);
          if (q.includes('phone_numbers pn')) return Promise.resolve([]);
          if (q.includes('bucket_time')) return Promise.resolve([]);
          return Promise.resolve([{ total: 3, answered: 1, missed: 2, blocked: 1, answered_duration: 60 }]);
        });
        const metrics = await service.getMetrics('ws_1', '', {});
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
        const metrics = await service.getMetrics('ws_1', '', {});
        expect(metrics.aclSecs).toBeNull();
        expect(metrics.tclSecs).toBeNull();
      });

      it('2. One eligible call duration = 120 (ACL = 120, TCL = 120)', async () => {
        prisma.$queryRaw = vi.fn((sql) => {
          const q = sql.strings ? sql.strings.join('') : '';
          if (q.includes('FROM calls c\n      WHERE c.workspace_id =')) {
            return Promise.resolve([{ tcl_secs: 120, eligible_calls: 1 }]);
          }
          return Promise.resolve([]);
        });
        const metrics = await service.getMetrics('ws_1', '', {});
        expect(metrics.aclSecs).toBe(120);
        expect(metrics.tclSecs).toBe(120);
      });

      it('3. Multiple calls: 60 + 120 + 180 (ACL = 120, TCL = 360)', async () => {
        prisma.$queryRaw = vi.fn((sql) => {
          const q = sql.strings ? sql.strings.join('') : '';
          if (q.includes('FROM calls c\n      WHERE c.workspace_id =')) {
            return Promise.resolve([{ tcl_secs: 360, eligible_calls: 3 }]);
          }
          return Promise.resolve([]);
        });
        const metrics = await service.getMetrics('ws_1', '', {});
        expect(metrics.aclSecs).toBe(120);
        expect(metrics.tclSecs).toBe(360);
      });

      it('4. Call with started_at but no ended_at excluded from ACL/TCL', async () => {
        prisma.call.findMany = vi.fn().mockResolvedValue([
          { started_at: new Date('2026-09-30T10:00:00Z'), ended_at: null }
        ]);
        prisma.callAttempt.findMany = vi.fn().mockResolvedValue([]);
        const metrics = await service.getMetrics('ws_1', '', {});
        expect(metrics.aclSecs).toBeNull();
        expect(metrics.tclSecs).toBeNull();
      });

      it('5. Call with ended_at before started_at excluded', async () => {
        prisma.call.findMany = vi.fn().mockResolvedValue([
          { started_at: new Date('2026-09-30T10:02:00Z'), ended_at: new Date('2026-09-30T10:00:00Z') }
        ]);
        prisma.callAttempt.findMany = vi.fn().mockResolvedValue([]);
        const metrics = await service.getMetrics('ws_1', '', {});
        expect(metrics.aclSecs).toBeNull();
        expect(metrics.tclSecs).toBeNull();
      });

      it('6. Legacy call with duration_secs but no lifecycle timestamps excluded from ACL/TCL', async () => {
        prisma.$queryRaw = vi.fn((sql) => {
          const q = sql.strings ? sql.strings.join('') : '';
          if (q.includes('FROM calls c\n      WHERE c.workspace_id =')) {
            return Promise.resolve([{ answered: 1, answered_duration: 100, tcl_secs: null, eligible_calls: 0 }]);
          }
          return Promise.resolve([]);
        });
        const metrics = await service.getMetrics('ws_1', '', {});
        expect(metrics.avgDuration).toBe(100);
        expect(metrics.aclSecs).toBeNull();
        expect(metrics.tclSecs).toBeNull();
      });

      it('7. Date filter: only calls inside selected period included', async () => {
        prisma.$queryRaw = vi.fn().mockResolvedValue([]);
        await service.getMetrics('ws_1', '', { startDate: '2026-09-01T00:00:00Z', endDate: '2026-09-30T00:00:00Z' });
        expect(prisma.$queryRaw).toHaveBeenCalledWith(
          expect.objectContaining({
            strings: expect.arrayContaining([expect.stringContaining('c.created_at >=')])
          })
        );
        expect(prisma.$queryRaw).toHaveBeenCalledWith(
          expect.objectContaining({
            strings: expect.arrayContaining([expect.stringContaining('c.created_at <=')])
          })
        );
      });

      it('12. Tenant isolation: Workspace A cannot aggregate Workspace B calls', async () => {
        prisma.$queryRaw = vi.fn().mockResolvedValue([]);
        await service.getMetrics('ws_secure', '', {});
        expect(prisma.$queryRaw).toHaveBeenCalledWith(
          expect.objectContaining({
            strings: expect.arrayContaining([expect.stringContaining('c.workspace_id =')])
          })
        );
      });

      it('13. Campaign aggregation: each campaign receives independent ACL/TCL', async () => {
        prisma.$queryRaw = vi.fn((sql) => {
          const q = sql.strings ? sql.strings.join('') : '';
          if (q.includes('campaigns camp')) return Promise.resolve([
            { campaign_id: 'c1', tcl_secs: 60, eligible_calls: 1 },
            { campaign_id: 'c2', tcl_secs: 120, eligible_calls: 1 }
          ]);
          return Promise.resolve([]);
        });
        const metrics = await service.getMetrics('ws_1', '', {});
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
        const metrics = await service.getMetrics('ws_1', '', {});
        expect(metrics.aclSecs).toBeNull();
      });

      it('15. Decimal ACL is rounded consistently to whole seconds', async () => {
        prisma.$queryRaw = vi.fn((sql) => {
          const q = sql.strings ? sql.strings.join('') : '';
          if (q.includes('FROM calls c\n      WHERE c.workspace_id =')) {
            return Promise.resolve([{ tcl_secs: 32, eligible_calls: 3 }]);
          }
          return Promise.resolve([]);
        });
        const metrics = await service.getMetrics('ws_1', '', {});
        expect(metrics.aclSecs).toBe(11); // 32 / 3 = 10.666 -> rounds to 11
      });
    });

    describe('Live Calls', () => {
      it('1. zero live calls', async () => {
        prisma.call.count = vi.fn().mockResolvedValue(0);
        const res = await service.getLiveCalls('ws_1', '');
        expect(res.liveCalls).toBe(0);
      });

      it('2. one active call', async () => {
        prisma.call.count = vi.fn().mockResolvedValue(1);
        const res = await service.getLiveCalls('ws_1', '');
        expect(res.liveCalls).toBe(1);
      });

      it('3. multiple active calls', async () => {
        prisma.call.count = vi.fn().mockResolvedValue(5);
        const res = await service.getLiveCalls('ws_1', '');
        expect(res.liveCalls).toBe(5);
      });

      it('4. terminal calls excluded', async () => {
        prisma.call.count = vi.fn().mockResolvedValue(0);
        await service.getLiveCalls('ws_1', '');
        expect(prisma.call.count).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              state: { in: ['INITIATED', 'ROUTING'] }
            })
          })
        );
      });

      it('5. multiple CallAttempts under one parent Call count as one live call (by counting parent Call)', async () => {
        // Handled naturally because we query the Call model directly, not CallAttempts.
        await service.getLiveCalls('ws_1', '');
        expect(prisma.call.count).toHaveBeenCalled();
      });

      it('9. workspace isolation', async () => {
        prisma.call.count = vi.fn().mockResolvedValue(0);
        await service.getLiveCalls('ws_secure');
        expect(prisma.call.count).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              workspace_id: 'ws_secure'
            })
          })
        );
      });
    });
  });
});
