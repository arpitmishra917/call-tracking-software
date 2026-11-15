import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

const rootEnv = dotenv.parse(fs.readFileSync('.env', 'utf8'));
const qaEnv = dotenv.parse(fs.readFileSync('apps/api/.env.qa', 'utf8'));
const apiKey = rootEnv.TELNYX_API_KEY;

async function getTelnyxBalance() {
  const res = await fetch('https://api.telnyx.com/v2/balance', {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const data = await res.json();
  return parseFloat(data.data.available_credit);
}

async function getAsteriskChannels() {
  const ariUser = qaEnv.TELEPHONY_QA_ARI_USERNAME || 'callflow_qa';
  const ariPass = qaEnv.TELEPHONY_QA_ARI_PASSWORD || '';
  const auth = Buffer.from(`${ariUser}:${ariPass}`).toString('base64');
  try {
    const res = await fetch('http://127.0.0.1:8088/ari/channels', {
      headers: { Authorization: `Basic ${auth}` },
    });
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

async function getDbMetrics(prisma) {
  const wsId = '5e20bafe-7306-4da7-9944-62c4c5575a5a';
  const balance = await prisma.workspaceBalance.findUnique({
    where: { workspace_id: wsId },
  });
  const txCount = await prisma.walletTransaction.count({
    where: { workspace_id: wsId },
  });
  const resCount = await prisma.callReservation.count();
  const callsCount = await prisma.call.count({
    where: { workspace_id: wsId },
  });
  return {
    balance_micro: balance ? balance.balance_micro.toString() : '0',
    reserved_micro: balance ? balance.reserved_micro.toString() : '0',
    walletTransactions: txCount,
    callReservations: resCount,
    calls: callsCount,
  };
}

async function run() {
  console.log('=== [Phase 7B-10S] SINGLE CONTROLLED LIVE END-TO-END VERIFICATION CALL ===');
  const startedAt = new Date().toISOString();
  console.log(`Execution started at: ${startedAt}`);

  // 1. Pre-call balance & cost cap validation
  const preBalance = await getTelnyxBalance();
  console.log(`Pre-call Telnyx Available Credit: $${preBalance.toFixed(4)} USD`);
  if (preBalance < 0.50) {
    throw new Error(`Insufficient Telnyx balance ($${preBalance.toFixed(4)}). Requires >= $0.50.`);
  }

  // 2. Pre-call DB metrics
  const prisma = new PrismaClient({
    datasources: { db: { url: qaEnv.DATABASE_URL } },
  });
  await prisma.$connect();
  const preDb = await getDbMetrics(prisma);
  console.log('Pre-call QA DB Metrics:', JSON.stringify(preDb));

  // 3. Pre-call Asterisk channels
  const preChannels = await getAsteriskChannels();
  console.log(`Pre-call Asterisk active channels: ${preChannels.length}`);
  if (preChannels.length > 0) {
    console.warn('Warning: Active Asterisk channels found before call:', preChannels.map(c => c.id));
  }

  // 4. Trigger the ONE test run via HTTP POST to QA Backend
  console.log('\n[...] Triggering single controlled QA test run on http://127.0.0.1:3000/qa/test-run...');
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    console.error('[CRITICAL TIMEOUT] Client safety deadline reached (32s). Aborting request.');
    controller.abort();
  }, 32000);

  const t0 = Date.now();
  let runResult;
  try {
    const res = await fetch('http://127.0.0.1:3000/qa/test-run', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-qa-key': 'callflow-qa-secret',
      },
      body: JSON.stringify({
        trackingDid: '+17252574041',
        minDurationSecs: 2.0,
        preserveRecordings: true,
        maxDurationMs: 30000,
        postPlaybackCaptureMs: 7000,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`QA backend responded with HTTP ${res.status}: ${errText}`);
    }

    runResult = await res.json();
  } catch (callErr) {
    clearTimeout(timeoutId);
    console.error('[FAILED] Test run encountered error:', callErr.message);
    runResult = { success: false, error: callErr.message };
  }
  const callDurationMs = Date.now() - t0;
  console.log(`\nTest Run finished in ${callDurationMs}ms (${(callDurationMs / 1000).toFixed(2)}s)`);

  // 5. Post-call Telnyx balance
  // Wait 3 seconds for Telnyx billing sync
  await new Promise(r => setTimeout(r, 3000));
  const postBalance = await getTelnyxBalance();
  const providerSpend = Math.max(0, preBalance - postBalance);
  console.log(`Post-call Telnyx Available Credit: $${postBalance.toFixed(4)} USD`);
  console.log(`Actual Provider Spend: $${providerSpend.toFixed(4)} USD (Cost limit: $1.00 USD)`);

  // 6. Post-call DB metrics
  const postDb = await getDbMetrics(prisma);
  console.log('Post-call QA DB Metrics:', JSON.stringify(postDb));
  await prisma.$disconnect();

  // 7. Post-call Asterisk channels
  const postChannels = await getAsteriskChannels();
  console.log(`Post-call Asterisk active channels: ${postChannels.length}`);

  // 8. Compile complete forensic evidence
  const endedAt = new Date().toISOString();
  const recDir = path.resolve('qa/recordings');
  if (!fs.existsSync(recDir)) fs.mkdirSync(recDir, { recursive: true });
  if (runResult.callerAudioBase64 && runResult.runId) {
    const fPath = path.join(recDir, `qa-caller-${runResult.runId}.wav`);
    fs.writeFileSync(fPath, Buffer.from(runResult.callerAudioBase64, 'base64'));
    console.log(`Saved caller recording to: ${fPath}`);
  }
  if (runResult.buyerAudioBase64 && runResult.runId) {
    const fPath = path.join(recDir, `qa-buyer-${runResult.runId}.wav`);
    fs.writeFileSync(fPath, Buffer.from(runResult.buyerAudioBase64, 'base64'));
    console.log(`Saved buyer recording to: ${fPath}`);
  }

  const summary = {
    testType: 'Phase 7B-10S Single Controlled Live Carrier Native ARI Recording Verification',
    startedAt,
    endedAt,
    callDurationSeconds: parseFloat((callDurationMs / 1000).toFixed(2)),
    carrierCallPlaced: Boolean(runResult.context?.asteriskChannelId),
    preCallTelnyxBalance: preBalance,
    postCallTelnyxBalance: postBalance,
    providerSpendUsd: parseFloat(providerSpend.toFixed(4)),
    spendUnderLimit: providerSpend <= 1.00,
    runResult,
    preDbMetrics: preDb,
    postDbMetrics: postDb,
    financialIsolationPassed: (
      postDb.walletTransactions === preDb.walletTransactions &&
      postDb.balance_micro === preDb.balance_micro &&
      postDb.reserved_micro === '0'
    ),
    lingeringChannels: postChannels.map(c => c.id),
  };

  fs.writeFileSync('qa/qa-single-call-result.json', JSON.stringify(summary, null, 2));
  console.log('\n=== COMPLETE FORENSIC SUMMARY ===');
  console.log(JSON.stringify(summary, null, 2));
}

run().catch(err => {
  console.error('[FATAL] Script error:', err);
  process.exit(1);
});
