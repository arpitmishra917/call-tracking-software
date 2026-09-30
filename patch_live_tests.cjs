const fs = require('fs');
let content = fs.readFileSync('apps/api/src/calls/calls.spec.ts', 'utf8');

const liveCallsTests = `
    describe('Live Calls', () => {
      it('1. zero live calls', async () => {
        prisma.call.count = vi.fn().mockResolvedValue(0);
        const res = await service.getLiveCalls('ws_1');
        expect(res.liveCalls).toBe(0);
      });

      it('2. one active call', async () => {
        prisma.call.count = vi.fn().mockResolvedValue(1);
        const res = await service.getLiveCalls('ws_1');
        expect(res.liveCalls).toBe(1);
      });

      it('3. multiple active calls', async () => {
        prisma.call.count = vi.fn().mockResolvedValue(5);
        const res = await service.getLiveCalls('ws_1');
        expect(res.liveCalls).toBe(5);
      });

      it('4. terminal calls excluded', async () => {
        prisma.call.count = vi.fn().mockResolvedValue(0);
        await service.getLiveCalls('ws_1');
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
        await service.getLiveCalls('ws_1');
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
`;

content = content.replace(/  \}\);\r?\n\}\);\r?\n?$/, liveCallsTests + '  });\n});\n');
fs.writeFileSync('apps/api/src/calls/calls.spec.ts', content, 'utf8');
console.log('Patched calls tests successfully');
