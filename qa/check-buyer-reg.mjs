import { execSync } from 'child_process';

try {
  const output = execSync('docker exec callflow-asterisk-qa asterisk -rx "pjsip show registration telnyx-buyer-reg"', { encoding: 'utf8' });
  console.log(output);
} catch (err) {
  console.error(err.message);
}
