const fs = require('fs');

let content = fs.readFileSync('apps/api/src/calls/calls.spec.ts', 'utf8');

const newTests = `
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
`;

content = content.replace(/  \}\);\r?\n\}\);\r?\n?$/, newTests + '  });\n});\n');
fs.writeFileSync('apps/api/src/calls/calls.spec.ts', content, 'utf8');
console.log('Successfully patched calls.spec.ts');
