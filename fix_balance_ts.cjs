const fs = require('fs');
let content = fs.readFileSync('apps/api/src/billing/billing.service.ts', 'utf8');

const correctLogic = `  async getBalance(workspaceId: string) {
    const ws = await this.prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!ws) throw new NotFoundException('Workspace not found');
    const balance = await this.prisma.workspaceBalance.findUnique({
      where: { workspace_id: workspaceId }
    });
    if (!balance) {
      return { balance: { amountMinor: 0, currency: 'USD' } };
    }
    return { balance: { amountMinor: balance.balance_minor, currency: balance.currency } };
  }`;

content = content.replace(/  async getBalance\(workspaceId: string\) \{[\s\S]*?currency: balance.currency \} \};\r?\n  \}/, correctLogic);

fs.writeFileSync('apps/api/src/billing/billing.service.ts', content, 'utf8');
console.log('Fixed TypeScript null error');
