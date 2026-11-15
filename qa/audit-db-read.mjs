import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://callflow_qa_user:cfqa_pg_83538438661833bab5b5741ec8b903593e00a675@127.0.0.1:5433/callflow_qa?schema=public'
    }
  }
});

async function inspectDb() {
  console.log('=== QA POSTGRESQL READ-ONLY INSPECTION ===\n');
  try {
    const workspaces = await prisma.workspace.count();
    const campaigns = await prisma.campaign.count();
    const buyers = await prisma.buyer.count();
    const destinationNumbers = await prisma.destinationNumber.count();
    const calls = await prisma.call.count();
    const callAttempts = await prisma.callAttempt.count();
    const buyerReservations = await prisma.buyerReservation.count();
    const phoneNumbers = await prisma.phoneNumber.count();
    
    console.log('Database Connection: SUCCESSFUL (Read-only query)');
    console.log(`- Workspaces: ${workspaces}`);
    console.log(`- Campaigns: ${campaigns}`);
    console.log(`- Buyers: ${buyers}`);
    console.log(`- Destination Numbers: ${destinationNumbers}`);
    console.log(`- Phone Numbers: ${phoneNumbers}`);
    console.log(`- Calls: ${calls}`);
    console.log(`- Call Attempts: ${callAttempts}`);
    console.log(`- Buyer Reservations: ${buyerReservations}`);
    
    // Inspect QA workspace details
    const qaWs = await prisma.workspace.findFirst({
      where: { id: '5e20bafe-7306-4da7-9944-62c4c5575a5a' },
      include: {
        campaigns: true,
        buyers: true,
        destination_numbers: true,
        phone_numbers: true
      }
    });
    if (qaWs) {
      console.log(`\nQA Dedicated Workspace (${qaWs.id}):`);
      console.log(`  Name: ${qaWs.name}`);
      console.log(`  Campaigns count: ${qaWs.campaigns.length}`);
      console.log(`  Buyers count: ${qaWs.buyers.length}`);
      console.log(`  Destination numbers count: ${qaWs.destination_numbers.length}`);
      console.log(`  Phone numbers count: ${qaWs.phone_numbers.length}`);
    }
  } catch (err) {
    console.error('Database connection failed:', err.message);
  } finally {
    await prisma.$disconnect();
  }
}

inspectDb();
