import fs from 'fs';
import { execSync } from 'child_process';
import dotenv from 'dotenv';

const rootEnv = dotenv.parse(fs.readFileSync('.env', 'utf8'));
const qaEnv = dotenv.parse(fs.readFileSync('apps/api/.env.qa', 'utf8'));

const TELNYX_API_KEY = rootEnv.TELNYX_API_KEY;

async function run() {
  console.log('=== Configuring Asterisk with TCP Transport for Carrier NAT Traversal ===');

  // Detect current public IP
  let publicIp = '152.58.118.195';
  try {
    const ipRes = await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(3000) });
    const ipData = await ipRes.json();
    if (ipData.ip) publicIp = ipData.ip;
  } catch {
    console.log('Falling back to IP: ' + publicIp);
  }
  console.log(`Detected public IP: ${publicIp}`);

  // 1. Build pjsip_transport.conf with both UDP and TCP
  const transportConf = `; Automatically generated transport configuration for QA NAT traversal
[transport-udp]
type=transport
protocol=udp
bind=0.0.0.0:5060
local_net=127.0.0.0/8
local_net=10.0.0.0/8
local_net=172.16.0.0/12
local_net=192.168.0.0/16
external_media_address=${publicIp}

[transport-tcp]
type=transport
protocol=tcp
bind=0.0.0.0:5060
local_net=127.0.0.0/8
local_net=10.0.0.0/8
local_net=172.16.0.0/12
local_net=192.168.0.0/16
external_media_address=${publicIp}
`;

  fs.writeFileSync('qa/asterisk/pjsip_transport.conf', transportConf);

  // 2. Build pjsip_dynamic.conf with Buyer A and Buyer B on TCP, Caller on UDP/TCP
  const dynamicConf = `; Automatically generated dynamic endpoints for QA-2F Live Carrier Verification

[telnyx-caller-reg]
type=registration
transport=transport-tcp
outbound_auth=telnyx-caller-auth
server_uri=sip:sip.telnyx.com:5060
client_uri=sip:arpitmishra917@sip.telnyx.com:5060
retry_interval=30
max_retries=100
expiration=300
forbidden_retry_interval=60

[telnyx-caller-auth]
type=auth
auth_type=userpass
username=arpitmishra917
password=12345678

[telnyx-caller]
type=endpoint
transport=transport-tcp
context=from-telnyx-caller
disallow=all
allow=ulaw,alaw,g722
aors=telnyx-caller-aor
outbound_auth=telnyx-caller-auth
from_user=arpitmishra917
from_domain=sip.telnyx.com
callerid=+17207159445 <+17207159445>
direct_media=no
rtp_symmetric=yes
rtp_keepalive=1
force_rport=yes
rewrite_contact=yes
timers=yes
timers_min_se=90
timers_sess_expires=1800
media_address=${publicIp}

[telnyx-buyer-reg]
type=registration
transport=transport-tcp
outbound_auth=telnyx-buyer-auth
server_uri=sip:sip.telnyx.com:5060
client_uri=sip:arpitmishra9178@sip.telnyx.com:5060
retry_interval=30
max_retries=100
expiration=300
forbidden_retry_interval=60
line=yes
endpoint=telnyx-buyer

[telnyx-buyer-auth]
type=auth
auth_type=userpass
username=arpitmishra9178
password=12345678

[telnyx-buyer]
type=endpoint
transport=transport-tcp
context=from-telnyx-buyer
disallow=all
allow=ulaw,alaw,g722
aors=telnyx-buyer-aor
outbound_auth=telnyx-buyer-auth
from_user=arpitmishra9178
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

[telnyx-buyer-b-reg]
type=registration
transport=transport-tcp
outbound_auth=telnyx-buyer-b-auth
server_uri=sip:sip.telnyx.com:5060
client_uri=sip:arpitmishra9178b@sip.telnyx.com:5060
retry_interval=30
max_retries=100
expiration=300
forbidden_retry_interval=60
line=yes
endpoint=telnyx-buyer-b

[telnyx-buyer-b-auth]
type=auth
auth_type=userpass
username=arpitmishra9178b
password=Pass_63647b40b8a27e31!

[telnyx-buyer-b]
type=endpoint
transport=transport-tcp
context=from-telnyx-buyer-b
disallow=all
allow=ulaw,alaw,g722
aors=telnyx-buyer-b-aor
outbound_auth=telnyx-buyer-b-auth
from_user=arpitmishra9178b
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

  fs.writeFileSync('qa/asterisk/.pjsip_dynamic_tcp.conf', dynamicConf);

  // 3. Copy files into container
  execSync('docker cp qa/asterisk/pjsip_transport.conf callflow-asterisk-qa:/etc/asterisk/pjsip_transport.conf');
  execSync('docker cp qa/asterisk/.pjsip_dynamic_tcp.conf callflow-asterisk-qa:/etc/asterisk/pjsip_dynamic.conf');

  // 4. Restart container to load TCP transport cleanly
  console.log('Restarting Asterisk container to initialize TCP transport...');
  execSync('docker restart callflow-asterisk-qa');

  // 5. Wait for healthy boot
  console.log('Waiting 8 seconds for Asterisk to initialize...');
  await new Promise(r => setTimeout(r, 8000));

  // Re-copy dynamic config in case entrypoint overwrote it
  execSync('docker cp qa/asterisk/pjsip_transport.conf callflow-asterisk-qa:/etc/asterisk/pjsip_transport.conf');
  execSync('docker cp qa/asterisk/.pjsip_dynamic_tcp.conf callflow-asterisk-qa:/etc/asterisk/pjsip_dynamic.conf');
  execSync('docker exec callflow-asterisk-qa asterisk -rx "pjsip reload"');

  await new Promise(r => setTimeout(r, 3000));

  // 6. Verify transports and registrations
  const transports = execSync('docker exec callflow-asterisk-qa asterisk -rx "pjsip show transports"').toString();
  console.log('\n--- Transports ---\n' + transports);

  const regs = execSync('docker exec callflow-asterisk-qa asterisk -rx "pjsip show registrations"').toString();
  console.log('\n--- Registrations ---\n' + regs);

  // 7. Verify Telnyx registration status
  for (const user of ['arpitmishra9178', 'arpitmishra9178b', 'arpitmishra917']) {
    const res = await fetch(`https://api.telnyx.com/v2/sip_registration_status?credential_type=sip_credential_connection&username=${user}`, {
      headers: { Authorization: `Bearer ${TELNYX_API_KEY}` }
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
