import fs from 'fs';

const log = fs.readFileSync('C:/Users/prate/.gemini/antigravity-cli/brain/1e246433-056b-4068-886b-1bf8140d2e85/.system_generated/tasks/task-9562.log', 'utf8');
const lines = log.split('\n');

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (line.includes('Playback') || line.includes('RecordingStarted') || line.includes('RecordingFinished')) {
    console.log(line);
    // Print next 10 lines if JSON follows
    for (let j = 1; j <= 10 && i + j < lines.length; j++) {
      if (lines[i + j].startsWith('  ') || lines[i + j].startsWith('{') || lines[i + j].startsWith('}')) {
        console.log(lines[i + j]);
      } else {
        break;
      }
    }
  }
}
