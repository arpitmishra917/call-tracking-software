import { PermissionsService } from '../permissions/permissions.service.js';
import { Test, TestingModule } from '@nestjs/testing';
import { CallsService } from './calls.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { UsageService } from '../usage/usage.service.js';
import { WebhooksService } from '../webhooks/webhooks.service.js';
import { BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { CallState, CallAttemptState, Call, CallAttempt } from '@prisma/client';
import { vi } from 'vitest';

describe('CallsService (Stage 13)', () => {
  let service: CallsService;
  let prisma: any;
  let usage: any;

  beforeEach(async () => {
    prisma = {
      $transaction: vi.fn((cb) => cb(prisma)),
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'call_1', state: CallState.ROUTING }]),
      workspaceMember: {
        findUnique: vi.fn(),
      },
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
        { provide: PermissionsService, useValue: { getPermissionsForUser: vi.fn().mockResolvedValue([{ key: 'call:read', scope_type: 'ALL' }]) } },
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
        data: { state: CallState.CANCELED, duration_secs: 0, ended_at: expect.any(Date) },
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
        expect(metrics.answerRate).toBe(33.33);
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
              workspace_id: 'ws_1',
              state: CallState.COMPLETED,
              ended_at: null,
              answered_at: { not: null },
              attempts: {
                some: {
                  state: CallAttemptState.ANSWERED,
                  ended_at: null,
                },
              },
              callReservation: {
                status: 'ACTIVE',
              },
            }),
          }),
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

    describe('Vendor IDOR Security & Scoping (COMM-INTEGRATION-6)', () => {
      const vendorMemberA = {
        workspace_id: 'ws_1',
        user_id: 'user_vendor_a',
        role: 'MEMBER',
        participant_type: 'VENDOR',
        vendor_id: 'vendor_a',
      };

      beforeEach(() => {
        prisma.workspaceMember.findUnique.mockImplementation(({ where }: any) => {
          if (where.workspace_id_user_id?.user_id === 'user_vendor_a') {
            return Promise.resolve(vendorMemberA);
          }
          return Promise.resolve(null);
        });
      });

      it('Vendor A -> Vendor B calls: getCalls strictly forces Vendor A attribution', async () => {
        prisma.call.findMany.mockResolvedValue([]);
        prisma.call.count.mockResolvedValue(0);

        await service.getCalls('ws_1', 'user_vendor_a', {});

        expect(prisma.call.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              workspace_id: 'ws_1',
              OR: [
                {
                  attribution_source: 'INGRESS_ASSIGNED',
                  attributed_vendor_id: 'vendor_a',
                },
                {
                  attribution_source: 'LEGACY_COMMERCIAL',
                  commercial: { vendor_id: 'vendor_a' },
                },
              ],
            }),
          }),
        );
      });

      it('Vendor A -> Vendor B call detail: getCallDetail rejects with 403 Forbidden', async () => {
        prisma.call.findUnique.mockResolvedValue({
          id: 'call_b',
          workspace_id: 'ws_1',
          attempts: [],
          recordings: [],
          commercial: {
            id: 'comm_b',
            vendor_id: 'vendor_b', // Belongs to Vendor B
            payout: 50,
          },
        });

        await expect(
          service.getCallDetail('ws_1', 'call_b', 'user_vendor_a'),
        ).rejects.toThrow(ForbiddenException);
      });

      it('Vendor A -> cross-workspace call detail: getCallDetail rejects with 404 Not Found', async () => {
        // Querying for a call that belongs to another workspace returns null in findUnique
        prisma.call.findUnique.mockResolvedValue(null);

        await expect(
          service.getCallDetail('ws_1', 'call_cross_ws', 'user_vendor_a'),
        ).rejects.toThrow(NotFoundException);
      });

      it('Vendor A receives sanitized call detail on their own call without buyer identity', async () => {
        prisma.call.findUnique.mockResolvedValue({
          id: 'call_a',
          workspace_id: 'ws_1',
          attribution_source: 'LEGACY_COMMERCIAL',
          attempts: [
            { id: 'att_1', buyer_id: 'buyer_secret', buyer: { name: 'Secret Buyer Inc' } },
          ],
          recordings: [],
          commercial: {
            id: 'comm_a',
            vendor_id: 'vendor_a',
            payout: 45,
            revenue: 100,
            cost: 20,
            profit: 80,
            currency: 'USD',
          },
        });

        const result = await service.getCallDetail('ws_1', 'call_a', 'user_vendor_a');

        // Payout present
        expect(result.commercial.payout).toBe(45);
        // Revenue, Cost, Profit strictly stripped
        expect((result.commercial as any).revenue).toBeUndefined();
        expect((result.commercial as any).cost).toBeUndefined();
        expect((result.commercial as any).profit).toBeUndefined();
        // Buyer stripped from attempts
        expect(result.attempts[0].buyer).toBeUndefined();
        expect(result.attempts[0].buyer_id).toBeUndefined();
      });
    describe('Finding B (P0): Buyer Routing-Attempt Disclosure & Waterfall Isolation', () => {
      beforeEach(() => {
        prisma.workspaceMember.findUnique.mockImplementation(({ where }) => {
          if (where.workspace_id_user_id?.user_id === 'user_buyer_a') {
            return Promise.resolve({
              id: 'member_buyer_a',
              workspace_id: 'ws_1',
              user_id: 'user_buyer_a',
              role: 'MEMBER',
              participant_type: 'BUYER',
              buyer_id: 'buyer_a',
            });
          }
          if (where.workspace_id_user_id?.user_id === 'user_buyer_b') {
            return Promise.resolve({
              id: 'member_buyer_b',
              workspace_id: 'ws_1',
              user_id: 'user_buyer_b',
              role: 'MEMBER',
              participant_type: 'BUYER',
              buyer_id: 'buyer_b',
            });
          }
          if (where.workspace_id_user_id?.user_id === 'user_owner') {
            return Promise.resolve({
              id: 'member_owner',
              workspace_id: 'ws_1',
              user_id: 'user_owner',
              role: 'OWNER',
              participant_type: null,
            });
          }
          return Promise.resolve(null);
        });
      });

      it('Buyer A receives only their own attempt; competitor Buyer B attempt is strictly excluded', async () => {
        prisma.call.findUnique.mockResolvedValue({
          id: 'call_multi_attempt',
          workspace_id: 'ws_1',
          attempts: [
            { id: 'att_b', buyer_id: 'buyer_b', state: CallAttemptState.REJECTED, buyer: { name: 'Competitor Buyer B' } },
            { id: 'att_a', buyer_id: 'buyer_a', state: CallAttemptState.COMPLETED, buyer: { name: 'Authorized Buyer A' } },
          ],
          recordings: [],
          commercial: {
            id: 'comm_1',
            buyer_id: 'buyer_a',
            revenue: 120,
            payout: 50,
            cost: 20,
            profit: 70,
            currency: 'USD',
          },
        });

        const detail = await service.getCallDetail('ws_1', 'call_multi_attempt', 'user_buyer_a');
        expect(detail.attempts).toHaveLength(1);
        expect(detail.attempts[0].buyer_id).toBe('buyer_a');
        expect(detail.attempts[0].id).toBe('att_a');
        expect(detail.attempts.some((a) => a.buyer_id === 'buyer_b')).toBe(false);
      });

      it('Buyer A getCalls response strips competitor attempts', async () => {
        prisma.call.findMany.mockResolvedValue([
          {
            id: 'call_multi_attempt_list',
            workspace_id: 'ws_1',
            attempts: [
              { id: 'att_b', buyer_id: 'buyer_b', state: CallAttemptState.NO_ANSWER, buyer: { name: 'Competitor B' } },
              { id: 'att_a', buyer_id: 'buyer_a', state: CallAttemptState.ANSWERED, buyer: { name: 'Buyer A' } },
            ],
            recordings: [],
            commercial: {
              id: 'comm_list_1',
              buyer_id: 'buyer_a',
              revenue: 80,
              payout: 30,
              cost: 10,
              profit: 50,
              currency: 'USD',
            },
          },
        ]);
        prisma.call.count.mockResolvedValue(1);

        const res = await service.getCalls('ws_1', 'user_buyer_a', {});
        expect(res.items[0].attempts).toHaveLength(1);
        expect(res.items[0].attempts[0].buyer_id).toBe('buyer_a');
      });

      it('Competitor Buyer B is rejected with 403 Forbidden when requesting Buyer A call detail', async () => {
        prisma.call.findUnique.mockResolvedValue({
          id: 'call_multi_attempt',
          workspace_id: 'ws_1',
          attempts: [
            { id: 'att_a', buyer_id: 'buyer_a', state: CallAttemptState.COMPLETED },
          ],
          commercial: {
            id: 'comm_1',
            buyer_id: 'buyer_a',
          },
        });

        await expect(
          service.getCallDetail('ws_1', 'call_multi_attempt', 'user_buyer_b'),
        ).rejects.toThrow(ForbiddenException);
      });

      it('Owner sees the complete waterfall of all buyer attempts', async () => {
        prisma.call.findUnique.mockResolvedValue({
          id: 'call_multi_attempt',
          workspace_id: 'ws_1',
          attempts: [
            { id: 'att_b', buyer_id: 'buyer_b', state: CallAttemptState.REJECTED, buyer: { name: 'Competitor Buyer B' } },
            { id: 'att_a', buyer_id: 'buyer_a', state: CallAttemptState.COMPLETED, buyer: { name: 'Authorized Buyer A' } },
          ],
          recordings: [],
          commercial: {
            id: 'comm_1',
            buyer_id: 'buyer_a',
            revenue: 120,
            payout: 50,
            cost: 20,
            profit: 70,
            currency: 'USD',
          },
        });

        const detail = await service.getCallDetail('ws_1', 'call_multi_attempt', 'user_owner');
        expect(detail.attempts).toHaveLength(2);
        expect(detail.attempts[0].buyer_id).toBe('buyer_b');
        expect(detail.attempts[1].buyer_id).toBe('buyer_a');
      });
    });

    describe('Buyer Portal Phase 2: Operational Call Visibility & Reporting Reconciliation', () => {
      beforeEach(() => {
        prisma.workspaceMember.findUnique.mockImplementation(({ where }) => {
          if (where.workspace_id_user_id?.user_id === 'user_buyer_a') {
            return Promise.resolve({
              id: 'member_buyer_a',
              workspace_id: 'ws_1',
              user_id: 'user_buyer_a',
              role: 'MEMBER',
              participant_type: 'BUYER',
              buyer_id: 'buyer_a',
            });
          }
          if (where.workspace_id_user_id?.user_id === 'user_buyer_b') {
            return Promise.resolve({
              id: 'member_buyer_b',
              workspace_id: 'ws_1',
              user_id: 'user_buyer_b',
              role: 'MEMBER',
              participant_type: 'BUYER',
              buyer_id: 'buyer_b',
            });
          }
          return Promise.resolve(null);
        });
      });

      it('getCalls: Buyer A can see uncommercialized operational calls (missed/failed) with Buyer A attempt', async () => {
        prisma.call.findMany.mockImplementation(({ where }) => {
          expect(where.OR).toEqual([
            { commercial: { buyer_id: 'buyer_a' } },
            { attempts: { some: { buyer_id: 'buyer_a' } } },
          ]);
          return Promise.resolve([
            {
              id: 'call_op_missed',
              workspace_id: 'ws_1',
              state: CallState.NO_ANSWER,
              created_at: new Date('2026-10-24T10:00:00Z'),
              started_at: new Date('2026-10-24T10:00:00Z'),
              ended_at: new Date('2026-10-24T10:00:30Z'),
              commercial: null,
              recordings: [{ id: 'rec_unauth', status: 'COMPLETED' }],
              attempts: [
                { id: 'att_a', buyer_id: 'buyer_a', state: CallAttemptState.NO_ANSWER },
              ],
            },
          ]);
        });
        prisma.call.count.mockResolvedValue(1);

        const res = await service.getCalls('ws_1', 'user_buyer_a', {});
        expect(res.items).toHaveLength(1);
        expect(res.items[0].id).toBe('call_op_missed');
        expect(res.items[0].state).toBe(CallState.NO_ANSWER);
        expect(res.items[0].commercial).toBeNull();
        expect(res.items[0].recordings).toEqual([]); // Fail closed: recordings stripped
        expect(res.items[0].attempts).toHaveLength(1);
        expect(res.items[0].attempts[0].buyer_id).toBe('buyer_a');
      });

      it('getCalls: waterfall uncommercialized call only reveals Buyer A attempt to Buyer A', async () => {
        prisma.call.findMany.mockResolvedValue([
          {
            id: 'call_waterfall_failed',
            workspace_id: 'ws_1',
            state: CallState.FAILED,
            created_at: new Date('2026-10-24T12:00:00Z'),
            commercial: null,
            recordings: [],
            attempts: [
              { id: 'att_b', buyer_id: 'buyer_b', state: CallAttemptState.FAILED, buyer: { name: 'Competitor B' } },
              { id: 'att_a', buyer_id: 'buyer_a', state: CallAttemptState.FAILED, buyer: { name: 'Buyer A' } },
            ],
          },
        ]);
        prisma.call.count.mockResolvedValue(1);

        const res = await service.getCalls('ws_1', 'user_buyer_a', {});
        expect(res.items[0].attempts).toHaveLength(1);
        expect(res.items[0].attempts[0].buyer_id).toBe('buyer_a');
        expect(res.items[0].attempts.some((a: any) => a.buyer_id === 'buyer_b')).toBe(false);
      });

      it('getCallDetail: Buyer A can view uncommercialized call where Buyer A was attempted', async () => {
        prisma.call.findUnique.mockResolvedValue({
          id: 'call_op_1',
          workspace_id: 'ws_1',
          state: CallState.NO_ANSWER,
          commercial: null,
          recordings: [{ id: 'rec_1', status: 'COMPLETED' }],
          attempts: [
            { id: 'att_a', buyer_id: 'buyer_a', state: CallAttemptState.NO_ANSWER, buyer: { name: 'Buyer A' } },
          ],
        });

        const detail = await service.getCallDetail('ws_1', 'call_op_1', 'user_buyer_a');
        expect(detail.id).toBe('call_op_1');
        expect(detail.commercial).toBeNull();
        expect(detail.recordings).toEqual([]); // Stripped for uncommercialized call
        expect(detail.attempts).toHaveLength(1);
        expect(detail.attempts[0].buyer_id).toBe('buyer_a');
      });

      it('getCallDetail: Buyer A is denied (403) for uncommercialized call attempted only to competitor Buyer B', async () => {
        prisma.call.findUnique.mockResolvedValue({
          id: 'call_op_b',
          workspace_id: 'ws_1',
          state: CallState.NO_ANSWER,
          commercial: null,
          attempts: [
            { id: 'att_b', buyer_id: 'buyer_b', state: CallAttemptState.NO_ANSWER },
          ],
        });

        await expect(
          service.getCallDetail('ws_1', 'call_op_b', 'user_buyer_a'),
        ).rejects.toThrow(ForbiddenException);
      });

      it('getCallDetail (Policy A - B-06): Buyer A can view sanitized detail if call was won commercially by Buyer B but Buyer A had an earlier attempt', async () => {
        prisma.call.findUnique.mockResolvedValue({
          id: 'call_waterfall_won_by_b',
          workspace_id: 'ws_1',
          state: CallState.COMPLETED,
          commercial: {
            id: 'comm_b',
            buyer_id: 'buyer_b', // Won by competitor Buyer B
          },
          attempts: [
            { id: 'att_a', buyer_id: 'buyer_a', state: CallAttemptState.NO_ANSWER },
            { id: 'att_b', buyer_id: 'buyer_b', state: CallAttemptState.COMPLETED },
          ],
        });

        const res = await service.getCallDetail('ws_1', 'call_waterfall_won_by_b', 'user_buyer_a');
        expect(res.id).toBe('call_waterfall_won_by_b');
        expect(res.commercial).toBeNull();
        expect(res.attempts).toHaveLength(1);
        expect(res.attempts[0].buyer_id).toBe('buyer_a');
        expect(res.recordings).toEqual([]);
      });

      it('getMetrics: generates operational attribution SQL condition and sanitizes financial metrics for Buyer', async () => {
        let capturedSql = '';
        prisma.$queryRaw = vi.fn((sql) => {
          const q = sql.strings ? sql.strings.join('') : (typeof sql === 'string' ? sql : '');
          capturedSql += q + ' ';
          if (q.includes('camp.name as campaign_name')) return Promise.resolve([]);
          if (q.includes('b.name as buyer_name')) return Promise.resolve([]);
          if (q.includes('pn.name as tracking_number_name')) return Promise.resolve([]);
          if (q.includes('bucket_time')) return Promise.resolve([]);
          if (q.includes('currency_count')) {
            return Promise.resolve([{
              revenue: 150, payout: 50, cost: 20, profit: 80,
              converted: 1, qualified: 1, duplicate: 0, commercial_total: 1,
              currency_count: 1, currency: 'USD'
            }]);
          }
          return Promise.resolve([{
            total: 5, answered: 2, missed: 2, failed: 1, blocked: 0,
            total_duration: 120, talk_duration: 90, tcl_secs: 120, eligible_calls: 2, answered_duration: 90
          }]);
        });

        const metrics = await service.getMetrics('ws_1', 'user_buyer_a', {
          startDate: '2026-10-01',
          endDate: '2026-10-24',
        });

        // Verifies operational SQL condition includes both commercial and non-commercial attempts
        expect(capturedSql).toContain('ccom_b.buyer_id =');
        expect(capturedSql).toContain('NOT EXISTS (SELECT 1 FROM call_commercials ccom_any');
        expect(capturedSql).toContain('ca_b.buyer_id =');

        // Operational totals reflect all operational calls
        expect(metrics.total).toBe(5);
        expect(metrics.answered).toBe(2);
        expect(metrics.missed).toBe(2);
        expect(metrics.failed).toBe(1);

        // Commercial metrics reflect only commercial evaluation
        expect(metrics.revenue).toBe(150);
        expect(metrics.commercialCalls).toBe(1);
        expect(metrics.converted).toBe(1);
        expect(metrics.conversionRate).toBe(100);

        // Payout, cost, profit are strictly sanitized for Buyer
        expect((metrics as any).payout).toBeUndefined();
        expect((metrics as any).cost).toBeUndefined();
        expect((metrics as any).profit).toBeUndefined();
      });
    });
    });
  });

  describe('Talk and Total Duration End-to-End Regression Suite', () => {
    it('1. A completed call with a known connected duration displays the correct Talk Duration', async () => {
      prisma.call.findMany.mockResolvedValueOnce([{
        id: 'call-known-talk',
        state: CallState.COMPLETED,
        started_at: new Date('2026-10-01T10:00:00Z'),
        answered_at: new Date('2026-10-01T10:00:15Z'),
        ended_at: new Date('2026-10-01T10:02:15Z'),
        attempts: [],
      }]);

      const res = await service.getCalls('ws_1', '', {});
      expect(res.items[0].talkDurationSecs).toBe(120);
    });

    it('2. A completed call with a known total lifetime displays the correct Total Duration', async () => {
      prisma.call.findMany.mockResolvedValueOnce([{
        id: 'call-known-total',
        state: CallState.COMPLETED,
        created_at: new Date('2026-10-01T10:00:00Z'),
        started_at: new Date('2026-10-01T10:00:00Z'),
        answered_at: new Date('2026-10-01T10:00:10Z'),
        ended_at: new Date('2026-10-01T10:03:10Z'),
        attempts: [],
      }]);

      const res = await service.getCalls('ws_1', '', {});
      expect(res.items[0].totalDurationSecs).toBe(190);
    });

    it('3. A valid zero-second duration displays as 0 (not null or omitted)', async () => {
      prisma.call.findMany.mockResolvedValueOnce([{
        id: 'call-zero-talk',
        state: CallState.COMPLETED,
        started_at: new Date('2026-10-01T10:00:00Z'),
        answered_at: new Date('2026-10-01T10:00:10Z'),
        ended_at: new Date('2026-10-01T10:00:10Z'),
        attempts: [],
      }]);

      const res = await service.getCalls('ws_1', '', {});
      expect(res.items[0].talkDurationSecs).toBe(0);
      expect(res.items[0].totalDurationSecs).toBe(10);
    });

    it('4. A null duration remains distinguishable from a genuine zero', async () => {
      prisma.call.findMany.mockResolvedValueOnce([
        {
          id: 'call-genuine-zero',
          state: CallState.COMPLETED,
          duration_secs: 0,
          attempts: [{ state: CallAttemptState.COMPLETED, answered_at: new Date() }],
        },
        {
          id: 'call-unconnected-null',
          state: CallState.FAILED,
          duration_secs: null,
          attempts: [{ state: CallAttemptState.FAILED, answered_at: null }],
        }
      ]);

      const res = await service.getCalls('ws_1', '', {});
      expect(res.items[0].talkDurationSecs).toBe(0);
      expect(res.items[1].talkDurationSecs).toBeNull();
    });

    it('5. Failed bridge/no-answer calls do not receive fabricated talk duration', async () => {
      prisma.call.findMany.mockResolvedValueOnce([{
        id: 'call-no-answer',
        state: CallState.NO_ANSWER,
        created_at: new Date('2026-10-01T10:00:00Z'),
        started_at: new Date('2026-10-01T10:00:00Z'),
        answered_at: null,
        ended_at: new Date('2026-10-01T10:01:00Z'),
        attempts: [
          { id: 'att-failed', state: CallAttemptState.NO_ANSWER, answered_at: null, ended_at: new Date('2026-10-01T10:01:00Z') }
        ],
      }]);

      const res = await service.getCalls('ws_1', '', {});
      expect(res.items[0].talkDurationSecs).toBeNull();
      expect(res.items[0].totalDurationSecs).toBe(60);
    });

    it('6. Completed call with missing call.ended_at reconstructs from connected attempt', async () => {
      prisma.call.findMany.mockResolvedValueOnce([{
        id: 'call-attempt-ended',
        state: CallState.COMPLETED,
        created_at: new Date('2026-10-01T10:00:00Z'),
        answered_at: new Date('2026-10-01T10:00:10Z'),
        ended_at: null,
        attempts: [
          {
            id: 'att-answered',
            state: CallAttemptState.COMPLETED,
            answered_at: new Date('2026-10-01T10:00:10Z'),
            ended_at: new Date('2026-10-01T10:00:43Z'),
          }
        ],
      }]);

      const res = await service.getCalls('ws_1', '', {});
      expect(res.items[0].talkDurationSecs).toBe(33);
      expect(res.items[0].totalDurationSecs).toBe(43);
    });

    it('7. Historical record with persisted duration_secs preserves talk duration without fabricating total duration', async () => {
      prisma.call.findMany.mockResolvedValueOnce([{
        id: 'call-historical',
        state: CallState.COMPLETED,
        duration_secs: 45,
        created_at: new Date('2026-09-30T10:00:00Z'),
        started_at: null,
        answered_at: null,
        ended_at: null,
        attempts: [],
      }]);

      const res = await service.getCalls('ws_1', '', {});
      expect(res.items[0].talkDurationSecs).toBe(45);
      expect(res.items[0].totalDurationSecs).toBeNull();
    });

    it('8. Durations are calculated in seconds consistently and getCallDetail preserves them', async () => {
      prisma.call.findUnique.mockResolvedValueOnce({
        id: 'call-detail-1',
        workspace_id: 'ws_1',
        state: CallState.COMPLETED,
        started_at: new Date('2026-10-01T10:00:00Z'),
        answered_at: new Date('2026-10-01T10:00:05Z'),
        ended_at: new Date('2026-10-01T10:01:05Z'),
        attempts: [],
      });

      const detail = await service.getCallDetail('ws_1', 'call-detail-1', '');
      expect(detail.talkDurationSecs).toBe(60);
      expect(detail.totalDurationSecs).toBe(65);
    });

    it('9. A finalized call duration remains stable after later refreshes', async () => {
      const fixedCall = {
        id: 'call-stable',
        state: CallState.COMPLETED,
        started_at: new Date('2026-10-01T10:00:00Z'),
        answered_at: new Date('2026-10-01T10:00:10Z'),
        ended_at: new Date('2026-10-01T10:02:10Z'),
        attempts: [],
      };

      prisma.call.findMany.mockResolvedValue([fixedCall]);

      const firstFetch = await service.getCalls('ws_1', '', {});
      const secondFetch = await service.getCalls('ws_1', '', {});

      expect(firstFetch.items[0].talkDurationSecs).toBe(120);
      expect(secondFetch.items[0].talkDurationSecs).toBe(120);
      expect(firstFetch.items[0].totalDurationSecs).toBe(130);
      expect(secondFetch.items[0].totalDurationSecs).toBe(130);
    });

    it('10. NO_ANSWER call with failed bridge attempt does not return false talk duration', async () => {
      // Replicating call a6f14e3f: call NO_ANSWER, attempt 1 answered then bridge FAILED after 4s, attempt 2 NO_ANSWER
      prisma.call.findMany.mockResolvedValueOnce([{
        id: 'call-no-answer-failed-bridge',
        state: CallState.NO_ANSWER,
        created_at: new Date('2026-10-23T16:37:50.000Z'),
        started_at: null,
        answered_at: null,
        ended_at: new Date('2026-10-23T16:38:46.000Z'),
        attempts: [
          {
            id: 'attempt-failed-bridge',
            state: CallAttemptState.FAILED,
            answered_at: new Date('2026-10-23T16:38:11.000Z'),
            ended_at: new Date('2026-10-23T16:38:15.000Z'), // 4s elapsed before failure
          },
          {
            id: 'attempt-no-answer',
            state: CallAttemptState.NO_ANSWER,
            answered_at: null,
            ended_at: new Date('2026-10-23T16:38:46.000Z'),
          }
        ],
      }]);

      const res = await service.getCalls('ws_1', '', {});
      expect(res.items[0].talkDurationSecs).toBeNull();
      expect(res.items[0].totalDurationSecs).toBe(56);
    });

    it('11. Unbridged ROUTING call returns null for both talk and total duration', async () => {
      prisma.call.findMany.mockResolvedValueOnce([{
        id: 'call-routing-unbridged',
        state: CallState.ROUTING,
        created_at: new Date('2026-10-23T16:36:17.000Z'),
        started_at: null,
        answered_at: null,
        ended_at: null,
        duration_secs: null,
        attempts: [
          {
            id: 'attempt-ringing',
            state: CallAttemptState.RINGING,
            started_at: null,
            answered_at: null,
            ended_at: null,
          }
        ],
      }]);

      const res = await service.getCalls('ws_1', '', {});
      expect(res.items[0].talkDurationSecs).toBeNull();
      expect(res.items[0].totalDurationSecs).toBeNull();
    });
  });

  describe('Phase 2 B-06: Buyer Rollover Call Visibility & Competitor Isolation', () => {
    beforeEach(() => {
      prisma.workspaceMember.findUnique.mockImplementation(({ where }) => {
        if (where.workspace_id_user_id?.user_id === 'user_buyer_a') {
          return Promise.resolve({
            id: 'member_buyer_a',
            workspace_id: 'ws_1',
            user_id: 'user_buyer_a',
            role: 'MEMBER',
            participant_type: 'BUYER',
            buyer_id: 'buyer_a',
          });
        }
        if (where.workspace_id_user_id?.user_id === 'user_buyer_b') {
          return Promise.resolve({
            id: 'member_buyer_b',
            workspace_id: 'ws_1',
            user_id: 'user_buyer_b',
            role: 'MEMBER',
            participant_type: 'BUYER',
            buyer_id: 'buyer_b',
          });
        }
        return Promise.resolve(null);
      });
    });

    it('1. Rollover visibility: Buyer A has an attempt, Buyer B wins commercially -> call is visible in Buyer A list', async () => {
      let capturedWhere: any = null;
      prisma.call.findMany.mockImplementation(({ where }) => {
        capturedWhere = where;
        return Promise.resolve([
          {
            id: 'call_rollover_1',
            workspace_id: 'ws_1',
            state: CallState.COMPLETED,
            from_number: '+15551234567',
            to_number: '+15559876543',
            created_at: new Date('2026-10-25T10:00:00Z'),
            commercial: {
              id: 'comm_b',
              buyer_id: 'buyer_b',
              revenue: 100,
              payout: 40,
              buyer: { id: 'buyer_b', name: 'Competitor B' },
            },
            recordings: [{ id: 'rec_b', status: 'COMPLETED' }],
            attempts: [
              { id: 'att_a', buyer_id: 'buyer_a', state: CallAttemptState.NO_ANSWER, buyer: { name: 'Buyer A' } },
              { id: 'att_b', buyer_id: 'buyer_b', state: CallAttemptState.COMPLETED, buyer: { name: 'Competitor B' } },
            ],
          },
        ]);
      });
      prisma.call.count.mockResolvedValue(1);

      const res = await service.getCalls('ws_1', 'user_buyer_a', {});
      expect(capturedWhere.workspace_id).toBe('ws_1');
      expect(capturedWhere.OR).toEqual([
        { commercial: { buyer_id: 'buyer_a' } },
        { attempts: { some: { buyer_id: 'buyer_a' } } },
      ]);
      expect(res.items).toHaveLength(1);
      expect(res.items[0].id).toBe('call_rollover_1');
    });

    it('2. Own attempt only: Buyer A response contains its own routing attempt but no Buyer B attempt or identity', async () => {
      prisma.call.findMany.mockResolvedValueOnce([
        {
          id: 'call_rollover_2',
          workspace_id: 'ws_1',
          state: CallState.COMPLETED,
          from_number: '+15551234567',
          to_number: '+15559876543',
          created_at: new Date('2026-10-25T10:00:00Z'),
          commercial: {
            id: 'comm_b',
            buyer_id: 'buyer_b',
            revenue: 100,
            buyer: { id: 'buyer_b', name: 'Competitor B' },
          },
          recordings: [{ id: 'rec_b', status: 'COMPLETED' }],
          attempts: [
            { id: 'att_a', buyer_id: 'buyer_a', state: CallAttemptState.NO_ANSWER, buyer: { name: 'Buyer A' } },
            { id: 'att_b', buyer_id: 'buyer_b', state: CallAttemptState.COMPLETED, buyer: { name: 'Competitor B' } },
          ],
        },
      ]);
      prisma.call.count.mockResolvedValueOnce(1);

      const res = await service.getCalls('ws_1', 'user_buyer_a', {});
      expect(res.items[0].attempts).toHaveLength(1);
      expect(res.items[0].attempts[0].buyer_id).toBe('buyer_a');
      expect(res.items[0].attempts[0].id).toBe('att_a');
      expect(res.items[0].attempts.some((a: any) => a.buyer_id === 'buyer_b')).toBe(false);
      expect(JSON.stringify(res.items[0].attempts)).not.toContain('Competitor B');
    });

    it('3. Winning commercial privacy: Buyer A cannot see Buyer B commercial attribution or revenue/payout/profit', async () => {
      prisma.call.findMany.mockResolvedValueOnce([
        {
          id: 'call_rollover_3',
          workspace_id: 'ws_1',
          state: CallState.COMPLETED,
          from_number: '+15551234567',
          to_number: '+15559876543',
          created_at: new Date('2026-10-25T10:00:00Z'),
          commercial: {
            id: 'comm_b',
            buyer_id: 'buyer_b',
            revenue: 150,
            payout: 60,
            cost: 20,
            profit: 70,
            currency: 'USD',
            buyer: { id: 'buyer_b', name: 'Competitor B' },
            dispute: { status: 'PENDING', reason: 'DEFECT' },
          },
          recordings: [{ id: 'rec_b', status: 'COMPLETED' }],
          attempts: [
            { id: 'att_a', buyer_id: 'buyer_a', state: CallAttemptState.NO_ANSWER },
          ],
        },
      ]);
      prisma.call.count.mockResolvedValueOnce(1);

      const res = await service.getCalls('ws_1', 'user_buyer_a', {});
      // Winning commercial details MUST be stripped to null for non-winning buyer
      expect(res.items[0].commercial).toBeNull();
      // Recordings MUST be stripped
      expect(res.items[0].recordings).toEqual([]);
      expect(JSON.stringify(res.items[0])).not.toContain('Competitor B');
      expect(JSON.stringify(res.items[0])).not.toContain('150');
    });

    it('4. No commercial record: Buyer A can still see its own attempted call when no CallCommercial exists', async () => {
      prisma.call.findMany.mockResolvedValueOnce([
        {
          id: 'call_no_comm',
          workspace_id: 'ws_1',
          state: CallState.NO_ANSWER,
          from_number: '+15551234567',
          to_number: '+15559876543',
          created_at: new Date('2026-10-25T10:00:00Z'),
          commercial: null,
          recordings: [],
          attempts: [
            { id: 'att_a', buyer_id: 'buyer_a', state: CallAttemptState.NO_ANSWER },
          ],
        },
      ]);
      prisma.call.count.mockResolvedValueOnce(1);

      const res = await service.getCalls('ws_1', 'user_buyer_a', {});
      expect(res.items).toHaveLength(1);
      expect(res.items[0].id).toBe('call_no_comm');
      expect(res.items[0].commercial).toBeNull();
      expect(res.items[0].attempts[0].buyer_id).toBe('buyer_a');
    });

    it('5. No attempt, no access: Buyer A cannot see Buyer B call if Buyer A has no attempt and is not winning Buyer', async () => {
      let capturedWhere: any = null;
      prisma.call.findMany.mockImplementation(({ where }) => {
        capturedWhere = where;
        return Promise.resolve([]); // DB returns empty for Buyer A
      });
      prisma.call.count.mockResolvedValueOnce(0);

      const res = await service.getCalls('ws_1', 'user_buyer_a', {});
      expect(capturedWhere.OR).toEqual([
        { commercial: { buyer_id: 'buyer_a' } },
        { attempts: { some: { buyer_id: 'buyer_a' } } },
      ]);
      expect(res.items).toHaveLength(0);
      expect(res.total).toBe(0);
    });

    it('6. Call-detail authorization (Policy A - B-06): Buyer A can view sanitized detail of rollover call won by Buyer B', async () => {
      prisma.workspaceMember.findUnique.mockImplementation(({ where }) => {
        if (where.workspace_id_user_id.user_id === 'user_buyer_a') {
          return Promise.resolve({
            id: 'mem_buyer_a',
            workspace_id: 'ws_1',
            user_id: 'user_buyer_a',
            role: 'MEMBER',
            participant_type: 'BUYER',
            buyer_id: 'buyer_a',
          });
        }
        if (where.workspace_id_user_id.user_id === 'user_buyer_c') {
          return Promise.resolve({
            id: 'mem_buyer_c',
            workspace_id: 'ws_1',
            user_id: 'user_buyer_c',
            role: 'MEMBER',
            participant_type: 'BUYER',
            buyer_id: 'buyer_c',
          });
        }
        return Promise.resolve(null);
      });

      const callData = {
        id: 'call_rollover_detail',
        workspace_id: 'ws_1',
        state: CallState.COMPLETED,
        from_number: '+15551234567',
        to_number: '+15559876543',
        commercial: {
          id: 'comm_b',
          buyer_id: 'buyer_b',
          revenue: 200,
          payout: 80,
          cost: 25,
          profit: 95,
          currency: 'USD',
          buyer: { id: 'buyer_b', name: 'Competitor B' },
        },
        recordings: [{ id: 'rec_b', status: 'COMPLETED' }],
        attempts: [
          { id: 'att_a', buyer_id: 'buyer_a', state: CallAttemptState.NO_ANSWER, buyer: { id: 'buyer_a', name: 'Buyer Alpha' } },
          { id: 'att_b', buyer_id: 'buyer_b', state: CallAttemptState.COMPLETED, buyer: { id: 'buyer_b', name: 'Competitor B' } },
        ],
      };

      prisma.call.findUnique.mockResolvedValue(callData);

      // Buyer A participated in rollover attempt -> allowed with strictly sanitized payload
      const detail = await service.getCallDetail('ws_1', 'call_rollover_detail', 'user_buyer_a');
      expect(detail.id).toBe('call_rollover_detail');
      // Commercial belongs to Buyer B -> stripped to null
      expect(detail.commercial).toBeNull();
      // Attempts filtered to ONLY Buyer A
      expect(detail.attempts).toHaveLength(1);
      expect(detail.attempts[0].buyer_id).toBe('buyer_a');
      // Recordings stripped
      expect(detail.recordings).toEqual([]);
      // Ensure zero leakage of Competitor B
      expect(JSON.stringify(detail)).not.toContain('Competitor B');
      expect(JSON.stringify(detail)).not.toContain('buyer_b');

      // Buyer C had no attempt and is not winning buyer -> strictly 403 Forbidden
      await expect(
        service.getCallDetail('ws_1', 'call_rollover_detail', 'user_buyer_c'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('7. Cross-workspace isolation: attempts in another workspace cannot make the call visible', async () => {
      let capturedWhere: any = null;
      prisma.call.findMany.mockImplementation(({ where }) => {
        capturedWhere = where;
        return Promise.resolve([]);
      });
      prisma.call.count.mockResolvedValueOnce(0);

      await service.getCalls('ws_2', 'user_buyer_a', {});
      // Must strictly enforce workspace_id scoping
      expect(capturedWhere.workspace_id).toBe('ws_2');
    });
  });

});
