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
    where: {
      createdAt: {
        gte: new Date('2026-11-16T00:00:00Z'),
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`Found ${events.length} events on Nov 16 after 00:00 UTC.`);
  for (const e of events) {
    const p = e.payload;
    const eventType = p?.data?.event_type || p?.event_type;
    const occurredAt = p?.data?.occurred_at || e.createdAt.toISOString();
    const callControlId = p?.data?.payload?.call_control_id;
    const mediaUrl = p?.data?.payload?.media_url;
    const status = p?.data?.payload?.status;
    const error = p?.data?.payload?.telnyx_error;
    console.log(`[${occurredAt}] Type: ${eventType} | CallControl: ${callControlId} | Media: ${mediaUrl} | Status: ${status} | Error: ${JSON.stringify(error)}`);
    if (eventType?.includes('playback')) {
      console.log(`  Full Playback Payload:`, JSON.stringify(p, null, 2));
    }
  }

  await prisma.$disconnect();
}

main().catch(console.error);
