import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function audit() {
  const allNumbers = await prisma.phoneNumber.findMany();
  console.log('--- ALL PHONE NUMBERS ---');
  console.log(allNumbers);

  const workspaces = await prisma.workspace.findMany();
  console.log('--- WORKSPACES ---');
  console.log(workspaces);

  const members = await prisma.workspaceMember.findMany({
    include: { profile: true }
  });
  console.log('--- WORKSPACE MEMBERS ---');
  console.log(members);
}

audit().catch(console.error).finally(() => prisma.$disconnect());
