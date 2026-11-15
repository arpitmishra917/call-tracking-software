import fs from 'fs';
import { spawn } from 'child_process';
import dotenv from 'dotenv';

const rootEnv = dotenv.parse(fs.readFileSync('.env', 'utf8'));
const key = rootEnv.TELNYX_API_KEY;

async function run() {
  console.log('Starting tcpdump inside Asterisk container...');
  const tcpdump = spawn('docker', ['exec', 'callflow-asterisk-qa', 'tcpdump', '-l', '-nn', '-v', '-i', 'any', 'port', '5060']);
  
  let pcapOutput = '';
  tcpdump.stdout.on('data', (d) => {
    pcapOutput += d.toString();
    console.log('[TCPDUMP]', d.toString().trim());
  });
  tcpdump.stderr.on('data', (d) => {
    console.log('[TCPDUMP ERR]', d.toString().trim());
  });

  await new Promise(r => setTimeout(r, 2000));

  console.log('Sending test dial to sip:arpitmishra9178@sip.telnyx.com...');
  const res = await fetch('https://api.telnyx.com/v2/calls', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + key,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      to: 'sip:arpitmishra9178@sip.telnyx.com',
      from: '+17252574041',
      connection_id: '3090207513618941231',
      timeout_secs: 5
    })
  });
  const data = await res.json();
  console.log('Dial status:', res.status, data?.data?.call_control_id);

  console.log('Waiting 6 seconds for packets...');
  await new Promise(r => setTimeout(r, 6000));

  tcpdump.kill();
  console.log('--- TCPDUMP SUMMARY ---');
  console.log(pcapOutput || '(No packets captured)');
}

run().catch(console.error);
