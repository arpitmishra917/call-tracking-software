const { PrismaClient } = require(require('path').resolve(__dirname, '../../apps/api/node_modules/@prisma/client'));
const prisma = new PrismaClient();

async function run() {
  const wsCount = await prisma.workspaceBalance.count();
  const txCount = await prisma.walletTransaction.count();

  let wsMinorSum = 0n;
  let wsMicroSum = 0n;
  let txMinorSum = 0n;
  let txMicroSum = 0n;
  let mismatches = 0;

  const allWs = await prisma.workspaceBalance.findMany();
  for (const w of allWs) {
    wsMinorSum += BigInt(w.balance_minor);
    wsMicroSum += BigInt(w.balance_micro);
    if (BigInt(w.balance_minor) * 10000n !== BigInt(w.balance_micro)) mismatches++;
  }

  const allTx = await prisma.walletTransaction.findMany();
  for (const t of allTx) {
    txMinorSum += BigInt(t.amount_minor);
    txMicroSum += BigInt(t.amount_micro);
    if (BigInt(t.amount_minor) * 10000n !== BigInt(t.amount_micro)) mismatches++;
  }

  console.log('--- MIGRATION VERIFICATION ---');
  console.log('Workspace Count:', wsCount);
  console.log('Wallet Transaction Count:', txCount);
  
  console.log('Workspace Old Total (Cents):', wsMinorSum.toString());
  console.log('Workspace New Total (Micro):', wsMicroSum.toString());
  
  console.log('Transaction Old Total (Cents):', txMinorSum.toString());
  console.log('Transaction New Total (Micro):', txMicroSum.toString());
  console.log('Mismatches:', mismatches);
}

run().catch(console.error).finally(() => prisma.$disconnect());
