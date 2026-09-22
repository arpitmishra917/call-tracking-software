import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const profile = await prisma.profile.findFirst({
    where: { id: "f27ab2b3-6006-4f22-aa02-4cb5271ada12" } // The ID from earlier JWT
  });
  console.log("Profile found:", profile);
}

main().then(() => prisma.$disconnect()).catch(console.error);
