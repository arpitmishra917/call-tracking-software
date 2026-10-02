const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  const workspaceId = 'fixture-ws-1';
  await prisma.workspace.upsert({
    where: { id: workspaceId },
    update: {},
    create: { id: workspaceId, name: 'Fixture Workspace', slug: 'fixture-ws-1' }
  });

  await prisma.walletTransaction.deleteMany({ where: { workspace_id: workspaceId } });
  await prisma.workspaceBalance.deleteMany({ where: { workspace_id: workspaceId } });

  await prisma.walletTransaction.create({
    data: {
      workspace_id: workspaceId, amount_minor: 100, balance_after: 100,
      amount_micro: 0n, balance_after_micro: 0n, reference_type: 'CREDIT', reference_id: 'ref-1', idempotency_key: 'idk-1'
    }
  });

  await prisma.walletTransaction.create({
    data: {
      workspace_id: workspaceId, amount_minor: 2500, balance_after: 2500,
      amount_micro: 0n, balance_after_micro: 0n, reference_type: 'CREDIT', reference_id: 'ref-2', idempotency_key: 'idk-2'
    }
  });

  await prisma.walletTransaction.create({
    data: {
      workspace_id: workspaceId, amount_minor: 45, balance_after: 45,
      amount_micro: 0n, balance_after_micro: 0n, reference_type: 'DEBIT', reference_id: 'ref-3', idempotency_key: 'idk-3'
    }
  });

  await prisma.workspaceBalance.create({
    data: {
      workspace_id: workspaceId, balance_minor: 2500, balance_micro: 0n, currency: 'USD'
    }
  });

  await prisma.$executeRawUnsafe("UPDATE wallet_transactions SET amount_micro = (amount_minor * 10000), balance_after_micro = (balance_after * 10000) WHERE workspace_id = 'fixture-ws-1';");
  await prisma.$executeRawUnsafe("UPDATE workspace_balances SET balance_micro = (balance_minor * 10000) WHERE workspace_id = 'fixture-ws-1';");

  console.log('--- FIXTURE VERIFICATION ---');
  const txs = await prisma.walletTransaction.findMany({ where: { workspace_id: workspaceId }, orderBy: { amount_minor: 'asc' } });
  for (const tx of txs) {
    console.log(`TX Minor: ${tx.amount_minor} -> TX Micro: ${tx.amount_micro}`);
    console.log(`TX Bal Minor: ${tx.balance_after} -> TX Bal Micro: ${tx.balance_after_micro}`);
  }

  const ws = await prisma.workspaceBalance.findUnique({ where: { workspace_id: workspaceId } });
  console.log(`WS Minor: ${ws.balance_minor} -> WS Micro: ${ws.balance_micro}`);

  await prisma.walletTransaction.deleteMany({ where: { workspace_id: workspaceId } });
  await prisma.workspaceBalance.deleteMany({ where: { workspace_id: workspaceId } });
  await prisma.workspace.delete({ where: { id: workspaceId } });
}

run().catch(console.error).finally(() => prisma.$disconnect());
