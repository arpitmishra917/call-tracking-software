const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
    const ws = await prisma.workspace.findUnique({ where: { id: "dbd36d8f-a818-4b5d-85be-7c6599ccc60d" } });
    console.log("Workspace dbd36d8f... :", ws);
    const members = await prisma.workspaceMember.findMany({ where: { workspace_id: "dbd36d8f-a818-4b5d-85be-7c6599ccc60d" } });
    console.log("Members of dbd36d8f... :", members);
    if (members.length > 0) {
       for (const m of members) {
           const profile = await prisma.profile.findUnique({ where: { id: m.user_id } });
           console.log("Profile for user", m.user_id, ":", profile);
       }
    }
}
main().catch(console.error).finally(() => prisma.$disconnect());
