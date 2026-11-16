import http from 'http';
import https from 'https';

function testUrl(urlStr, label) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const client = url.protocol === 'https:' ? https : http;
    const req = client.get(urlStr, (res) => {
      console.log(`[${label}] Status: ${res.statusCode} ${res.statusMessage}`);
      console.log(`[${label}] Content-Type: ${res.headers['content-type']}`);
      console.log(`[${label}] Cache-Control: ${res.headers['cache-control']}`);
      let totalBytes = 0;
      const chunks = [];
      res.on('data', (chunk) => {
        totalBytes += chunk.length;
        chunks.push(chunk);
      });
      res.on('end', () => {
        const fullBuffer = Buffer.concat(chunks);
        console.log(`[${label}] Download complete: ${totalBytes} bytes received (Expected: 96044)`);
        const isHeaderValid =
          fullBuffer.toString('ascii', 0, 4) === 'RIFF' &&
          fullBuffer.toString('ascii', 8, 12) === 'WAVE';
        console.log(`[${label}] WAV Header Validation (RIFF/WAVE): ${isHeaderValid ? 'VALID' : 'INVALID'}`);
        resolve({
          statusCode: res.statusCode,
          contentType: res.headers['content-type'],
          totalBytes,
          isHeaderValid,
        });
      });
    });

    req.on('error', (err) => {
      console.error(`[${label}] Error: ${err.message}`);
      reject(err);
    });

    req.setTimeout(10000, () => {
      console.error(`[${label}] Request timed out after 10s`);
      req.destroy();
      reject(new Error('Timeout'));
    });
  });
}

async function main() {
  console.log('=== VERIFYING RINGBACK AUDIO ENDPOINT ===\n');
  
  // 1. Localhost verification
  console.log('1. Testing Localhost: http://localhost:3000/telephony/ringback.wav');
  const localRes = await testUrl('http://localhost:3000/telephony/ringback.wav', 'LOCAL');
  console.log('');

  // 2. Public endpoint verification (if configured)
  const publicUrl = process.env.RINGBACK_AUDIO_URL || process.env.PUBLIC_URL;
  if (publicUrl) {
    console.log(`2. Testing Public URL: ${publicUrl}`);
    const publicRes = await testUrl(publicUrl, 'PUBLIC');
    console.log(`Public Endpoint HTTP Status: ${publicRes.statusCode} | Bytes: ${publicRes.totalBytes} | Content-Type: ${publicRes.contentType}`);
  } else {
    console.log('2. Public URL not configured in environment (skipping public probe)');
  }

  const passed =
    localRes.statusCode === 200 &&
    localRes.totalBytes === 96044 &&
    localRes.contentType === 'audio/wav';

  console.log(`\nFinal Verdict: ${passed ? 'ALL CHECKS PASSED — ENDPOINT VERIFIED' : 'FAILED'}`);
}

main().catch(console.error);
