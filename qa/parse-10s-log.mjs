import fs from 'fs';
import path from 'path';

const logPath = 'C:/Users/prate/.gemini/antigravity-cli/brain/1e246433-056b-4068-886b-1bf8140d2e85/.system_generated/tasks/task-9562.log';
if (!fs.existsSync(logPath)) {
  console.error('Log file not found:', logPath);
  process.exit(1);
}

const content = fs.readFileSync(logPath, 'utf8');
const lines = content.split('\n');

const relevant = lines.filter(l => 
  l.includes('AriWebSocketClientService') ||
  l.includes('QaOrchestratorService') ||
  l.includes('TelnyxWebhookController') ||
  l.includes('CallController') ||
  l.includes('QaTelephonyGuardService') ||
  l.includes('Playback') ||
  l.includes('Recording')
);

console.log('--- RELEVANT LOG LINES (' + relevant.length + ' lines) ---');
console.log(relevant.slice(-120).join('\n'));
