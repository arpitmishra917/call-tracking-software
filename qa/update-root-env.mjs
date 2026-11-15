import fs from 'fs';

let content = fs.readFileSync('.env', 'utf8');
content = content.replace('TELEPHONY_QA_MAX_CALLS_PER_RUN=1', 'TELEPHONY_QA_MAX_CALLS_PER_RUN=3');
content = content.replace('TELEPHONY_QA_MAX_CONCURRENT_CALLS=1', 'TELEPHONY_QA_MAX_CONCURRENT_CALLS=3');
content = content.replace('TELEPHONY_QA_ALLOWED_DESTINATIONS=', 'TELEPHONY_QA_ALLOWED_DESTINATIONS=+12025550199,+12025550198');
content = content.replace('TELNYX_QA_TRACKING_DID=', 'TELNYX_QA_TRACKING_DID=+17252574041');
if (!content.includes('TELEPHONY_QA_BUYER_B_SIP_URI')) {
  content += '\nTELEPHONY_QA_BUYER_A_SIP_URI=sip:arpitmishra9178@sip.telnyx.com\nTELEPHONY_QA_BUYER_B_SIP_URI=sip:arpitmishra9178b@sip.telnyx.com\n';
}

fs.writeFileSync('.env', content, 'utf8');
console.log('.env updated successfully');
