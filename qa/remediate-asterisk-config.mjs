import fs from 'fs';
import { execSync } from 'child_process';

async function run() {
  console.log('=== Remediating Asterisk PJSIP Configuration ===');

  // 1. Get current public IP
  const ipRes = await fetch('https://api.ipify.org');
  const publicIp = (await ipRes.text()).trim();
  console.log('Detected Public IP:', publicIp);

  // 2. Write pjsip_transport.conf
  const transportConf = `; Automatically generated for QA live testing
[transport-udp]
type=transport
protocol=udp
bind=0.0.0.0:5060
local_net=127.0.0.0/8
local_net=10.0.0.0/8
local_net=172.16.0.0/12
local_net=192.168.0.0/16
external_media_address=${publicIp}
external_signaling_address=${publicIp}
`;
  fs.writeFileSync('qa/asterisk/pjsip_transport.conf', transportConf);
  execSync('docker cp qa/asterisk/pjsip_transport.conf callflow-asterisk-qa:/etc/asterisk/pjsip_transport.conf');
  console.log('Updated /etc/asterisk/pjsip_transport.conf in container.');

  // 3. Ensure Buyer B is in pjsip_dynamic.conf
  const creds = JSON.parse(fs.readFileSync('qa/asterisk/.buyer_b_creds.json', 'utf8'));
  const buyerBBlock = `
; QA Buyer B Configuration (Configured for QA-2F)
[telnyx-buyer-b-aor]
type=aor
contact=sip:sip.telnyx.com:5060
qualify_frequency=30

[telnyx-buyer-b-reg]
type=registration
outbound_auth=telnyx-buyer-b-auth
server_uri=sip:sip.telnyx.com:5060
client_uri=sip:${creds.user_name}@sip.telnyx.com:5060
retry_interval=30
max_retries=100
expiration=300
forbidden_retry_interval=60
line=yes
endpoint=telnyx-buyer-b

[telnyx-buyer-b-auth]
type=auth
auth_type=userpass
username=${creds.user_name}
password=${creds.password}

[telnyx-buyer-b]
type=endpoint
transport=transport-udp
context=from-telnyx-buyer-b
disallow=all
allow=ulaw,alaw,g722
aors=telnyx-buyer-b-aor
outbound_auth=telnyx-buyer-b-auth
from_user=${creds.user_name}
from_domain=sip.telnyx.com
direct_media=no
rtp_symmetric=yes
rtp_keepalive=1
force_rport=yes
rewrite_contact=yes
timers=yes
timers_min_se=90
timers_sess_expires=1800
media_address=${publicIp}
`;

  // Get current pjsip_dynamic.conf from container
  let dynConf = execSync('docker exec callflow-asterisk-qa cat /etc/asterisk/pjsip_dynamic.conf').toString();
  // Update existing media_address lines
  dynConf = dynConf.replace(/media_address=\S+/g, `media_address=${publicIp}`);
  // If buyer-b not present, append
  if (!dynConf.includes('[telnyx-buyer-b]')) {
    dynConf += buyerBBlock;
  } else {
    // If already present, make sure media_address is set
    if (!dynConf.includes('media_address=') && dynConf.includes('[telnyx-buyer-b]')) {
      dynConf = dynConf.replace(/\[telnyx-buyer-b\][\s\S]*?(?=\n\[|$)/, (m) => m + `\nmedia_address=${publicIp}\n`);
    }
  }

  fs.writeFileSync('qa/asterisk/.pjsip_dynamic_merged.conf', dynConf);
  execSync('docker cp qa/asterisk/.pjsip_dynamic_merged.conf callflow-asterisk-qa:/etc/asterisk/pjsip_dynamic.conf');
  console.log('Updated /etc/asterisk/pjsip_dynamic.conf in container.');

  // 4. Reload Asterisk PJSIP & dialplan
  execSync('docker exec callflow-asterisk-qa asterisk -rx "dialplan reload"');
  execSync('docker exec callflow-asterisk-qa asterisk -rx "pjsip reload"');
  console.log('Reloaded dialplan and PJSIP.');

  // Wait 3 seconds for registration
  console.log('Waiting 3 seconds for outbound registrations...');
  await new Promise(r => setTimeout(r, 3000));

  // Show status
  const regs = execSync('docker exec callflow-asterisk-qa asterisk -rx "pjsip show registrations"').toString();
  console.log('\n--- Registrations ---\n' + regs);

  const eps = execSync('docker exec callflow-asterisk-qa asterisk -rx "pjsip show endpoints"').toString();
  console.log('\n--- Endpoints ---\n' + eps);
}

run().catch(console.error);
