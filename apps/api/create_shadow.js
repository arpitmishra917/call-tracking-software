import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: "postgresql://postgres:%2A222%2A2%23Arpit@localhost:5432/postgres"
    }
  }
});

async function run() {
  await prisma.$executeRawUnsafe('DROP DATABASE IF EXISTS shadow_db');
  await prisma.$executeRawUnsafe('CREATE DATABASE shadow_db');
  console.log('Shadow DB created');
}

run().catch(console.error).finally(()=>prisma.$disconnect());
