const fs = require('fs');
let s = fs.readFileSync('apps/api/src/telephony/call-controller.ts', 'utf8');

const regex = /await this\\.usageService\\.recordUsage\\([\\s\\S]*?'RECORDING_STORAGE'[\\s\\S]*?\\);/;
s = s.replace(regex, \`const durationMs = call.ended_at && call.answered_at ? call.ended_at.getTime() - call.answered_at.getTime() : 0;
          const durationSecs = Math.max(0, Math.ceil(durationMs / 1000));
          if (durationSecs > 0) {
            await this.usageBillingService.billRecordingUsage(
              call.workspace_id,
              durationSecs,
              \\\`call:\\\${call.id}:recording-usage\\\`
            ).catch(err => this.logger.error(\\\`Failed to bill recording for call \\\${call.id}: \\\${err.message}\\\`));
          }\`);

fs.writeFileSync('apps/api/src/telephony/call-controller.ts', s);
