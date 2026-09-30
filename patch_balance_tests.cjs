const fs = require('fs');
let content = fs.readFileSync('apps/api/src/billing/billing.service.spec.ts', 'utf8');

const balanceTests = `
  describe('getBalance', () => {
    it('1. new workspace balance = 0', async () => {
      vi.spyOn(prisma.workspace, 'findUnique').mockResolvedValue({ id: 'ws-1' } as any);
      vi.spyOn(prisma.workspaceBalance, 'findUnique').mockResolvedValue(null);
      const res = await service.getBalance('ws-1');
      expect(res.balance.amountMinor).toBe(0);
      expect(res.balance.currency).toBe('USD');
    });

    it('2. balance retrieval', async () => {
      vi.spyOn(prisma.workspace, 'findUnique').mockResolvedValue({ id: 'ws-1' } as any);
      vi.spyOn(prisma.workspaceBalance, 'findUnique').mockResolvedValue({
        workspace_id: 'ws-1',
        balance_minor: 5000,
        currency: 'USD'
      } as any);
      const res = await service.getBalance('ws-1');
      expect(res.balance.amountMinor).toBe(5000);
      expect(res.balance.currency).toBe('USD');
    });

    it('3. workspace isolation', async () => {
      vi.spyOn(prisma.workspace, 'findUnique').mockResolvedValue({ id: 'ws-2' } as any);
      const spy = vi.spyOn(prisma.workspaceBalance, 'findUnique').mockResolvedValue(null);
      await service.getBalance('ws-2');
      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ where: { workspace_id: 'ws-2' } }));
    });

    it('4. unauthorized workspace access / workspace not found', async () => {
      vi.spyOn(prisma.workspace, 'findUnique').mockResolvedValue(null);
      await expect(service.getBalance('ws-invalid')).rejects.toThrow('Workspace not found');
    });
  });
`;

content = content.replace(/describe\('getBillingState', \(\) => \{/, balanceTests + "\n  describe('getBillingState', () => {");
fs.writeFileSync('apps/api/src/billing/billing.service.spec.ts', content, 'utf8');
console.log('Patched billing tests successfully');
