import { execSync } from 'child_process';

const testConf = `
[transport-tcp]
type=transport
protocol=tcp
bind=0.0.0.0:5060

[telnyx-tcp-test-aor]
type=aor
contact=sip:sip.telnyx.com:5060\\;transport=tcp
qualify_frequency=15

[telnyx-tcp-test-reg]
type=registration
transport=transport-tcp
outbound_auth=telnyx-buyer-auth
server_uri=sip:sip.telnyx.com:5060\\;transport=tcp
client_uri=sip:arpitmishra9178@sip.telnyx.com:5060\\;transport=tcp
retry_interval=30
max_retries=10
expiration=300
line=yes
endpoint=telnyx-buyer
`;

execSync('docker exec -i callflow-asterisk-qa tee /etc/asterisk/pjsip_tcp_test.conf', { input: testConf });
console.log('Wrote pjsip_tcp_test.conf');
