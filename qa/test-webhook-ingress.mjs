import http from 'http';
import https from 'https';

function request(urlStr, options = {}, data = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(url, options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(body) });
        } catch {
          resolve({ status: res.statusCode, headers: res.headers, body });
        }
      });
    });
    req.on('error', reject);
    if (data) {
      req.write(typeof data === 'string' ? data : JSON.stringify(data));
    }
    req.end();
  });
}

async function run() {
  console.log('=== Webhook Ingress & QA Route Verification ===\n');

  // 1. Probe local /qa/status
  console.log('1. Probing GET http://127.0.0.1:3000/qa/status');
  try {
    const qaStatus = await request('http://127.0.0.1:3000/qa/status');
    console.log('Status code:', qaStatus.status);
    console.log('Response body:', JSON.stringify(qaStatus.body, null, 2));
  } catch (err) {
    console.error('Failed to probe /qa/status:', err.message);
  }

  // 2. Probe local /webhooks/telnyx (unsigned)
  console.log('\n2. Probing POST http://127.0.0.1:3000/webhooks/telnyx (Unsigned Payload)');
  try {
    const res = await request('http://127.0.0.1:3000/webhooks/telnyx', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, JSON.stringify({ test: 'unsigned_event' }));
    console.log('Status code:', res.status);
    console.log('Response body:', JSON.stringify(res.body));
  } catch (err) {
    console.error('Failed to probe local webhook:', err.message);
  }

  // 3. Probe local /webhooks/telnyx (dummy signature)
  console.log('\n3. Probing POST http://127.0.0.1:3000/webhooks/telnyx (Invalid Signature)');
  try {
    const res = await request('http://127.0.0.1:3000/webhooks/telnyx', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'telnyx-signature-ed25519': 'invalid_base64_sig==',
        'telnyx-timestamp': Math.floor(Date.now() / 1000).toString(),
      }
    }, JSON.stringify({ test: 'dummy_sig_event' }));
    console.log('Status code:', res.status);
    console.log('Response body:', JSON.stringify(res.body));
  } catch (err) {
    console.error('Failed to probe invalid signature:', err.message);
  }

  // 4. Probe public ngrok /webhooks/telnyx (unsigned)
  console.log('\n4. Probing POST https://coherent-undrilled-disarm.ngrok-free.dev/webhooks/telnyx (Public Tunnel Ingress)');
  try {
    const res = await request('https://coherent-undrilled-disarm.ngrok-free.dev/webhooks/telnyx', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, JSON.stringify({ test: 'ngrok_ingress_event' }));
    console.log('Status code:', res.status);
    console.log('Response body:', JSON.stringify(res.body));
  } catch (err) {
    console.error('Failed to probe ngrok webhook:', err.message);
  }
}

run();
