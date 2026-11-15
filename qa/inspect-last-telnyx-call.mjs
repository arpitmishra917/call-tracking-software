import fs from 'fs';
import dotenv from 'dotenv';

const rootEnv = dotenv.parse(fs.readFileSync('.env', 'utf8'));
const TELNYX_API_KEY = rootEnv.TELNYX_API_KEY;

async function run() {
  const res = await fetch('https://api.telnyx.com/v2/calls', {
    headers: { Authorization: `Bearer ${TELNYX_API_KEY}` }
  });
  const data = await res.json();
  console.log('Active Calls:', JSON.stringify(data, null, 2));

  // Let's also check balance
  const bRes = await fetch('https://api.telnyx.com/v2/balance', {
    headers: { Authorization: `Bearer ${TELNYX_API_KEY}` }
  });
  console.log('Balance:', await bRes.json());
}

run().catch(console.error);
