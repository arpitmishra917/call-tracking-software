import http from 'http';

const timestamp = Math.floor(Date.now() / 1000).toString();
const dummySig64 = Buffer.alloc(64).toString('base64');
const body = JSON.stringify({ event_type: 'call.initiated', id: 'evt_test_123' });

const req = http.request('http://127.0.0.1:3000/webhooks/telnyx', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'telnyx-signature-ed25519': dummySig64,
    'telnyx-timestamp': timestamp,
  }
}, (res) => {
  let data = '';
  res.on('data', c => data += c);
  res.on('end', () => {
    console.log(`Backend Response Code: ${res.statusCode}`);
    console.log(`Backend Response Body: ${data}`);
  });
});

req.write(body);
req.end();
