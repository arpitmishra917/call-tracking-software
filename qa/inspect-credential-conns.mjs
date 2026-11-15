import fs from 'fs';
import dotenv from 'dotenv';

const env = dotenv.parse(fs.readFileSync('.env', 'utf8'));
const apiKey = env.TELNYX_API_KEY;

async function check() {
  const res = await fetch('https://api.telnyx.com/v2/credential_connections', {
    headers: { Authorization: `Bearer ${apiKey}` }
  });
  const data = await res.json();
  for (const c of data.data) {
    console.log(`Connection: ${c.connection_name} (ID: ${c.id}, user: ${c.user_name})`);
    console.log(`  sip_uri_calling_preference: ${c.sip_uri_calling_preference}`);
    console.log(`  inbound:`, JSON.stringify(c.inbound, null, 2));
    console.log(`  outbound:`, JSON.stringify(c.outbound, null, 2));
  }
}
check().catch(console.error);
