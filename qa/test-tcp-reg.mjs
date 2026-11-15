import fs from 'fs';
import { execSync } from 'child_process';
import dotenv from 'dotenv';

const rootEnv = dotenv.parse(fs.readFileSync('.env', 'utf8'));
const key = rootEnv.TELNYX_API_KEY;

async function run() {
  console.log('--- Applying TCP config to Asterisk ---');
  execSync('docker cp qa/asterisk/pjsip_transport.conf callflow-asterisk-qa:/etc/asterisk/pjsip_transport.conf');
  execSync('docker cp qa/asterisk/.pjsip_dynamic_tcp.conf callflow-asterisk-qa:/etc/asterisk/pjsip_dynamic.conf');
  execSync('docker exec callflow-asterisk-qa asterisk -rx "pjsip set logger on"');
  execSync('docker exec callflow-asterisk-qa asterisk -rx "pjsip reload"');
  
  console.log('Waiting 3 seconds for registration...');
  await new Promise(r => setTimeout(r, 3000));
  
  const regs = execSync('docker exec callflow-asterisk-qa asterisk -rx "pjsip show registrations"').toString();
  console.log('Asterisk Registrations:\n' + regs);
  
  for (const user of ['arpitmishra9178', 'arpitmishra9178b', 'arpitmishra917']) {
    const res = await fetch(`https://api.telnyx.com/v2/sip_registration_status?credential_type=sip_credential_connection&username=${user}`, {
      headers: { Authorization: `Bearer ${key}` }
    });
    const d = await res.json();
    console.log(`Telnyx reg for ${user}:`, {
      registered: d.registered,
      transport: d.sip_registration_details?.transport,
      ua_ip: d.sip_registration_details?.ua_ip,
      ua_port: d.sip_registration_details?.ua_port
    });
  }
}

run().catch(console.error);
