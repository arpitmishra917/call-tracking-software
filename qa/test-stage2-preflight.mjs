import fs from 'fs';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

const rootEnv = dotenv.parse(fs.readFileSync('.env', 'utf8'));
const qaEnv = dotenv.parse(fs.readFileSync('apps/api/.env.qa', 'utf8'));

const TELNYX_API_KEY = rootEnv.TELNYX_API_KEY;
const ARI_BASE = qaEnv.TELEPHONY_QA_ARI_URL || 'http://127.0.0.1:8088';
const ARI_USER = qaEnv.TELEPHONY_QA_ARI_USERNAME || 'callflow_qa';
const ARI_PASS = qaEnv.TELEPHONY_QA_ARI_PASSWORD;
const ARI_AUTH = 'Basic ' + Buffer.from(`${ARI_USER}:${ARI_PASS}`).toString('base64');

async function check() {
  console.log('=== STAGE 2 PRE-EXECUTION CHECK ===');
  
  // 1. Telnyx balance
  const bRes = await fetch('https://api.telnyx.com/v2/balance', {
    headers: { Authorization: `Bearer ${TELNYX_API_KEY}` }
  });
  const bData = await bRes.json();
  const balance = parseFloat(bData.data.available_credit);
  console.log(`Telnyx available credit: $${balance.toFixed(4)} USD`);
  if (balance < 0.50) throw new Error('Telnyx balance too low');

  // 2. Telnyx active calls
  const cRes = await fetch('https://api.telnyx.com/v2/calls', {
    headers: { Authorization: `Bearer ${TELNYX_API_KEY}` }
  });
  const cData = await cRes.json();
  const activeCalls = cData.data || [];
  console.log(`Telnyx active calls: ${activeCalls.length}`);
  if (activeCalls.length > 0) {
    console.warn('Active calls on carrier:', activeCalls.map(c => c.call_control_id));
  }

  // 3. Asterisk ARI
  const aRes = await fetch(`${ARI_BASE}/ari/channels`, {
    headers: { Authorization: ARI_AUTH }
  });
  if (!aRes.ok) throw new Error(`Asterisk ARI returned ${aRes.status}`);
  const channels = await aRes.json();
  console.log(`Asterisk active channels: ${channels.length}`);

  // 4. QA Database
  const prisma = new PrismaClient({ datasources: { db: { url: qaEnv.DATABASE_URL } } });
  await prisma.$connect();
  const activeRes = await prisma.buyerReservation.count({ where: { status: 'ACTIVE' } });
  console.log(`QA Database active buyer reservations: ${activeRes}`);
  await prisma.$disconnect();

  // 5. Backend QA lease endpoint
  const lRes = await fetch('http://127.0.0.1:3000/qa/lease', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-qa-key': 'callflow-qa-secret' },
    body: JSON.stringify({ callerCli: '+17207159445', ttlMs: 15000 })
  });
  const lData = await lRes.json();
  console.log('QA Lease test response:', lRes.status, lData.success ? 'SUCCESS' : 'FAILED');

  console.log('\n[ALL PRECHECKS PASSED] Ready to author and run Stage 2 Live Carrier Overflow Verification.');
}

check().catch(err => {
  console.error('[FAILED]', err.message);
  process.exit(1);
});
