const jwt = require('jsonwebtoken');
require('dotenv').config({ path: require('path').resolve(__dirname, '../../apps/api/.env') });

const JWT_SECRET = process.env.JWT_SECRET;
const USER_ID = 'f5ee4e43-0d36-4c8c-a25c-c3617b2ed81c';
const EMAIL = 'test-user@example.com';

if (!JWT_SECRET) {
  console.error('JWT_SECRET is not defined in environment');
  process.exit(1);
}

const token = jwt.sign(
  {
    sub: USER_ID,
    email: EMAIL,
    aud: 'authenticated',
    role: 'authenticated',
    iss: 'supabase'
  },
  JWT_SECRET,
  { expiresIn: '1h' }
);

async function main() {
  try {
    const res = await fetch('http://localhost:3000/workspaces', {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
    
    console.log(`HTTP Status: ${res.status}`);
    const data = await res.text();
    console.log(`Body: ${data}`);
  } catch (e) {
    console.error('Error fetching API:', e.message);
  }
}

main();
