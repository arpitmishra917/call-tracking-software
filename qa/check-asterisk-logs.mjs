import { execSync } from 'child_process';

try {
  const output = execSync('docker logs --tail 200 callflow-asterisk-qa', { encoding: 'utf8' });
  const lines = output.split('\n');
  const matching = lines.filter(l => l.includes('QA-BUYER') || l.includes('INVITE') || l.includes('Stasis') || l.includes('Notice') || l.includes('Warning') || l.includes('Error'));
  console.log(`Found ${matching.length} matching lines:`);
  for (const m of matching.slice(-30)) {
    console.log(m);
  }
} catch (err) {
  console.error(err.message);
}
