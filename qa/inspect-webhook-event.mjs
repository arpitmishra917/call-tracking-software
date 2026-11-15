import fs from 'fs';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

const qaEnv = dotenv.parse(fs.readFileSync('apps/api/.env.qa', 'utf8'));
const prisma = new PrismaClient({ datasources: { db: { url: qaEnv.DATABASE_URL } } });

async function run() {
  const evt = await prisma.webhookEvent.findUnique({
    where: {
      provider_providerEventId: {
        provider: 'telnyx',
        providerEventId: '4a5072e7-68bb-48be-9617-952d5d799983'
      }
    }
  });
  console.log(JSON.stringify(evt.payload, null, 2));
  await prisma.$disconnect();
}

run().catch(console.error);
