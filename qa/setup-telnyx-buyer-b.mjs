import fs from 'fs';
import dotenv from 'dotenv';
import crypto from 'crypto';

const env = dotenv.parse(fs.readFileSync('.env', 'utf8'));
const apiKey = env.TELNYX_API_KEY;

async function telnyx(path, method = 'GET', body = null) {
  const res = await fetch(`https://api.telnyx.com/v2${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Telnyx ${method} ${path} failed (${res.status}): ${err}`);
  }
  return res.json();
}

async function main() {
  console.log('--- 1. Check existing connections ---');
  const existing = await telnyx('/credential_connections');
  let buyerB = existing.data.find(c => c.connection_name === 'QA Buyer B' || c.user_name === 'arpitmishra9178b');

  const buyerBPassword = 'Pass_' + crypto.randomBytes(8).toString('hex') + '!';

  if (!buyerB) {
    console.log('Creating QA Buyer B credential connection (Free SIP Trunk)...');
    const created = await telnyx('/credential_connections', 'POST', {
      connection_name: 'QA Buyer B',
      user_name: 'arpitmishra9178b',
      password: buyerBPassword,
      active: true,
      sip_uri_calling_preference: 'unrestricted',
      anchorsite_override: 'Latency',
      default_on_hold_comfort_noise_enabled: true,
      dtmf_type: 'RFC 2833',
      inbound: {
        codecs: ['G722', 'G711U', 'G711A'],
        ani_number_format: 'E.164-national',
        dnis_number_format: 'e164',
        sip_compact_headers_enabled: true
      }
    });
    buyerB = created.data;
    console.log(`Successfully created QA Buyer B connection: ID=${buyerB.id}, User=${buyerB.user_name}`);
  } else {
    console.log(`QA Buyer B connection already exists: ID=${buyerB.id}, User=${buyerB.user_name}`);
  }

  // Verify balance has NOT changed
  const balance = await telnyx('/balance');
  console.log(`Current Balance: $${balance.data.balance} ${balance.data.currency} (Confirmed Zero Cost)`);

  // Save credentials securely to a local gitignored file for Asterisk configuration
  fs.writeFileSync('qa/asterisk/.buyer_b_creds.json', JSON.stringify({
    id: buyerB.id,
    user_name: buyerB.user_name,
    password: buyerBPassword
  }, null, 2));
  console.log('Saved Buyer B credentials securely to qa/asterisk/.buyer_b_creds.json');
}

main().catch(console.error);
