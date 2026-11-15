// qa/preflight-telnyx-live.mjs
import fs from 'fs';
import dotenv from 'dotenv';

const env = dotenv.parse(fs.readFileSync('.env', 'utf8'));
const apiKey = env.TELNYX_API_KEY;

async function telnyxGet(path) {
  const res = await fetch(`https://api.telnyx.com/v2${path}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json'
    }
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Telnyx GET ${path} failed (${res.status}): ${err}`);
  }
  return res.json();
}

async function main() {
  console.log('=== TELNYX LIVE ACCOUNT PREFLIGHT ===');
  
  // 1. Account balance
  const balance = await telnyxGet('/balance');
  console.log('\n--- 1. Account Balance ---');
  console.log(`Balance: $${balance.data.balance} ${balance.data.currency} (Credit limit: $${balance.data.credit_limit})`);

  // 2. Phone Numbers
  const phoneNumbers = await telnyxGet('/phone_numbers');
  console.log('\n--- 2. Active Phone Numbers ---');
  console.log(`Count: ${phoneNumbers.data.length}`);
  for (const n of phoneNumbers.data) {
    console.log(` - ${n.phone_number} (status: ${n.status}, connection_id: ${n.connection_id})`);
  }

  // 3. Call Control Applications
  const apps = await telnyxGet('/texml_applications');
  console.log('\n--- 3. TeXML Applications ---');
  for (const a of apps.data || []) {
    console.log(` - ID: ${a.id}, Name: ${a.application_name}, VoiceURL: ${a.voice_url}`);
  }

  const ccApps = await telnyxGet('/call_control_applications');
  console.log('\n--- 4. Call Control Applications ---');
  for (const a of ccApps.data || []) {
    console.log(` - ID: ${a.id}, Name: ${a.application_name}, WebhookURL: ${a.webhook_event_url}`);
  }

  // 5. Credential Connections (SIP)
  const creds = await telnyxGet('/credential_connections');
  console.log('\n--- 5. Credential Connections (SIP) ---');
  for (const c of creds.data || []) {
    console.log(` - ID: ${c.id}, Name: ${c.connection_name}, User: ${c.user_name}, Active: ${c.active}`);
  }

  // 6. FQDN Connections
  const fqdns = await telnyxGet('/fqdn_connections');
  console.log('\n--- 6. FQDN Connections ---');
  for (const f of fqdns.data || []) {
    console.log(` - ID: ${f.id}, Name: ${f.connection_name}, Active: ${f.active}`);
  }
}

main().catch(console.error);
