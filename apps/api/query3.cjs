const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
    try {
        const users = await prisma.$queryRawUnsafe(`SELECT id, email FROM auth.users WHERE id IN ('18c60dd7-fca4-4d10-80bf-a1eeb3ee9dfa', 'f5ee4e43-0d36-4c8c-a25c-c3617b2ed81c')`);
        console.log("AUTH USERS:", users);
    } catch(e) {
        console.error("Error querying auth.users", e);
    }
}
main().catch(console.error).finally(() => prisma.$disconnect());
