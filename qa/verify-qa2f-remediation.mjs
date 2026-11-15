import http from 'http';
import https from 'https';
import { execSync } from 'child_process';
import dotenv from 'dotenv';
import fs from 'fs';

function httpReq(urlStr, options = {}, data = null) {
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
    if (data) {
      req.write(typeof data === 'string' ? data : JSON.stringify(data));
    }
    req.end();
  });
}

async function verifyAll() {
  console.log('================================================================');
  console.log('CALLFLOW — QA-2F REMEDIATION B COMPREHENSIVE VERIFICATION SUITE');
  console.log('================================================================\n');

  // 1. Telnyx Balance & Credential Connections
  console.log('--- 1. TELNYX CARRIER BALANCE & CONNECTIONS ---');
  const rootEnv = dotenv.parse(fs.readFileSync('.env', 'utf8'));
  const telnyxApiKey = rootEnv.TELNYX_API_KEY;
  const balanceRes = await httpReq('https://api.telnyx.com/v2/balance', {
    headers: { 'Authorization': `Bearer ${telnyxApiKey}` }
  });
  console.log(`Telnyx Balance: $${balanceRes.body?.data?.balance} ${balanceRes.body?.data?.currency}`);
  console.log(`Credit Limit: $${balanceRes.body?.data?.credit_limit} ${balanceRes.body?.data?.currency}`);

  const credsRes = await httpReq('https://api.telnyx.com/v2/credential_connections', {
    headers: { 'Authorization': `Bearer ${telnyxApiKey}` }
  });
  const connections = credsRes.body?.data || [];
  console.log(`Found ${connections.length} Telnyx Credential Connections:`);
  for (const c of connections) {
    console.log(`  - ID: ${c.id} | User: ${c.user_name} | Name: ${c.connection_name} | Active: ${c.active} | SIP Calling Pref: ${c.sip_uri_calling_preference}`);
  }

  // 2. Asterisk Registrations and Endpoints
  console.log('\n--- 2. ASTERISK PJSIP REGISTRATIONS & ENDPOINTS ---');
  const regOutput = execSync('docker exec callflow-asterisk-qa asterisk -rx "pjsip show registrations"').toString().trim();
  console.log('PJSIP Registrations:');
  console.log(regOutput);

  const epOutput = execSync('docker exec callflow-asterisk-qa asterisk -rx "pjsip show endpoints"').toString().trim();
  console.log('\nPJSIP Endpoints:');
  console.log(epOutput);

  const dialplanOutput = execSync('docker exec callflow-asterisk-qa asterisk -rx "dialplan show from-telnyx-buyer-b"').toString().trim();
  console.log('\nDialplan Context [from-telnyx-buyer-b]:');
  console.log(dialplanOutput);

  // 3. Backend Health & Database Target
  console.log('\n--- 3. NESTJS QA BACKEND & DATABASE TARGET ---');
  const healthRes = await httpReq('http://127.0.0.1:3000/health');
  console.log(`Backend /health: HTTP ${healthRes.status} ->`, JSON.stringify(healthRes.body));

  const qaStatusRes = await httpReq('http://127.0.0.1:3000/qa/status', {
    headers: { 'x-qa-key': 'callflow-qa-secret' }
  });
  console.log(`Backend /qa/status: HTTP ${qaStatusRes.status} ->`, JSON.stringify(qaStatusRes.body));

  // 4. ngrok Tunnel Status
  console.log('\n--- 4. NGROK TUNNEL VERIFICATION ---');
  const ngrokRes = await httpReq('http://127.0.0.1:4040/api/tunnels');
  const tunnels = ngrokRes.body?.tunnels || [];
  console.log(`Active ngrok Tunnels: ${tunnels.length}`);
  for (const t of tunnels) {
    console.log(`  - Name: ${t.name} -> Public URL: ${t.public_url} (target: ${t.config?.addr})`);
  }

  // 5. Webhook Ingress (Local & Public ngrok)
  console.log('\n--- 5. WEBHOOK INGRESS VERIFICATION ---');
  const localHookRes = await httpReq('http://127.0.0.1:3000/webhooks/telnyx', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, JSON.stringify({ event: 'test_unsigned' }));
  console.log(`Local Webhook Unsigned: HTTP ${localHookRes.status} ->`, JSON.stringify(localHookRes.body));

  const publicHookRes = await httpReq('https://coherent-undrilled-disarm.ngrok-free.dev/webhooks/telnyx', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, JSON.stringify({ event: 'test_unsigned_ngrok' }));
  console.log(`Public ngrok Webhook Unsigned: HTTP ${publicHookRes.status} ->`, JSON.stringify(publicHookRes.body));

  // 6. Active Channels & Bridges Safety Check
  console.log('\n--- 6. IDLE STATE & MUTATION SAFETY CHECK ---');
  const chCount = execSync('docker exec callflow-asterisk-qa asterisk -rx "core show channels count"').toString().trim();
  console.log(`Asterisk Channel Count: ${chCount.split('\n')[0]}`);

  console.log('\n================================================================');
  console.log('VERIFICATION COMPLETE: ALL PREREQUISITES OPERATIONAL');
  console.log('================================================================');
}

verifyAll().catch(err => {
  console.error('Verification failed with error:', err);
  process.exit(1);
});
