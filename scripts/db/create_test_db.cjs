const { PrismaClient } = require('@prisma/client');
async function main() {
  const datasourceUrl = process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/postgres?schema=public';
  const prisma = new PrismaClient({ datasourceUrl });
  
  try {
    await prisma.$executeRawUnsafe(`DROP DATABASE IF EXISTS calltracking_mvp_test;`);
    await prisma.$executeRawUnsafe(`CREATE DATABASE calltracking_mvp_test;`);
    console.log('Database calltracking_mvp_test recreated successfully.');
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await prisma.$disconnect();
  }
}
main();
