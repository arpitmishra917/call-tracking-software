import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const workspaces = await prisma.workspace.findMany({ include: { members: true }});
  console.log(JSON.stringify(workspaces, null, 2));
}

main().then(() => prisma.$disconnect()).catch(console.error);
