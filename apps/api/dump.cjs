const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  console.log('--- Profiles ---');
  console.log(await prisma.profile.findMany());
  console.log('--- Workspaces ---');
  console.log(await prisma.workspace.findMany());
  console.log('--- WorkspaceMembers ---');
  console.log(await prisma.workspaceMember.findMany());
}
main().then(() => prisma.$disconnect());
