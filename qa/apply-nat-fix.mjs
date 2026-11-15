import fs from 'fs';
import { execSync } from 'child_process';

async function run() {
  const ip = '152.58.118.195';
  const port = 55687;

  console.log(`Applying NAT fix: IP=${ip}, port=${port}`);

  // 1. Copy transport conf
  execSync('docker cp qa/asterisk/pjsip_transport.conf callflow-asterisk-qa:/etc/asterisk/pjsip_transport.conf');

  // 2. Update media_address in pjsip_dynamic.conf
  let dyn = execSync('docker exec callflow-asterisk-qa cat /etc/asterisk/pjsip_dynamic.conf').toString();
  dyn = dyn.replace(/media_address=\S+/g, `media_address=${ip}`);
  fs.writeFileSync('qa/asterisk/.pjsip_dynamic_merged.conf', dyn);
  execSync('docker cp qa/asterisk/.pjsip_dynamic_merged.conf callflow-asterisk-qa:/etc/asterisk/pjsip_dynamic.conf');

  // 3. Reload Asterisk
  execSync('docker exec callflow-asterisk-qa asterisk -rx "pjsip reload"');
  console.log('Reloaded PJSIP.');

  await new Promise(r => setTimeout(r, 3000));

  const regs = execSync('docker exec callflow-asterisk-qa asterisk -rx "pjsip show registrations"').toString();
  console.log('\n--- Registrations ---\n' + regs);

  const eps = execSync('docker exec callflow-asterisk-qa asterisk -rx "pjsip show endpoints"').toString();
  console.log('\n--- Endpoints ---\n' + eps);
}

run().catch(console.error);
