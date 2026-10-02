const fs = require('fs');
let lines = fs.readFileSync('apps/api/src/calls/calls.service.ts', 'utf8').split('\\n');
let newLines = [];
for (let i = 0; i < lines.length; i++) {
  if (i >= 196 && i <= 206) continue;
  newLines.push(lines[i]);
  if (i === 195) {
    newLines.push("      // Record Usage");
    newLines.push("      const isTerminal = [CallState.COMPLETED, CallState.FAILED, CallState.CANCELED, CallState.NO_ANSWER].includes(finalState);");
    newLines.push("      if (isTerminal && finalState === CallState.COMPLETED) {");
    newLines.push("        const talkMs = updatedCall.ended_at && updatedCall.answered_at ? updatedCall.ended_at.getTime() - updatedCall.answered_at.getTime() : 0;");
    newLines.push("        const talkSecs = Math.max(0, Math.ceil(talkMs / 1000));");
    newLines.push("        if (talkSecs > 0) {");
    newLines.push("          await this.usageBillingService.billCallUsage(updatedCall.workspace_id, updatedCall.id, null, talkSecs).catch(err => console.error('Billing Error:', err));");
    newLines.push("        }");
    newLines.push("      }");
  }
}
fs.writeFileSync('apps/api/src/calls/calls.service.ts', newLines.join('\\n'));
