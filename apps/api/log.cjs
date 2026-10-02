const fs = require('fs');
let s = fs.readFileSync('apps/api/src/telephony/call-controller.ts', 'utf8');

const regex = /await this\.usageBillingService[\s\S]*?\.billCallUsage\([\s\S]*?\)\s*\.catch\([\s\S]*?\);/g;

const replacement = `const r = await this.usageBillingService.billCallUsage(updatedCall.workspace_id, updatedCall.id, trackingNumInfo?.number_type, talkDurationSecs);
console.log('BILL_USAGE_RESULT:', r, 'DUR:', talkDurationSecs);`;

s = s.replace(regex, replacement);

fs.writeFileSync('apps/api/src/telephony/call-controller.ts', s);
