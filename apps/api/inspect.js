import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function run() {
  console.log('--- TABLES ---');
  const tables = await prisma.$queryRaw`SELECT table_name FROM information_schema.tables WHERE table_schema='public'`;
  console.log(JSON.stringify(tables, null, 2));

  console.log('--- ENUMS ---');
  const enums = await prisma.$queryRaw`SELECT typname FROM pg_type WHERE typtype = 'e'`;
  console.log(JSON.stringify(enums, null, 2));

  console.log('--- INDEXES & CONSTRAINTS ON UsageRecord ---');
  const usageIndexes = await prisma.$queryRaw`
    SELECT
        t.relname as table_name,
        i.relname as index_name,
        a.attname as column_name,
        ix.indisunique as is_unique
    FROM
        pg_class t,
        pg_class i,
        pg_index ix,
        pg_attribute a
    WHERE
        t.oid = ix.indrelid
        and i.oid = ix.indexrelid
        and a.attrelid = t.oid
        and a.attnum = ANY(ix.indkey)
        and t.relkind = 'r'
        and t.relname = 'usage_records'
  `;
  console.log(JSON.stringify(usageIndexes, null, 2));

  const migrations = await prisma.$queryRaw`SELECT * FROM _prisma_migrations`;
  console.log('--- MIGRATIONS ---');
  console.log(JSON.stringify(migrations, null, 2));
}

run().catch(console.error).finally(()=>prisma.$disconnect());
