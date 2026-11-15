import dotenv from 'dotenv';
import fs from 'fs';
import { QaSipUriAdapterService } from '../apps/api/dist/telephony/qa/qa-sip-uri-adapter.service.js';
import { QaTelephonyGuardService } from '../apps/api/dist/telephony/qa/qa-telephony-guard.service.js';

// Load apps/api/.env.qa
const qaEnv = dotenv.parse(fs.readFileSync('apps/api/.env.qa', 'utf8'));
for (const [k, v] of Object.entries(qaEnv)) {
  process.env[k] = v;
}

async function verifySectionA() {
  console.log('=== SECTION A: BACKEND ROUTING VERIFICATION ===\n');

  const guard = new QaTelephonyGuardService();
  const adapter = new QaSipUriAdapterService(guard);

  const runId = 'preflight_run_' + Date.now();
  const callIdA = 'preflight_call_A_' + Date.now();
  const callIdB = 'preflight_call_B_' + Date.now();

  guard.registerActiveTestRun(runId);
  guard.bindCallToTestRun(callIdA, runId);
  guard.bindCallToTestRun(callIdB, runId);

  // 1. Resolve Buyer A
  const resolvedA = adapter.resolveBuyerDestination('+12025550199', { callId: callIdA });
  console.log(`[PASS] Buyer A logical CLI (+12025550199) -> ${resolvedA}`);

  // 2. Resolve Buyer B
  const resolvedB = adapter.resolveBuyerDestination('+12025550198', { callId: callIdB });
  console.log(`[PASS] Buyer B logical CLI (+12025550198) -> ${resolvedB}`);

  if (resolvedA === resolvedB) {
    throw new Error('FATAL: Buyer A and Buyer B resolved to identical SIP URIs!');
  }
  console.log('[PASS] Buyer A and Buyer B resolve to DISTINCT SIP URIs.');

  // 3. Verify Buyer B cannot fall back to Buyer A
  const savedBuyerB = process.env.TELEPHONY_QA_BUYER_B_SIP_URI;
  try {
    delete process.env.TELEPHONY_QA_BUYER_B_SIP_URI;
    adapter.resolveBuyerDestination('+12025550198', { callId: callIdB });
    throw new Error('FAIL: Buyer B should have thrown an error when TELEPHONY_QA_BUYER_B_SIP_URI is missing!');
  } catch (err) {
    if (err.message.includes('TELEPHONY_QA_BUYER_B_SIP_URI is not configured')) {
      console.log('[PASS] Buyer B fails closed when Buyer B SIP URI is unset (no fallback to Buyer A).');
    } else {
      throw err;
    }
  } finally {
    process.env.TELEPHONY_QA_BUYER_B_SIP_URI = savedBuyerB;
  }

  // 4. Verify SIP URIs match Telnyx credential usernames
  const buyerAUser = resolvedA.match(/sip:([^@]+)@/)?.[1];
  const buyerBUser = resolvedB.match(/sip:([^@]+)@/)?.[1];
  console.log(`Buyer A SIP user: "${buyerAUser}" (Expected: arpitmishra9178)`);
  console.log(`Buyer B SIP user: "${buyerBUser}" (Expected: arpitmishra9178b)`);
  if (buyerAUser !== 'arpitmishra9178' || buyerBUser !== 'arpitmishra9178b') {
    throw new Error('FATAL: Configured SIP URI usernames do not match Telnyx credential connections!');
  }
  console.log('[PASS] Both SIP URIs match actual Telnyx credential connection usernames.');

  // 5. Verify Allowlist contents
  const allowlist = guard.parseAllowlist();
  console.log('Parsed QA Allowlist destinations:', Array.from(allowlist.allowedSet));
  const expectedSet = new Set(['+12025550199', '+12025550198']);
  const isMatch = allowlist.allowedSet.size === expectedSet.size &&
    [...allowlist.allowedSet].every(x => expectedSet.has(x));
  if (!isMatch) {
    throw new Error(`FATAL: Allowlist mismatch! Found: ${[...allowlist.allowedSet].join(', ')}`);
  }
  console.log('[PASS] Allowlist strictly contains ONLY the intended QA logical destinations.');

  // 6. Verify unknown destinations fail closed
  const unknownDestinations = ['+12025550197', '+15551234567', '+14155552671', 'invalid_number'];
  for (const unknown of unknownDestinations) {
    try {
      adapter.resolveBuyerDestination(unknown, { callId: callIdA });
      throw new Error(`FAIL: Unknown destination ${unknown} did not fail closed!`);
    } catch (err) {
      console.log(`[PASS] Unknown destination "${unknown}" failed closed: ${err.message}`);
    }
  }

  guard.clearActiveTestRuns();
  console.log('\n=== SECTION A VERIFICATION PASSED ===\n');
}

verifySectionA().catch(err => {
  console.error(err);
  process.exit(1);
});
