const fs = require('fs');
let code = fs.readFileSync('apps/api/src/calls/calls.service.ts', 'utf8');

// 1. createCall interface
code = code.replace(
  /from_number: string;\s+to_number: string;\s+}\)/g,
  "from_number: string;\n      to_number: string;\n      started_at?: Date;\n    })"
);

// 2. createCall prisma payload
code = code.replace(
  /to_number: data\.to_number,\s+},\s+include:/g,
  "to_number: data.to_number,\n          started_at: data.started_at,\n        },\n        include:"
);

// 3. markCallAnswered signature
code = code.replace(
  /async markCallAnswered\(callId: string, attemptId: string\): Promise<boolean> {/g,
  "async markCallAnswered(callId: string, attemptId: string, answeredAt?: Date): Promise<boolean> {"
);

// 4. markCallAnswered update Call
code = code.replace(
  /await tx\.call\.update\({\s*where: { id: callId },\s*data: { state: CallState\.ROUTING },\s*}\);/g,
  "await tx.call.update({ where: { id: callId }, data: { state: CallState.ROUTING, answered_at: answeredAt } });"
);

// 5. handleCallerHangup signature
code = code.replace(
  /async handleCallerHangup\(providerCallId: string, durationSecs\?: number\) {/g,
  "async handleCallerHangup(providerCallId: string, durationSecs?: number, endedAt?: Date) {"
);

// 6. handleCallerHangup update Call
// In handleCallerHangup, it calls `updateCallState(call.id, CallState.CANCELED/FAILED/COMPLETED)`.
// We need to pass endedAt to updateCallState. Wait, handleCallerHangup calls updateCallState:
code = code.replace(
  /await this\.updateCallState\(call\.id, CallState\.CANCELED\);/g,
  "await this.updateCallState(call.id, CallState.CANCELED, durationSecs, endedAt);"
);
code = code.replace(
  /await this\.updateCallState\(call\.id, CallState\.FAILED\);/g,
  "await this.updateCallState(call.id, CallState.FAILED, durationSecs, endedAt);"
);
code = code.replace(
  /await this\.updateCallState\(call\.id, CallState\.COMPLETED\);/g,
  "await this.updateCallState(call.id, CallState.COMPLETED, durationSecs, endedAt);"
);
code = code.replace(
  /await this\.updateCallState\(call\.id, finalState\);/g,
  "await this.updateCallState(call.id, finalState, durationSecs, endedAt);"
);

// 7. handleBuyerHangup signature
code = code.replace(
  /async handleBuyerHangup\(callId: string, attemptId: string\): Promise<{/g,
  "async handleBuyerHangup(callId: string, attemptId: string, endedAt?: Date): Promise<{"
);

// 8. updateCallState signature
code = code.replace(
  /async updateCallState\(\s*callId: string,\s*newState: CallState,\s*durationSecs\?: number,\s*\) {/g,
  "async updateCallState(callId: string, newState: CallState, durationSecs?: number, endedAt?: Date) {"
);

// 9. updateCallState duration logic
const durationLogic = `
      const updateData: any = { state: finalState };
      
      if (endedAt) {
        updateData.ended_at = endedAt;
      }

      let computedDuration = durationSecs;
      
      if (this.isTerminalCallState(finalState) && call.duration_secs === null && durationSecs === undefined) {
        if (call.started_at && endedAt) {
          computedDuration = Math.floor((endedAt.getTime() - call.started_at.getTime()) / 1000);
        } else {
          computedDuration = Math.floor((Date.now() - (call.created_at?.getTime?.() ?? Date.now())) / 1000);
        }
      }

      if (computedDuration !== undefined) {
        updateData.duration_secs = computedDuration;
      }
`;
code = code.replace(
  /const updateData: any = { state: finalState };[\s\S]*?updateData\.duration_secs = durationSecs;\s*}/g,
  durationLogic
);

fs.writeFileSync('apps/api/src/calls/calls.service.ts', code);
console.log('Patched calls.service.ts');
