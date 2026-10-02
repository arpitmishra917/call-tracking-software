const fs = require('fs');
let f = fs.readFileSync('apps/api/src/calls/calls.spec.ts', 'utf8');

const additionalTests = `
      it('rejects invalid status like BLOCKED to prevent Prisma 500', async () => {
        await expect(service.getCalls('ws_1', { status: 'BLOCKED' as any })).rejects.toThrow('Invalid status: BLOCKED');
        expect(prisma.call.findMany).not.toHaveBeenCalled();
      });

      it('All Statuses produces NO state filter condition', async () => {
        await service.getCalls('ws_1', { status: undefined });
        // findMany should be called but its where clause should NOT contain state
        expect(prisma.call.findMany).toHaveBeenCalledWith(expect.objectContaining({
          where: expect.not.objectContaining({ state: expect.anything() })
        }));
      });
`;

f = f.replace(/it\('4\. status filter', async \(\) => \{/, additionalTests + "\n      it('4. status filter', async () => {");
fs.writeFileSync('apps/api/src/calls/calls.spec.ts', f);
