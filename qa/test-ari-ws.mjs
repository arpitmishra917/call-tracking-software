import dotenv from 'dotenv';
import fs from 'fs';
const env = dotenv.parse(fs.readFileSync('apps/api/.env.qa', 'utf8'));
for (const [k, v] of Object.entries(env)) process.env[k] = v;

const rawUrl = process.env.TELEPHONY_QA_ARI_URL || process.env.TELEPHONY_QA_SERVER_URL || 'http://127.0.0.1:8088';
const baseUrl = rawUrl.trim().replace(/\/+$/, '');
const wsBase = baseUrl.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:');

const username = (process.env.TELEPHONY_QA_ARI_USERNAME || 'callflow_qa').trim();
const password = (process.env.TELEPHONY_QA_ARI_PASSWORD || '').trim();

const url = `${wsBase}/ari/events?app=callflow-qa&api_key=${encodeURIComponent(username)}:${encodeURIComponent(password)}`;
console.log('Testing WebSocket connection to:', wsBase);

const ws = new globalThis.WebSocket(url);
ws.onopen = () => {
  console.log('SUCCESS: WebSocket connected!');
  ws.close();
};
ws.onerror = (err) => {
  console.error('ERROR event:', err);
};
ws.onclose = (e) => {
  console.log('CLOSE event:', e.code, e.reason);
};
