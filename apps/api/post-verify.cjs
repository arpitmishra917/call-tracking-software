const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  const wsId = '0d63db1a-fc8e-41da-912d-bd24d3edb75e';
  const pnums = await prisma.phoneNumber.findMany({ where: { workspace_id: wsId } });
  console.log('PhoneNumbers:', pnums);
  
  const others = await prisma.phoneNumber.findMany({ where: { workspace_id: { not: wsId } } });
  console.log('Other Workspace PhoneNumbers count:', others.length);
}

run().finally(() => prisma.$disconnect());
