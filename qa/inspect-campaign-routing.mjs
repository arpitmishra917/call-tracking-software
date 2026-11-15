import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import fs from 'fs';

const qaEnv = dotenv.parse(fs.readFileSync('apps/api/.env.qa', 'utf8'));
const prisma = new PrismaClient({
  datasources: { db: { url: qaEnv.DATABASE_URL } }
});

async function main() {
  console.log('=== INSPECTING QA DATABASE CAMPAIGN & BUYER ROUTING SETUP ===\n');

  const campaign = await prisma.campaign.findUnique({
    where: { id: qaEnv.QA_CAMPAIGN_ID },
    include: {
      buyers: {
        include: {
          buyer: {
            include: {
              destination_numbers: true,
              buyer_reservations: true,
            }
          }
        },
        orderBy: { priority: 'asc' }
      }
    }
  });

  if (!campaign) {
    console.error('Campaign not found:', qaEnv.QA_CAMPAIGN_ID);
    return;
  }

  console.log(`Campaign: "${campaign.name}" (${campaign.id})`);
  console.log(`Status: ${campaign.status}`);
  console.log(`Attached Buyers (${campaign.buyers.length}):`);

  for (const cb of campaign.buyers) {
    const b = cb.buyer;
    console.log(`\n  Buyer Priority ${cb.priority}:`);
    console.log(`    Name: "${b.name}" | ID: ${b.id}`);
    console.log(`    Status: ${b.status} | Destination Number: ${b.destination_number}`);
    console.log(`    Max Concurrent Calls: ${b.max_concurrent_calls} | Timeout: ${b.timeout}`);
    console.log(`    Active Reservations Count: ${b.buyer_reservations.length}`);
    for (const r of b.buyer_reservations) {
      console.log(`      Reservation: ID ${r.id} | Call ID ${r.call_id} | Status: ${r.status} | Expires At: ${r.expires_at}`);
    }
    for (const d of b.destination_numbers) {
      console.log(`    Destination Number Record: ${d.destination_number} (Status: ${d.status}, Priority: ${d.priority})`);
    }
  }

  await prisma.$disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
