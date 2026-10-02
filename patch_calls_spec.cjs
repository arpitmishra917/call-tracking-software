const fs = require('fs');

let content = fs.readFileSync('apps/api/src/calls/calls.spec.ts', 'utf8');

const filterTests = `
    describe('getCalls Filters', () => {
      beforeEach(() => {
        prisma.call.findMany = vi.fn().mockResolvedValue([]);
        prisma.call.count = vi.fn().mockResolvedValue(0);
        prisma.$queryRaw = vi.fn().mockResolvedValue([]);
      });

      it('1. tracking number filter', async () => {
        await service.getCalls('ws_1', { trackingNumber: '+13215033884' });
        expect(prisma.call.findMany).toHaveBeenCalledWith(expect.objectContaining({
          where: expect.objectContaining({ to_number: '+13215033884' })
        }));
      });

      it('2. campaign filter', async () => {
        await service.getCalls('ws_1', { campaignId: 'camp_1' });
        expect(prisma.call.findMany).toHaveBeenCalledWith(expect.objectContaining({
          where: expect.objectContaining({ campaign_id: 'camp_1' })
        }));
      });

      it('3. caller filter', async () => {
        await service.getCalls('ws_1', { callerNumber: '+123' });
        expect(prisma.call.findMany).toHaveBeenCalledWith(expect.objectContaining({
          where: expect.objectContaining({ from_number: { contains: '+123' } })
        }));
      });

      it('4. status filter', async () => {
        await service.getCalls('ws_1', { status: 'COMPLETED' as any });
        expect(prisma.call.findMany).toHaveBeenCalledWith(expect.objectContaining({
          where: expect.objectContaining({ state: 'COMPLETED' })
        }));
      });

      it('5. start date', async () => {
        await service.getCalls('ws_1', { startDate: '2026-10-01' });
        expect(prisma.call.findMany).toHaveBeenCalledWith(expect.objectContaining({
          where: expect.objectContaining({ created_at: expect.objectContaining({ gte: new Date('2026-10-01T00:00:00Z') }) })
        }));
      });

      it('6. end date', async () => {
        await service.getCalls('ws_1', { endDate: '2026-10-01' });
        expect(prisma.call.findMany).toHaveBeenCalledWith(expect.objectContaining({
          where: expect.objectContaining({ created_at: expect.objectContaining({ lt: new Date('2026-10-02T00:00:00.000Z') }) })
        }));
      });

      it('7. talk duration filter', async () => {
        prisma.$queryRaw.mockResolvedValue([{ id: 'valid_call' }]);
        await service.getCalls('ws_1', { durationType: 'talk', minDurationSecs: 60 });
        expect(prisma.$queryRaw).toHaveBeenCalled();
        expect(prisma.call.findMany).toHaveBeenCalledWith(expect.objectContaining({
          where: expect.objectContaining({ id: { in: ['valid_call'] } })
        }));
      });

      it('8. total duration filter', async () => {
        prisma.$queryRaw.mockResolvedValue([{ id: 'valid_call' }]);
        await service.getCalls('ws_1', { durationType: 'total', minDurationSecs: 80 });
        expect(prisma.$queryRaw).toHaveBeenCalled();
      });

      it('11. combined filters', async () => {
        await service.getCalls('ws_1', { campaignId: 'c1', trackingNumber: 't1' });
        expect(prisma.call.findMany).toHaveBeenCalledWith(expect.objectContaining({
          where: expect.objectContaining({ campaign_id: 'c1', to_number: 't1' })
        }));
      });

      it('12. workspace isolation', async () => {
        await service.getCalls('ws_secure', {});
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
        const res = await service.getCalls('ws_1', {});
        expect(res.items[0].talkDurationSecs).toBe(120);
        expect(res.items[0].totalDurationSecs).toBe(130);
        expect(res.items[0].recordings[0].id).toBe('rec_1');
      });
    });
`;

content = content.replace(/describe\('Call Logs & Metrics \(Stage 17\)', \(\) => \{/, "describe('Call Logs & Metrics (Stage 17)', () => {" + filterTests);
fs.writeFileSync('apps/api/src/calls/calls.spec.ts', content, 'utf8');
console.log('Patched calls.spec.ts');
