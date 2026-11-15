import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

const rootEnv = dotenv.parse(fs.readFileSync('.env', 'utf8'));
const qaEnv = dotenv.parse(fs.readFileSync('apps/api/.env.qa', 'utf8'));

const apiKey = rootEnv.TELNYX_API_KEY;
if (!apiKey) {
  console.error('TELNYX_API_KEY not found in .env');
  process.exit(1);
}

async function run() {
  console.log('=== Step 1: Telnyx Account & App Verification ===');
  // 1. Balance
  const balRes = await fetch('https://api.telnyx.com/v2/balance', {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const balData = await balRes.json();
  console.log('Telnyx Balance Response:', JSON.stringify(balData.data));

  // 2. Call Control Applications
  const appsRes = await fetch('https://api.telnyx.com/v2/call_control_applications', {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const appsData = await appsRes.json();
  const qaApp = appsData.data?.find(a => a.application_name === 'CallFlow Autonomous QA' || a.id === '3090207513618941231');
  console.log('QA Call Control App:', JSON.stringify(qaApp ? {
    id: qaApp.id,
    name: qaApp.application_name,
    webhook_event_url: qaApp.webhook_event_url,
    webhook_api_version: qaApp.webhook_api_version,
    active: qaApp.active,
  } : null));

  // 3. Phone Numbers
  const numRes = await fetch('https://api.telnyx.com/v2/phone_numbers?filter[phone_number]=%2B17252574041', {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const numData = await numRes.json();
  const qaNum = numData.data?.[0];
  console.log('QA DID Details:', JSON.stringify(qaNum ? {
    id: qaNum.id,
    phone_number: qaNum.phone_number,
    connection_id: qaNum.connection_id,
    connection_name: qaNum.connection_name,
    status: qaNum.status,
  } : null));

  console.log('\n=== Step 2: QA Database State Verification (127.0.0.1:5433) ===');
  const prisma = new PrismaClient({
    datasources: { db: { url: qaEnv.DATABASE_URL } },
  });

  await prisma.$connect();
  const ws = await prisma.workspace.findUnique({
    where: { id: '5e20bafe-7306-4da7-9944-62c4c5575a5a' },
  });
  console.log('QA Workspace:', ws ? { id: ws.id, name: ws.name, slug: ws.slug } : 'NOT FOUND');

  const cmp = await prisma.campaign.findUnique({
    where: { id: '6af31407-3f46-4f1d-90d0-bf08af2e9600' },
  });
  console.log('QA Campaign:', cmp ? { id: cmp.id, name: cmp.name, status: cmp.status } : 'NOT FOUND');

  const buyer = await prisma.buyer.findUnique({
    where: { id: '7deb4e0a-8674-4b4b-a170-0aff3991f69c' },
  });
  console.log('QA Buyer:', JSON.stringify(buyer));

  const did = await prisma.phoneNumber.findFirst({
    where: { phone_number: '+17252574041' },
  });
  console.log('QA PhoneNumber DID:', did ? { id: did.id, phone_number: did.phone_number, campaign_id: did.campaign_id } : 'NOT FOUND');

  const bal = await prisma.workspaceBalance.findUnique({
    where: { workspace_id: '5e20bafe-7306-4da7-9944-62c4c5575a5a' },
  });
  console.log('QA WorkspaceBalance:', bal ? {
    balance_micro: bal.balance_micro?.toString(),
    reserved_micro: bal.reserved_micro?.toString(),
  } : 'NOT FOUND');

  const txCount = await prisma.walletTransaction.count({
    where: { workspace_id: '5e20bafe-7306-4da7-9944-62c4c5575a5a' },
  });
  console.log('QA WalletTransaction count:', txCount);

  const resCount = await prisma.callReservation.count();
  console.log('QA CallReservation count:', resCount);

  const callsCount = await prisma.call.count();
  console.log('QA Call record count:', callsCount);

  const routerConfig = await prisma.campaignBuyer.findMany({
    where: { campaign_id: '6af31407-3f46-4f1d-90d0-bf08af2e9600' },
  });
  console.log('QA Campaign Buyers:', JSON.stringify(routerConfig));

  await prisma.$disconnect();
}

run().catch(err => {
  console.error('Precheck error:', err);
  process.exit(1);
});
