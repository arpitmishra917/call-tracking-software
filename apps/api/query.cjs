const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const member = await prisma.workspaceMember.findFirst({ where: { workspace_id: "772c13a6-1d75-424c-9363-2f226d5b73b7" } });
    if (!member) {
      console.log('No member found');
      return;
    }
    const memberships = await prisma.workspaceMember.findMany({ where: { user_id: member.user_id }, include: { workspace: true } });
    console.log(JSON.stringify(memberships, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
