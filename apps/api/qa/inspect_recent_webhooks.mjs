import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const prisma = new PrismaClient();

async function main() {
  const events = await prisma.webhookEvent.findMany({
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: {
      id: true,
      provider: true,
      providerEventId: true,
      status: true,
      payload: true,
      createdAt: true,
    },
  });

  console.log(`Found ${events.length} recent webhook events.`);
  for (const e of events) {
    console.log(`================================================`);
    const p = e.payload;
    const eventType = p?.data?.event_type || p?.event_type || 'UNKNOWN';
    console.log(`Time: ${e.createdAt.toISOString()} | Type: ${eventType} | ID: ${e.providerEventId} | Status: ${e.status}`);
    console.log(`Payload:`, JSON.stringify(p, null, 2));
  }

  await prisma.$disconnect();
}

main().catch(console.error);
