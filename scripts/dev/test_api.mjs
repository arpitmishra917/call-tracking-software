import fs from 'fs';

const token = fs.readFileSync('scratch_token.txt', 'utf8').trim();

async function testApi() {
  console.log("Testing GET /workspaces with JWT...");
  try {
    const res = await fetch('http://localhost:3000/workspaces', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    console.log(`Status: ${res.status}`);
    const body = await res.text();
    console.log(`Body:`, body);
  } catch (err) {
    console.error("Request failed:", err);
  }
}

testApi();
