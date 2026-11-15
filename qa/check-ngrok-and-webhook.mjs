import http from 'http';

async function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    }).on('error', reject);
  });
}

async function run() {
  console.log('--- Probing Backend Health (port 3000) ---');
  try {
    const health = await fetchJson('http://127.0.0.1:3000/health');
    console.log('Backend /health status:', health.status, JSON.stringify(health.body));
  } catch (err) {
    console.error('Backend /health failed:', err.message);
  }

  console.log('\n--- Probing ngrok Client API (port 4040) ---');
  try {
    const ngrokRes = await fetchJson('http://127.0.0.1:4040/api/tunnels');
    console.log('ngrok status:', ngrokRes.status);
    if (ngrokRes.body && ngrokRes.body.tunnels) {
      for (const t of ngrokRes.body.tunnels) {
        console.log(`Tunnel: ${t.name} -> ${t.public_url} (proto: ${t.proto}, config: ${JSON.stringify(t.config)})`);
      }
    } else {
      console.log('No active tunnels reported:', ngrokRes.body);
    }
  } catch (err) {
    console.log('ngrok client API not accessible on port 4040:', err.message);
  }
}

run();
