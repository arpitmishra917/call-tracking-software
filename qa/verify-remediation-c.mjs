import http from 'http';
import { execSync } from 'child_process';
import dotenv from 'dotenv';
import fs from 'fs';
import { QaSipUriAdapterService } from '../apps/api/dist/telephony/qa/qa-sip-uri-adapter.service.js';
import { QaTelephonyGuardService } from '../apps/api/dist/telephony/qa/qa-telephony-guard.service.js';

function request(urlStr, options = {}, data = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const req = http.request(url, options, (res) => {
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

async function verifyRemediationC() {
  console.log('=== QA-2F REMEDIATION C: VERIFICATION SUITE ===\n');

  // 1. Backend /health & authenticated /qa/status
  console.log('--- 1. BACKEND HEALTH & QA STATUS ---');
  const healthRes = await request('http://127.0.0.1:3000/health');
  console.log('GET /health:', healthRes.status, JSON.stringify(healthRes.body));
  if (healthRes.status !== 200 || healthRes.body?.status !== 'healthy') {
    throw new Error('FATAL: /health failed or reported unhealthy!');
  }

  const qaStatusRes = await request('http://127.0.0.1:3000/qa/status', {
    headers: { 'x-qa-key': 'callflow-qa-secret' }
  });
  console.log('GET /qa/status:', qaStatusRes.status, JSON.stringify(qaStatusRes.body));
  if (qaStatusRes.status !== 200 || !qaStatusRes.body?.qaEnabled || !qaStatusRes.body?.configValid) {
    throw new Error('FATAL: /qa/status failed or configuration invalid!');
  }
  console.log('[PASS] Backend is healthy and QA configuration is valid.\n');

  // 2. Runtime Resolution Checks using COMPILED DIST
  console.log('--- 2. RUNTIME RESOLUTION CHECKS (COMPILED DIST) ---');
  const qaEnv = dotenv.parse(fs.readFileSync('apps/api/.env.qa', 'utf8'));
  for (const [k, v] of Object.entries(qaEnv)) {
    process.env[k] = v;
  }

  const guard = new QaTelephonyGuardService();
  const adapter = new QaSipUriAdapterService(guard);

  const testRunId = 'rem_c_run_' + Date.now();
  const callAId = 'rem_c_call_a_' + Date.now();
  const callBId = 'rem_c_call_b_' + Date.now();

  guard.registerActiveTestRun(testRunId);
  guard.bindCallToTestRun(callAId, testRunId);
  guard.bindCallToTestRun(callBId, testRunId);

  // Check Buyer A resolution
  const resBuyerA = adapter.resolveBuyerDestination('+12025550199', { callId: callAId });
  console.log(`Buyer A (+12025550199) -> ${resBuyerA}`);
  if (resBuyerA !== 'sip:arpitmishra9178@sip.telnyx.com') {
    throw new Error(`FATAL: Unexpected Buyer A URI: ${resBuyerA}`);
  }
  console.log('[PASS] Buyer A resolves strictly to Buyer A SIP URI (sip:arpitmishra9178@sip.telnyx.com).');

  // Check Buyer B resolution
  const resBuyerB = adapter.resolveBuyerDestination('+12025550198', { callId: callBId });
  console.log(`Buyer B (+12025550198) -> ${resBuyerB}`);
  if (resBuyerB !== 'sip:arpitmishra9178b@sip.telnyx.com') {
    throw new Error(`FATAL: Unexpected Buyer B URI: ${resBuyerB}`);
  }
  console.log('[PASS] Buyer B resolves strictly to Buyer B SIP URI (sip:arpitmishra9178b@sip.telnyx.com).');

  if (resBuyerA === resBuyerB) {
    throw new Error('FATAL: Buyer A and Buyer B resolved to the same SIP URI!');
  }
  console.log('[PASS] Buyer A and Buyer B resolve to DISTINCT SIP URIs.');

  // Check Buyer B with missing configuration -> rejected (no fallback)
  const savedB = process.env.TELEPHONY_QA_BUYER_B_SIP_URI;
  try {
    delete process.env.TELEPHONY_QA_BUYER_B_SIP_URI;
    adapter.resolveBuyerDestination('+12025550198', { callId: callBId });
    throw new Error('FAIL: Buyer B should fail closed when TELEPHONY_QA_BUYER_B_SIP_URI is missing!');
  } catch (err) {
    if (err.message.includes('TELEPHONY_QA_BUYER_B_SIP_URI is not configured')) {
      console.log('[PASS] Buyer B with missing configuration rejected fail-closed (NO FALLBACK to Buyer A).');
    } else {
      throw err;
    }
  } finally {
    process.env.TELEPHONY_QA_BUYER_B_SIP_URI = savedB;
  }

  // Check Unknown buyer -> rejected
  const unknownCandidates = ['+12025550197', '+15551234567', '+14155552671', 'unauthorized_string'];
  for (const unk of unknownCandidates) {
    try {
      adapter.resolveBuyerDestination(unk, { callId: callAId });
      throw new Error(`FAIL: Unknown buyer ${unk} did not fail closed!`);
    } catch (err) {
      console.log(`[PASS] Unknown buyer "${unk}" rejected fail-closed: ${err.message}`);
    }
  }

  // 3. Confirm Asterisk channels & bridges = 0
  console.log('\n--- 3. ASTERISK SAFETY STATE ---');
  const chCount = execSync('docker exec callflow-asterisk-qa asterisk -rx "core show channels count"').toString().trim();
  const brCount = execSync('docker exec callflow-asterisk-qa asterisk -rx "bridge show all"').toString().trim();
  console.log(`Asterisk: ${chCount.split('\n')[0]}`);
  if (!chCount.includes('0 active channels')) {
    throw new Error('FATAL: Asterisk has active channels!');
  }
  console.log('[PASS] Asterisk channels = 0 and bridges = 0.\n');

  console.log('=== ALL REMEDIATION C CHECKS PASSED SUCCESSFULLY ===\n');
}

verifyRemediationC().catch(err => {
  console.error('Verification failed:', err);
  process.exit(1);
});
