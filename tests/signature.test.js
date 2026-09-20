const crypto = require('crypto');
const { unwrapWebhook } = require('telnyx/lib/Webhooks');

describe('Deterministic Ed25519 Signature Verification', () => {
  it('should successfully verify a valid signature without external dependencies', async () => {
    // 1. Generate a one-off Ed25519 keypair
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    
    // 2. Extract base64 public key (simulating what Telnyx provides in Mission Control)
    const pubKeyBase64 = publicKey
      .export({ format: 'der', type: 'spki' })
      .subarray(12)
      .toString('base64');
    
    // 3. Create a test payload and timestamp (must be within 5 mins for SDK replay protection)
    const payload = JSON.stringify({ data: { id: 'evt_deterministic_test', event_type: 'call.initiated' } });
    const timestamp = Math.floor(Date.now() / 1000).toString();
    
    // 4. Construct the signature payload exactly as Telnyx does: "timestamp|payload"
    const signedPayload = Buffer.from(timestamp + '|' + payload);
    const signature = crypto.sign(null, signedPayload, privateKey).toString('base64');
    
    const headers = { 
      'telnyx-timestamp': timestamp, 
      'telnyx-signature-ed25519': signature 
    };
    
    // 5. Verify using the actual SDK method (no mocking)
    const event = await unwrapWebhook(payload, { headers }, pubKeyBase64);
    
    expect(event.data.id).toBe('evt_deterministic_test');
    expect(event.data.event_type).toBe('call.initiated');
  });

  it('should reject a valid signature if the payload is modified (tampered)', async () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const pubKeyBase64 = publicKey.export({ format: 'der', type: 'spki' }).subarray(12).toString('base64');
    
    const payload = JSON.stringify({ data: { id: 'evt_test' } });
    const timestamp = Math.floor(Date.now() / 1000).toString();
    
    const signedPayload = Buffer.from(timestamp + '|' + payload);
    const signature = crypto.sign(null, signedPayload, privateKey).toString('base64');
    
    const headers = { 
      'telnyx-timestamp': timestamp, 
      'telnyx-signature-ed25519': signature 
    };
    
    const tamperedPayload = JSON.stringify({ data: { id: 'evt_test', malicious: true } });
    
    await expect(unwrapWebhook(tamperedPayload, { headers }, pubKeyBase64)).rejects.toThrow('Signature verification failed');
  });
});
