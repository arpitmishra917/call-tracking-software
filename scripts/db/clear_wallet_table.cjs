const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  await prisma.$executeRawUnsafe(`DELETE FROM wallet_transactions`);
}
main().catch(console.error).finally(() => prisma.$disconnect());
