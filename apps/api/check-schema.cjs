const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  // Check column schema
  const columns = await prisma.$queryRawUnsafe(`
    SELECT column_name, data_type, is_nullable 
    FROM information_schema.columns 
    WHERE table_name = 'phone_numbers' AND column_name = 'number_type'
  `);
  console.log('--- Column Schema ---');
  console.log(columns);

  // Check _prisma_migrations table
  const migrations = await prisma.$queryRawUnsafe(`
    SELECT migration_name, finished_at, applied_steps_count 
    FROM _prisma_migrations 
    WHERE migration_name LIKE '%add_number_type%'
  `);
  console.log('--- Migration Record ---');
  console.log(migrations);

  // Verify Phone Numbers
  const pnums = await prisma.phoneNumber.findMany({
    where: { 
      phone_number: { in: ['+13215033884', '+17658268661', '+14845560110', '+18668300066'] }
    },
    select: { phone_number: true, number_type: true }
  });
  console.log('--- Imported Numbers ---');
  console.log(pnums);
}

run().finally(() => prisma.$disconnect());
