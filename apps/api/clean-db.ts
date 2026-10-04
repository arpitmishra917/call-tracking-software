import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
async function main() {
  await prisma.$executeRawUnsafe('ALTER TABLE workspace_member_permissions DROP COLUMN IF EXISTS scope_type');
  await prisma.$executeRawUnsafe('ALTER TABLE workspace_member_permissions DROP COLUMN IF EXISTS resource_id');
  await prisma.$executeRawUnsafe('DROP TYPE IF EXISTS "ResourceScopeType"');
  console.log('Cleaned');
}
main().catch(console.error).finally(() => prisma.$disconnect());
