import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const workspaces = await prisma.workspace.findMany();
  console.log(`Total workspaces in DB: ${workspaces.length}`);
}

main().then(() => prisma.$disconnect()).catch(console.error);
