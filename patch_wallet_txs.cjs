const fs = require('fs');
let s = fs.readFileSync('apps/api/src/billing/wallet.service.ts', 'utf8');

const target = `  async getTransactions(workspaceId: string, limit = 50, offset = 0) {
    return this.prisma.walletTransaction.findMany({
      where: { workspace_id: workspaceId },
      orderBy: { created_at: 'desc' },
      take: limit,
      skip: offset,
    });
  }`;

const replacement = `  async getTransactions(workspaceId: string, limit = 50, offset = 0) {
    const txs = await this.prisma.walletTransaction.findMany({
      where: { workspace_id: workspaceId },
      orderBy: { created_at: 'desc' },
      take: limit,
      skip: offset,
    });
    return txs.map(tx => ({
      ...tx,
      amount_micro: tx.amount_micro ? tx.amount_micro.toString() : '0',
      balance_after_micro: tx.balance_after_micro ? tx.balance_after_micro.toString() : '0'
    }));
  }`;

s = s.replace(target, replacement);
fs.writeFileSync('apps/api/src/billing/wallet.service.ts', s);
