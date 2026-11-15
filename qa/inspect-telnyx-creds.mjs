import fs from 'fs';
import dotenv from 'dotenv';

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
  const creds = await telnyx('/credential_connections');
  console.log('--- CREDENTIAL CONNECTIONS ---');
  for (const c of creds.data) {
    console.log(JSON.stringify(c, null, 2));
  }
}

main().catch(console.error);
