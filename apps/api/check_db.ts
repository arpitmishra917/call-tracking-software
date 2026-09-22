import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const profiles = await prisma.profile.findMany();
  const workspaces = await prisma.workspace.findMany();
  const members = await prisma.workspaceMember.findMany();
  
  console.log('DB Connection successful.');
  console.log('Profiles table exists.');
  console.log('Workspaces table exists.');
  console.log('WorkspaceMembers table exists.');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
