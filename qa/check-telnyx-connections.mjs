import fs from 'fs';
import dotenv from 'dotenv';

const rootEnv = dotenv.parse(fs.readFileSync('.env', 'utf8'));
const TELNYX_API_KEY = rootEnv.TELNYX_API_KEY;

async function run() {
  const res = await fetch('https://api.telnyx.com/v2/credential_connections/3089429617522508888', {
    headers: { Authorization: `Bearer ${TELNYX_API_KEY}` }
  });
  const data = await res.json();
  console.log('Buyer A Connection Details:');
  console.log(JSON.stringify(data.data, null, 2));

  const resB = await fetch('https://api.telnyx.com/v2/credential_connections/3093376551908017755', {
    headers: { Authorization: `Bearer ${TELNYX_API_KEY}` }
  });
  const dataB = await resB.json();
  console.log('Buyer B Connection Details:');
  console.log(JSON.stringify(dataB.data, null, 2));
}

run().catch(console.error);
