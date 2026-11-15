import fs from 'fs';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

const qaEnv = dotenv.parse(fs.readFileSync('apps/api/.env.qa', 'utf8'));
const prisma = new PrismaClient({ datasources: { db: { url: qaEnv.DATABASE_URL } } });

async function inspect() {
  const lastCall = await prisma.call.findFirst({
    orderBy: { created_at: 'desc' },
    include: { attempts: true }
  });
  console.log('--- LAST CALL ---');
  console.log(JSON.stringify(lastCall, null, 2));

  const attempts = await prisma.callAttempt.findMany({
    where: { call_id: lastCall.id },
    include: { buyer: true }
  });
  console.log('--- ATTEMPTS ---');
  console.log(JSON.stringify(attempts, null, 2));

  await prisma.$disconnect();
}

inspect().catch(console.error);
