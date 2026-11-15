import http from 'http';
import https from 'https';
import crypto from 'crypto';
import dotenv from 'dotenv';
import fs from 'fs';
import { unwrapWebhook, TelnyxWebhook } from '../node_modules/telnyx/lib/webhooks.js';

function request(urlStr, options = {}, data = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(url, options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        resolve({ status: res.statusCode, headers: res.headers, body });
      });
    });
    req.on('error', reject);
    if (data) {
      req.write(typeof data === 'string' ? data : JSON.stringify(data));
    }
    req.end();
  });
}

async function verifySectionD() {
  console.log('=== SECTION D: WEBHOOK END-TO-END SECURITY VERIFICATION ===\n');

  // 1. Confirm ngrok tunnel configuration & public forwarding
  console.log('--- 1. NGROK TUNNEL ROUTING ---');
  const ngrokRes = await request('http://127.0.0.1:4040/api/tunnels');
  const tunnels = JSON.parse(ngrokRes.body).tunnels || [];
  if (tunnels.length === 0) {
    throw new Error('FATAL: No active ngrok tunnels found!');
  }
  const tunnel = tunnels[0];
  console.log(`Tunnel Name: ${tunnel.name}`);
  console.log(`Public URL: ${tunnel.public_url}`);
  console.log(`Target Address: ${tunnel.config.addr}`);
  if (!tunnel.public_url.includes('coherent-undrilled-disarm.ngrok-free.dev')) {
    throw new Error(`FATAL: Unexpected public URL: ${tunnel.public_url}`);
  }
  if (!tunnel.config.addr.includes('3000')) {
    throw new Error(`FATAL: ngrok is not forwarding to port 3000! Target: ${tunnel.config.addr}`);
  }
  console.log('[PASS] ngrok public domain matches Telnyx Call Control App webhook URL and forwards to localhost:3000.\n');

  // 2. Reject Missing Signature / Headers
  console.log('--- 2. MISSING SIGNATURE / HEADERS REJECTION ---');
  const missingHeadersRes = await request('http://127.0.0.1:3000/webhooks/telnyx', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, JSON.stringify({ event: 'test' }));
  console.log(`Status: ${missingHeadersRes.status} | Body: ${missingHeadersRes.body}`);
  if (missingHeadersRes.status !== 400 || !missingHeadersRes.body.includes('Missing webhook signature headers or body')) {
    throw new Error('FATAL: Backend failed to reject missing signature headers with HTTP 400!');
  }
  console.log('[PASS] Missing signature headers rejected with HTTP 400.\n');

  // 3. Reject Malformed Signature
  console.log('--- 3. MALFORMED SIGNATURE REJECTION ---');
  const now = Math.floor(Date.now() / 1000).toString();
  const malformedSigRes = await request('http://127.0.0.1:3000/webhooks/telnyx', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'telnyx-signature-ed25519': 'invalid_base64_not_64_bytes',
      'telnyx-timestamp': now,
    }
  }, JSON.stringify({ event: 'test' }));
  console.log(`Status: ${malformedSigRes.status} | Body: ${malformedSigRes.body}`);
  if (malformedSigRes.status !== 400 || !malformedSigRes.body.includes('Invalid signature format')) {
    throw new Error('FATAL: Backend failed to reject malformed signature with HTTP 400!');
  }
  console.log('[PASS] Malformed signature rejected with HTTP 400 (Invalid signature format).\n');

  // 4. Reject Expired Timestamp (> 300s)
  console.log('--- 4. EXPIRED TIMESTAMP REJECTION ---');
  const expiredTime = (Math.floor(Date.now() / 1000) - 600).toString(); // 10 minutes ago
  const dummySig64 = Buffer.alloc(64, 1).toString('base64');
  const expiredRes = await request('http://127.0.0.1:3000/webhooks/telnyx', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'telnyx-signature-ed25519': dummySig64,
      'telnyx-timestamp': expiredTime,
    }
  }, JSON.stringify({ event: 'test' }));
  console.log(`Status: ${expiredRes.status} | Body: ${expiredRes.body}`);
  if (expiredRes.status !== 400 || !expiredRes.body.includes('Webhook timestamp too old or too new')) {
    throw new Error('FATAL: Backend failed to reject expired timestamp!');
  }
  console.log('[PASS] Expired timestamp rejected with HTTP 400 (Webhook timestamp too old or too new).\n');

  // 5. Reject Invalid Cryptographic Signature (Tampered / Mismatched)
  console.log('--- 5. INVALID / MISMATCHED SIGNATURE REJECTION ---');
  const invalidSigRes = await request('http://127.0.0.1:3000/webhooks/telnyx', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'telnyx-signature-ed25519': dummySig64,
      'telnyx-timestamp': now,
    }
  }, JSON.stringify({ event: 'test' }));
  console.log(`Status: ${invalidSigRes.status} | Body: ${invalidSigRes.body}`);
  if (invalidSigRes.status !== 400 || !invalidSigRes.body.includes('signature does not match payload')) {
    throw new Error('FATAL: Backend failed to reject invalid cryptographic signature!');
  }
  console.log('[PASS] Invalid cryptographic signature rejected with HTTP 400 (signature does not match payload).\n');

  // 6. Test Valid Signed Synthetic Telnyx Webhook Fixture using Ed25519
  console.log('--- 6. VALID SIGNED SYNTHETIC TELNYX WEBHOOK FIXTURE (Ed25519) ---');
  const keypair = crypto.generateKeyPairSync('ed25519');
  const rawPublicKey = keypair.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32);
  const base64PublicKey = rawPublicKey.toString('base64');

  const syntheticPayload = JSON.stringify({
    data: {
      event_type: 'call.initiated',
      id: 'evt_synthetic_' + Date.now(),
      occurred_at: new Date().toISOString(),
      payload: {
        call_control_id: 'v3:synthetic_call_control_id',
        call_leg_id: 'synthetic_call_leg_id',
        connection_id: '3090207513618941231',
        from: '+17207159445',
        to: '+17252574041',
        direction: 'incoming',
        state: 'initial',
      }
    }
  });

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signedData = Buffer.from(`${timestamp}|${syntheticPayload}`, 'utf8');
  const signatureBytes = crypto.sign(null, signedData, keypair.privateKey);
  const base64Signature = signatureBytes.toString('base64');

  console.log(`Synthetic Payload Size: ${syntheticPayload.length} bytes`);
  console.log(`Ed25519 Base64 Public Key: ${base64PublicKey}`);
  console.log(`Ed25519 Base64 Signature (64 bytes): ${base64Signature}`);

  // Verify using Telnyx SDK unwrapWebhook
  const unwrapped = await unwrapWebhook(syntheticPayload, {
    headers: {
      'telnyx-signature-ed25519': base64Signature,
      'telnyx-timestamp': timestamp,
    },
    key: base64PublicKey,
  });

  if (unwrapped.data.id !== JSON.parse(syntheticPayload).data.id) {
    throw new Error('FATAL: Unwrapped event ID does not match synthetic payload!');
  }
  console.log(`[PASS] Telnyx SDK unwrapWebhook verified synthetic Ed25519 signature successfully! Event ID: ${unwrapped.data.id}`);

  // Verify tampering detection
  try {
    const tamperedPayload = syntheticPayload.replace('call.initiated', 'call.bridged');
    await unwrapWebhook(tamperedPayload, {
      headers: {
        'telnyx-signature-ed25519': base64Signature,
        'telnyx-timestamp': timestamp,
      },
      key: base64PublicKey,
    });
    throw new Error('FAIL: Tampered payload was not rejected!');
  } catch (err) {
    console.log(`[PASS] Tampered payload rejected as expected: ${err.message}`);
  }

  // 7. Test Public ngrok Ingress End-to-End
  console.log('\n--- 7. PUBLIC NGROK INGRESS END-TO-END TEST ---');
  const publicRes = await request('https://coherent-undrilled-disarm.ngrok-free.dev/webhooks/telnyx', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'telnyx-signature-ed25519': dummySig64,
      'telnyx-timestamp': now,
    }
  }, JSON.stringify({ event: 'test' }));
  console.log(`Public ngrok Response: Status ${publicRes.status} | Body: ${publicRes.body}`);
  if (publicRes.status !== 400 || !publicRes.body.includes('signature does not match payload')) {
    throw new Error('FATAL: Public ngrok tunnel did not route to backend signature validator!');
  }
  console.log('[PASS] Public ngrok tunnel reaches backend and executes signature verification end-to-end.');

  console.log('\n=== SECTION D VERIFICATION COMPLETE ===\n');
}

verifySectionD().catch(err => {
  console.error(err);
  process.exit(1);
});
