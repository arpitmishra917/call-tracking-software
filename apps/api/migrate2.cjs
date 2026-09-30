const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
async function run() {
  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE "calls" ADD COLUMN "started_at" TIMESTAMP(3);`);
  } catch (e) { console.error(e.message); }
  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE "calls" ADD COLUMN "answered_at" TIMESTAMP(3);`);
  } catch (e) { console.error(e.message); }
  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE "calls" ADD COLUMN "ended_at" TIMESTAMP(3);`);
  } catch (e) { console.error(e.message); }
  console.log("Done");
  await prisma.$disconnect();
}
run();
