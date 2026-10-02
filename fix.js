const fs = require('fs');
let code = fs.readFileSync('apps/api/src/calls/calls.service.ts', 'utf8');

const targetStr = `      if (!campaign || campaign.status !== 'ACTIVE' || campaign.buyers.length === 0) {
        const updatedCall = await tx.call.update({
          where: { id: callId },
          data: { state: CallState.FAILED },
        });
        return { action: 'HANGUP', call: updatedCall };
      }`;
      
const replaceStr = `      if (!campaign || campaign.status !== 'ACTIVE' || campaign.buyers.length === 0) {
        const hasAttempts = call.attempts && call.attempts.length > 0;
        const updatedCall = await tx.call.update({
          where: { id: callId },
          data: { state: hasAttempts ? CallState.NO_ANSWER : CallState.FAILED },
        });
        return { action: 'HANGUP', call: updatedCall };
      }`;

let replaced = false;

code = code.replace(targetStr, () => {
    replaced = true;
    return replaceStr;
});

if (!replaced) {
    const targetStrWin = targetStr.replace(/\n/g, "\r\n");
    code = code.replace(targetStrWin, () => {
        replaced = true;
        return replaceStr;
    });
}

if (!replaced) {
    console.error("Replacement failed!");
} else {
    fs.writeFileSync('apps/api/src/calls/calls.service.ts', code);
    console.log("Success!");
}
