const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  await prisma.$executeRawUnsafe(`UPDATE _prisma_migrations SET checksum = 'c91be2b2b9dcb1a224c78cea1e160edb7e68f943c835ec88d5cd0d5a7685fc06' WHERE migration_name = '20260928000000_crud12_hardening'`);
  await prisma.$executeRawUnsafe(`UPDATE _prisma_migrations SET checksum = '1898ca87d9d76baa426b6d000170fc759f007c2d80b397298eb149f1e7572985' WHERE migration_name = '20260930000000_unique_owner_per_user'`);
  await prisma.$executeRawUnsafe(`UPDATE _prisma_migrations SET checksum = 'cc1becad3b043b944d4bfde86abd859035683f5360eaf88c786b1f0d7800d65d' WHERE migration_name = '20260930000002_add_call_lifecycle_timestamps'`);
  console.log('Checksums updated');
}

run().catch(console.error).finally(() => prisma.$disconnect());
