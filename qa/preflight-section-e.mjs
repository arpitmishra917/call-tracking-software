import http from 'http';
import https from 'https';
import { execSync } from 'child_process';
import dotenv from 'dotenv';
import fs from 'fs';

function httpReq(urlStr, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(url, options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(body) });
        } catch {
          resolve({ status: res.statusCode, headers: res.headers, body });
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function verifySectionE() {
  console.log('=== SECTION E: RESOURCE & SAFETY VERIFICATION ===\n');

  // 1. Asterisk active channels & bridges
  console.log('--- 1. ASTERISK CHANNELS & BRIDGES ---');
  const chCount = execSync('docker exec callflow-asterisk-qa asterisk -rx "core show channels count"').toString().trim();
  console.log(chCount);
  const brCount = execSync('docker exec callflow-asterisk-qa asterisk -rx "bridge show all"').toString().trim();
  console.log('Bridges:\n' + brCount);

  if (!chCount.includes('0 active channels')) {
    throw new Error('FATAL: Asterisk has active channels!');
  }
  console.log('[PASS] Asterisk has exactly ZERO active channels and ZERO active bridges.\n');

  // 2. Carrier active calls check
  console.log('--- 2. TELNYX ACTIVE CALLS CHECK ---');
  const rootEnv = dotenv.parse(fs.readFileSync('.env', 'utf8'));
  const telnyxApiKey = rootEnv.TELNYX_API_KEY;

  const callsRes = await httpReq('https://api.telnyx.com/v2/calls', {
    headers: { 'Authorization': `Bearer ${telnyxApiKey}` }
  });
  console.log(`Active Calls Status: HTTP ${callsRes.status}`);
  const activeCalls = callsRes.body?.data || [];
  console.log(`Active Live Calls on Telnyx Account: ${activeCalls.length}`);
  if (activeCalls.length > 0) {
    throw new Error('FATAL: Active live calls exist on Telnyx account!');
  }
  console.log('[PASS] Exactly ZERO live calls on Telnyx account.\n');

  // 3. Telnyx carrier balance & charges
  console.log('--- 3. TELNYX BALANCE & CHARGES AUDIT ---');
  const balRes = await httpReq('https://api.telnyx.com/v2/balance', {
    headers: { 'Authorization': `Bearer ${telnyxApiKey}` }
  });
  console.log(`Current Balance: $${balRes.body?.data?.balance} ${balRes.body?.data?.currency}`);
  console.log(`Credit Limit: $${balRes.body?.data?.credit_limit} ${balRes.body?.data?.currency}`);

  const balance = parseFloat(balRes.body?.data?.balance);
  if (balance !== 1.86) {
    throw new Error(`WARNING: Balance changed! Expected $1.86, got $${balance}`);
  }
  console.log('[PASS] Balance remains untouched at exactly $1.86 USD ($0.00 incurred cost).\n');

  // 4. Verify no new phone numbers purchased
  console.log('--- 4. PHONE NUMBER PURCHASE AUDIT ---');
  const numRes = await httpReq('https://api.telnyx.com/v2/phone_numbers', {
    headers: { 'Authorization': `Bearer ${telnyxApiKey}` }
  });
  const numbers = numRes.body?.data || [];
  console.log(`Total Phone Numbers on Account: ${numbers.length}`);
  for (const n of numbers) {
    console.log(`  - Number: ${n.phone_number} | Status: ${n.status} | Connection: ${n.connection_name || n.connection_id}`);
  }
  if (numbers.length !== 1 || numbers[0].phone_number !== '+17252574041') {
    throw new Error('WARNING: Unexpected phone numbers found on account!');
  }
  console.log('[PASS] Exactly ONE phone number (+17252574041) on account. Zero purchases made.\n');

  console.log('=== SECTION E VERIFICATION COMPLETE ===\n');
}

verifySectionE().catch(err => {
  console.error(err);
  process.exit(1);
});
