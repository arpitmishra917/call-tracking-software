const fs = require('fs');
let s = fs.readFileSync('apps/api/src/calls/calls.service.ts', 'utf8');
s = s.replace(/\\/\\/ Record Usage[\\s\\S]*?\\);\\n\\s+\\}/, \`// Record Usage
      const isTerminal = [CallState.COMPLETED, CallState.FAILED, CallState.CANCELED, CallState.NO_ANSWER].includes(finalState);
      if (isTerminal && finalState === CallState.COMPLETED) {
        const talkMs = updatedCall.ended_at && updatedCall.answered_at ? updatedCall.ended_at.getTime() - updatedCall.answered_at.getTime() : 0;
        const talkSecs = Math.max(0, Math.ceil(talkMs / 1000));
        if (talkSecs > 0) {
          // fetch phone number type? It's not included in updatedCall by default. We need to query it or just pass null and let usage-billing query it.
          await this.usageBillingService.billCallUsage(updatedCall.workspace_id, updatedCall.id, null, talkSecs).catch(err => console.error('Billing Error:', err));
        }
      }\`);
fs.writeFileSync('apps/api/src/calls/calls.service.ts', s);
