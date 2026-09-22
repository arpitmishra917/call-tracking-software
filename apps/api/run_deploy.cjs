const { execSync } = require('child_process');
const { PrismaClient } = require('@prisma/client');
const url = 'postgresql://postgres:%2A222%2A2%23Arpit@localhost:5432/shadow_db?schema=public';

async function run() {
  const prisma = new PrismaClient({
    datasources: {
      db: { url: "postgresql://postgres:%2A222%2A2%23Arpit@localhost:5432/postgres" }
    }
  });
  await prisma.$executeRawUnsafe('DROP DATABASE IF EXISTS shadow_db');
  await prisma.$executeRawUnsafe('CREATE DATABASE shadow_db');
  await prisma.$disconnect();
  console.log('Shadow DB recreated');

  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'inherit',
    cwd: __dirname
  });
  console.log('Deployed successfully');
}
run().catch(console.error);
