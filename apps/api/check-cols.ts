import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
prisma.$queryRawUnsafe(`SELECT column_name FROM information_schema.columns WHERE table_name = 'workspace_member_permissions'`)
  .then(console.log)
  .catch(console.error)
  .finally(() => prisma.$disconnect());
