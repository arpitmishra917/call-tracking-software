const fs = require('fs');
let code = fs.readFileSync('apps/api/src/calls/calls.service.ts', 'utf8');

const target = `        if (!campaign || campaign.status !== 'ACTIVE' || campaign.buyers.length === 0) {
          const updatedCall = await tx.call.update({
            where: { id: callId },
            data: { state: CallState.FAILED },
          });
          return { action: 'HANGUP', call: updatedCall };
        }`;

const replacement = `        if (!campaign || campaign.status !== 'ACTIVE' || campaign.buyers.length === 0) {
          const hasAttempts = call.attempts && call.attempts.length > 0;
          const updatedCall = await tx.call.update({
            where: { id: callId },
            data: { state: hasAttempts ? CallState.NO_ANSWER : CallState.FAILED },
          });
          return { action: 'HANGUP', call: updatedCall };
        }`;

code = code.replace(target, replacement);

const target2 = "        if (!campaign || campaign.status !== 'ACTIVE' || campaign.buyers.length === 0) {\r\n          const updatedCall = await tx.call.update({\r\n            where: { id: callId },\r\n            data: { state: CallState.FAILED },\r\n          });\r\n          return { action: 'HANGUP', call: updatedCall };\r\n        }";
code = code.replace(target2, replacement);
fs.writeFileSync('apps/api/src/calls/calls.service.ts', code);
