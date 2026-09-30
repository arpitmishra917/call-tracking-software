const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const wsId = '0d63db1a-fc8e-41da-912d-bd24d3edb75e';
  const pnums = await prisma.$queryRawUnsafe(`SELECT * FROM phone_numbers WHERE workspace_id = $1`, wsId);
  console.log('PhoneNumbers in workspace:', pnums);
}

main().catch(console.error).finally(() => prisma.$disconnect());
