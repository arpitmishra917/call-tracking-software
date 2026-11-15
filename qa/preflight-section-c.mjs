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

async function verifySectionC() {
  console.log('=== SECTION C: TELNYX & ASTERISK BUYER B IDENTITY VERIFICATION ===\n');

  // 1. Query Telnyx credential connections
  const rootEnv = dotenv.parse(fs.readFileSync('.env', 'utf8'));
  const telnyxApiKey = rootEnv.TELNYX_API_KEY;
  const credsRes = await httpReq('https://api.telnyx.com/v2/credential_connections', {
    headers: { 'Authorization': `Bearer ${telnyxApiKey}` }
  });

  const connections = credsRes.body?.data || [];
  console.log(`Found ${connections.length} Telnyx Credential Connections:`);
  let buyerAConn = null;
  let buyerBConn = null;

  for (const c of connections) {
    console.log(`  Connection ID: ${c.id}`);
    console.log(`    Connection Name: ${c.connection_name}`);
    console.log(`    Username: ${c.user_name}`);
    console.log(`    Active: ${c.active}`);
    console.log(`    SIP URI Calling Preference: ${c.sip_uri_calling_preference}`);
    if (c.user_name === 'arpitmishra9178') buyerAConn = c;
    if (c.user_name === 'arpitmishra9178b') buyerBConn = c;
  }

  if (!buyerAConn || !buyerBConn) {
    throw new Error('FATAL: Could not locate both Buyer A and Buyer B credential connections in Telnyx API!');
  }

  if (buyerAConn.id === buyerBConn.id) {
    throw new Error('FATAL: Buyer A and Buyer B share the same connection ID!');
  }

  console.log('\n[PASS] Buyer A and Buyer B credential connections are DISTINCT in Telnyx:');
  console.log(`  Buyer A: ID ${buyerAConn.id} (user: ${buyerAConn.user_name})`);
  console.log(`  Buyer B: ID ${buyerBConn.id} (user: ${buyerBConn.user_name})`);

  // 2. Query Asterisk PJSIP registrations
  console.log('\n--- Live Asterisk Registrations ---');
  const regOutput = execSync('docker exec callflow-asterisk-qa asterisk -rx "pjsip show registrations"').toString().trim();
  console.log(regOutput);

  if (!regOutput.includes('telnyx-buyer-reg') || !regOutput.includes('telnyx-buyer-b-reg')) {
    throw new Error('FATAL: Buyer registrations missing from Asterisk!');
  }
  if (!regOutput.match(/telnyx-buyer-reg[^\n]+Registered/) || !regOutput.match(/telnyx-buyer-b-reg[^\n]+Registered/)) {
    throw new Error('FATAL: One or more buyer registrations are NOT in Registered state!');
  }
  console.log('[PASS] Both telnyx-buyer-reg and telnyx-buyer-b-reg are in Registered state.');

  // 3. Inspect PJSIP registration configuration details
  console.log('\n--- Registration Details ---');
  const regDetailA = execSync('docker exec callflow-asterisk-qa asterisk -rx "pjsip show registration telnyx-buyer-reg"').toString().trim();
  const regDetailB = execSync('docker exec callflow-asterisk-qa asterisk -rx "pjsip show registration telnyx-buyer-b-reg"').toString().trim();
  
  const lineA = regDetailA.match(/line\s*:\s*(\w+)/i)?.[1];
  const endpointA = regDetailA.match(/endpoint\s*:\s*([^\s]+)/i)?.[1];
  const lineB = regDetailB.match(/line\s*:\s*(\w+)/i)?.[1];
  const endpointB = regDetailB.match(/endpoint\s*:\s*([^\s]+)/i)?.[1];

  console.log(`Buyer A Reg: line=${lineA}, endpoint=${endpointA}`);
  console.log(`Buyer B Reg: line=${lineB}, endpoint=${endpointB}`);

  if (lineA !== 'true' || lineB !== 'true' || endpointA !== 'telnyx-buyer' || endpointB !== 'telnyx-buyer-b') {
    throw new Error('FATAL: Registration line parameter or endpoint mapping incorrect!');
  }
  console.log('[PASS] Both registrations have line=true with dedicated endpoint mappings.');

  // 4. Inspect PJSIP Endpoints & Contexts
  console.log('\n--- Endpoint Details & Dialplan Contexts ---');
  const epA = execSync('docker exec callflow-asterisk-qa asterisk -rx "pjsip show endpoint telnyx-buyer"').toString().trim();
  const epB = execSync('docker exec callflow-asterisk-qa asterisk -rx "pjsip show endpoint telnyx-buyer-b"').toString().trim();

  const ctxA = epA.match(/context\s*:\s*([^\s]+)/i)?.[1];
  const ctxB = epB.match(/context\s*:\s*([^\s]+)/i)?.[1];
  const aorA = epA.match(/aors\s*:\s*([^\s]+)/i)?.[1];
  const aorB = epB.match(/aors\s*:\s*([^\s]+)/i)?.[1];

  console.log(`Buyer A Endpoint: context=${ctxA}, aor=${aorA}`);
  console.log(`Buyer B Endpoint: context=${ctxB}, aor=${aorB}`);

  if (ctxA !== 'from-telnyx-buyer' || ctxB !== 'from-telnyx-buyer-b') {
    throw new Error(`FATAL: Context mismatch! ctxA=${ctxA}, ctxB=${ctxB}`);
  }
  if (ctxA === ctxB) {
    throw new Error('FATAL: Buyer A and Buyer B share the same dialplan context!');
  }
  console.log('[PASS] Inbound Buyer A routes to [from-telnyx-buyer] and Buyer B routes to [from-telnyx-buyer-b].');

  // 5. Inspect Global Endpoint Identifier Order
  console.log('\n--- Endpoint Identifier Order ---');
  const globalConf = execSync('docker exec callflow-asterisk-qa asterisk -rx "pjsip show settings"').toString().trim();
  const epOrder = globalConf.match(/endpoint_identifier_order\s*:\s*([^\n]+)/i)?.[1];
  console.log(`Configured endpoint_identifier_order: ${epOrder}`);

  // 6. Inspect Identifies
  console.log('\n--- PJSIP Identifies ---');
  const identifies = execSync('docker exec callflow-asterisk-qa asterisk -rx "pjsip show identifies"').toString().trim();
  console.log(identifies);

  console.log('\n=== SECTION C VERIFICATION COMPLETE ===\n');
}

verifySectionC().catch(err => {
  console.error(err);
  process.exit(1);
});
