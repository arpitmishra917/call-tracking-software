import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function run() {
  const allActive = await prisma.callReservation.findMany({
    where: { status: 'ACTIVE' },
    include: { call: true }
  });

  const workspaceActive = allActive.filter(r => r.workspace_id === '5c3d8331-04a6-4264-888f-d0ebf57e3c7d');
  
  console.log(`Total ACTIVE reservations: ${allActive.length}`);
  console.log(`Workspace 5c3d8331-04a6-4264-888f-d0ebf57e3c7d ACTIVE: ${workspaceActive.length}`);
  
  const testFixtures = allActive.filter(r => 
    r.call_id.includes('test') || 
    r.call_id.includes('mock') || 
    (r.call && r.call.provider_call_id && r.call.provider_call_id.includes('test'))
  );
  console.log(`Potential test fixtures (by ID matching): ${testFixtures.length}`);

  console.log("\nSample 10 items:");
  allActive.slice(0, 10).forEach(r => {
    console.log(`Reservation ID: ${r.id}, Call ID: ${r.call_id}, Call State: ${r.call?.status}, Provider Call ID: ${r.call?.provider_call_id}`);
  });
  
  await prisma.$disconnect();
}
run();
