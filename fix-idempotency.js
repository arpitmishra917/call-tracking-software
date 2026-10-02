const fs = require('fs');
let code = fs.readFileSync('apps/api/src/calls/calls.service.ts', 'utf8');

const target = "      if (!call || !attempt) return { action: 'NONE' };\r\n\r\n      if (call.state === CallState.COMPLETED && attempt.state === CallAttemptState.ANSWERED) {";

const replacement = `      if (!call || !attempt) return { action: 'NONE' };

      if (
        attempt.state === CallAttemptState.COMPLETED ||
        attempt.state === CallAttemptState.NO_ANSWER ||
        attempt.state === CallAttemptState.FAILED ||
        attempt.state === CallAttemptState.CANCELED
      ) {
        return { action: 'NONE' };
      }

      if (call.state === CallState.COMPLETED && attempt.state === CallAttemptState.ANSWERED) {`;

code = code.replace(target, replacement);

const target2 = "      if (!call || !attempt) return { action: 'NONE' };\n\n      if (call.state === CallState.COMPLETED && attempt.state === CallAttemptState.ANSWERED) {";
code = code.replace(target2, replacement);

fs.writeFileSync('apps/api/src/calls/calls.service.ts', code);
