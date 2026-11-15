import fs from 'fs';
import { execSync } from 'child_process';

const creds = JSON.parse(fs.readFileSync('qa/asterisk/.buyer_b_creds.json', 'utf8'));

const buyerBConfig = `

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
`;

console.log('--- 1. Writing Buyer B PJSIP config into container ---');
const tempFile = 'qa/asterisk/.pjsip_buyer_b_block.conf';
fs.writeFileSync(tempFile, buyerBConfig);

// Copy block into container and append if not already present
execSync(`docker cp ${tempFile} callflow-asterisk-qa:/tmp/buyer_b.conf`);
execSync(`docker exec callflow-asterisk-qa sh -c "grep -q 'telnyx-buyer-b' /etc/asterisk/pjsip_dynamic.conf || cat /tmp/buyer_b.conf >> /etc/asterisk/pjsip_dynamic.conf"`);
console.log('Appended Buyer B configuration to /etc/asterisk/pjsip_dynamic.conf');

console.log('\n--- 2. Reloading Asterisk Dialplan & PJSIP ---');
const dialplanReload = execSync('docker exec callflow-asterisk-qa asterisk -rx "dialplan reload"').toString();
console.log(dialplanReload.trim());

const pjsipReload = execSync('docker exec callflow-asterisk-qa asterisk -rx "pjsip reload"').toString();
console.log(pjsipReload.trim());

// Sleep 2 seconds for outbound registration to complete
console.log('\nAwaiting SIP registration response from Telnyx...');
execSync('powershell -Command "Start-Sleep -Seconds 3"');

console.log('\n--- 3. Verifying Registrations ---');
const regOutput = execSync('docker exec callflow-asterisk-qa asterisk -rx "pjsip show registrations"').toString();
console.log(regOutput);

console.log('\n--- 4. Verifying Endpoints ---');
const epOutput = execSync('docker exec callflow-asterisk-qa asterisk -rx "pjsip show endpoints"').toString();
console.log(epOutput);
