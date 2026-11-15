const { PrismaClient } = require('@prisma/client');
async function main() {
  const datasourceUrl = process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/postgres?schema=public';
  const prisma = new PrismaClient({ datasourceUrl });
  
  try {
    const workspaces = await prisma.workspace.findMany();
    console.log('\nWorkspaces in postgres db:');
    console.table(workspaces.map(w => ({ id: w.id, name: w.name, status: w.status })));
    
    const phones = await prisma.phoneNumber.findMany();
    console.log('\nPhoneNumbers in postgres db:');
    console.table(phones.map(p => ({ id: p.id, workspace_id: p.workspace_id, phone_number: p.phone_number })));
  } catch (e) {
    console.error('Error querying postgres DB:', e.message);
  } finally {
    await prisma.$disconnect();
  }
}
main();
