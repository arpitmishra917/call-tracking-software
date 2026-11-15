import fs from 'fs';
import dotenv from 'dotenv';

const rootEnv = dotenv.parse(fs.readFileSync('.env', 'utf8'));
const TELNYX_API_KEY = rootEnv.TELNYX_API_KEY;

async function run() {
  for (const user of ['arpitmishra9178', 'arpitmishra9178b', 'arpitmishra917']) {
    const res = await fetch(`https://api.telnyx.com/v2/sip_registration_status?credential_type=sip_credential_connection&username=${user}`, {
      headers: { Authorization: `Bearer ${TELNYX_API_KEY}` }
    });
    console.log(`=== Registration status for ${user} (HTTP ${res.status}): ===`);
    const data = await res.json();
    console.log(JSON.stringify(data, null, 2));
  }
}

run().catch(console.error);
