import fs from 'fs';

const token = fs.readFileSync('scratch_token.txt', 'utf8').trim();
const apiUrl = 'http://localhost:3000';

async function testOnboardingFlow() {
  console.log("1. Fetching workspaces...");
  let res = await fetch(`${apiUrl}/workspaces`, { headers: { 'Authorization': `Bearer ${token}` } });
  let workspaces = await res.json();
  console.log(`GET /workspaces status: ${res.status}, body:`, workspaces);

  if (workspaces.length === 0) {
    console.log("User has zero workspaces (matching onboarding redirect condition).");
    console.log("2. Creating workspace 'Acme Corp'...");
    const postRes = await fetch(`${apiUrl}/workspaces`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Acme Corp' })
    });
    const created = await postRes.json();
    console.log(`POST /workspaces status: ${postRes.status}, body:`, created);

    console.log("3. Fetching workspaces again...");
    res = await fetch(`${apiUrl}/workspaces`, { headers: { 'Authorization': `Bearer ${token}` } });
    workspaces = await res.json();
    console.log(`GET /workspaces status: ${res.status}, body:`, workspaces);
    
    if (workspaces.length > 0 && workspaces[0].role === 'OWNER') {
      console.log("Membership role is OWNER. Test passed.");
    }
  } else {
    console.log("User already has workspaces.");
  }
}

testOnboardingFlow().catch(console.error);
