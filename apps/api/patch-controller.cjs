const fs = require('fs');
let code = fs.readFileSync('apps/api/src/telephony/call-controller.ts', 'utf8');

// 1. createCall
code = code.replace(
  /to_number: to!,\s+}(\);)/g,
  "to_number: to!,\n        started_at: event.timestamp ? new Date(event.timestamp) : undefined,\n      }$1"
);

// 2. markCallAnswered
code = code.replace(
  /markCallAnswered\(\s*call\.id,\s*attempt\.id,\s*\);/g,
  "markCallAnswered(call.id, attempt.id, event.timestamp ? new Date(event.timestamp) : undefined);"
);
// In case the trailing comma is missing:
code = code.replace(
  /markCallAnswered\(\s*call\.id,\s*attempt\.id\s*\);/g,
  "markCallAnswered(call.id, attempt.id, event.timestamp ? new Date(event.timestamp) : undefined);"
);

// 3. handleCallerHangup
code = code.replace(
  /handleCallerHangup\(callId\);/g,
  "handleCallerHangup(callId, undefined, event.timestamp ? new Date(event.timestamp) : undefined);"
);

// 4. handleBuyerHangup
code = code.replace(
  /handleBuyerHangup\(\s*call\.id,\s*attempt\.id\s*\);/g,
  "handleBuyerHangup(call.id, attempt.id, event.timestamp ? new Date(event.timestamp) : undefined);"
);
code = code.replace(
  /handleBuyerHangup\(\s*call\.id,\s*attempt\.id,\s*\);/g,
  "handleBuyerHangup(call.id, attempt.id, event.timestamp ? new Date(event.timestamp) : undefined);"
);

fs.writeFileSync('apps/api/src/telephony/call-controller.ts', code);
console.log('Patched call-controller.ts');
