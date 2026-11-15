import { execSync } from 'child_process';

try {
  const output = execSync('docker inspect callflow-asterisk-qa --format "{{json .NetworkSettings.Ports}}"', { encoding: 'utf8' });
  console.log('Ports:', output);
} catch (err) {
  console.error(err.message);
}
