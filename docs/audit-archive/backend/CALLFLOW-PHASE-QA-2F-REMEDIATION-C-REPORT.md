# CALLFLOW — QA-2F REMEDIATION C: STALE DIST BUILD REPAIR REPORT

**Phase ID:** `CALLFLOW-PHASE-QA-2F-REMEDIATION-C`  
**Phase Name:** Stale Dist Build Repair & QA Backend Runtime Synchronization  
**Owners:** Agent 2 (Build Verification), Agent 4 (QA Backend Lifecycle & Telephony Safety)  
**Execution Timestamp:** 2026-11-15T02:07:00Z  
**Final Verdict:** **`READY FOR FRESH PREFLIGHT`**

---

## 1. Executive Summary

Following the discovery in the QA-2F Fresh Stage 1 Preflight that the compiled distribution binary (`apps/api/dist/main.js`) was stale and lacking dual-buyer routing logic, user authorization was granted for a targeted rebuild of the `api` workspace and non-disruptive restart of the QA NestJS backend daemon.

Both remediation steps have completed successfully under zero live call, zero carrier expenditure, and zero production disruption constraints:
1. **Agent 2 (Build):** Recompiled `api` workspace via `npm --workspace=api run build` (exit code `0`). Verified that `apps/api/dist/telephony/qa/qa-sip-uri-adapter.service.js` contains full dual-buyer routing, strict fail-closed no-fallback logic for Buyer B, and unknown destination rejection. All **96 focused unit tests passed cleanly**.
2. **Agent 4 (QA Backend Lifecycle):** Verified Asterisk channels = 0 and bridges = 0. Stopped the old QA backend process (PID `18144`) and restarted the freshly compiled backend under strict QA isolation protections (PID `20768`). Confirmed target database remains `callflow_qa` on PostgreSQL port 5433, `/health` is healthy, and authenticated `/qa/status` is valid.
3. **Runtime Verification:** Executed live runtime resolution tests directly against the newly compiled distribution binary. Proved that Buyer A resolves to `sip:arpitmishra9178@sip.telnyx.com`, Buyer B resolves to `sip:arpitmishra9178b@sip.telnyx.com`, missing Buyer B configuration fails closed with zero fallback, and unauthorized destinations are blocked.

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                             QA-2F REMEDIATION C VERIFICATION MATRIX                              │
├───────────────────────────────────────────────────┬───────────────┬──────────────────────────────┤
│ VERIFICATION DIMENSION                            │ STATUS        │ EVIDENCE & METRICS           │
├───────────────────────────────────────────────────┼───────────────┼──────────────────────────────┤
│ 1. NestJS API Workspace Build                     │ SUCCESS       │ nest build exit code 0       │
│ 2. Compiled Dist Dual-Buyer Code                  │ VERIFIED      │ Distinct methods & constants │
│ 3. Focused Test Suite (96 Tests)                  │ 100% PASS     │ 96 passed (0 failures, 5.90s)│
│ 4. Backend Process Transition                     │ VERIFIED      │ Old PID 18144 -> New PID 20768│
│ 5. Database Target Identity                       │ CONFIRMED     │ callflow_qa @ 127.0.0.1:5433 │
│ 6. Backend Endpoints (/health, /qa/status)        │ HEALTHY       │ HTTP 200 OK, configValid=true│
│ 7. Runtime Dual-Buyer Resolution                  │ VERIFIED      │ Buyer A -> 9178, B -> 9178b  │
│ 8. Buyer B Strict No-Fallback Fail-Closed         │ VERIFIED      │ Throws on missing config     │
│ 9. Asterisk Channels & Bridges                    │ ZERO (IDLE)   │ 0 active channels, 0 bridges │
│ 10. Live Calls / Charges / Purchases              │ ZERO          │ Balance $1.86, 0 live calls  │
└───────────────────────────────────────────────────┴───────────────┴──────────────────────────────┘
```

**Final Remediation Verdict:** **`READY FOR FRESH PREFLIGHT`**

---

## 2. Step 1 — Agent 2: Build Verification

### 2.1 Build Execution & Exit Code
- **Command:** `npm --workspace=api run build`
- **Exit Code:** `0`
- **Output:**
  ```text
  > api@0.0.1 build
  > nest build
  ```

### 2.2 Compiled Output Inspection
File: [`apps/api/dist/telephony/qa/qa-sip-uri-adapter.service.js`](file:///C:/Projects/callflow-agent-a/apps/api/dist/telephony/qa/qa-sip-uri-adapter.service.js)

The compiled distribution file was verified to contain:
1. **Logical Identifiers:**
   ```javascript
   static LOGICAL_QA_BUYER_A_CLI = '+12025550199';
   static LOGICAL_QA_BUYER_B_CLI = '+12025550198';
   static LOGICAL_QA_BUYER_A_ID = '7deb4e0a-8674-4b4b-a170-0aff3991f69c';
   static LOGICAL_QA_BUYER_B_ID = 'b0000000-0000-0000-0000-000000000002';
   ```
2. **Distinct Resolution Methods:**
   - `isLogicalQaBuyerA(destination)`
   - `isLogicalQaBuyerB(destination)`
   - `getLogicalBuyerRole(destination, callContext)`
   - `getConfiguredBuyerASipUri()`
   - `getConfiguredBuyerBSipUri()`
3. **Strict No-Fallback for Buyer B:**
   ```javascript
   else if (buyerRole === 'B') {
       configuredUri = this.getConfiguredBuyerBSipUri();
       if (!configuredUri) {
           this.logger.error('QA SIP URI adapter failed: TELEPHONY_QA_BUYER_B_SIP_URI is not configured');
           throw new TelephonyProviderError(TelephonyErrorType.ROUTING_FAILED, 'QA SIP URI adapter failed closed: TELEPHONY_QA_BUYER_B_SIP_URI is not configured');
       }
   }
   ```
4. **Unknown Buyer Rejection:**
   ```javascript
   const buyerRole = this.getLogicalBuyerRole(originalDestination, callContext);
   if (!buyerRole) {
       this.logger.error(`QA SIP URI adapter rejected unknown buyer destination: "${originalDestination}"`);
       throw new TelephonyProviderError(TelephonyErrorType.ROUTING_FAILED, ...);
   }
   ```

### 2.3 Focused Test Suite Execution
- **Command:** `npx vitest run apps/api/src/telephony/qa/qa-sip-uri-adapter.service.spec.ts apps/api/src/telephony/qa/qa-telephony-guard.service.spec.ts`
- **Result:**
  ```text
  Test Files  2 passed (2)
       Tests  96 passed (96)
    Duration  5.90s
  ```

---

## 3. Step 2 — Agent 4: QA Backend Restart & Runtime Verification

### 3.1 Pre-Restart Safety Check
- Asterisk Active Channels: `0`
- Asterisk Active Bridges: `0`
- Telnyx Live Calls: `0`

### 3.2 Process Lifecycle & PID Transition
- **Previous Backend PID:** `18144` (Stopped cleanly via task manager, port 3000 confirmed released)
- **New Backend PID:** `20768` (Launched via `node qa/launch-qa-backend.mjs`)
- **Startup Timestamp:** `15/11/2026, 7:26:26 am`
- **Startup Validation Log:**
  ```text
  === [CallFlow QA] Dedicated QA Backend Launcher ===
  [PASS] Validated QA Database Target: callflow_qa_user@127.0.0.1:5433/callflow_qa
  [PASS] Stage A Workspace (5e20bafe-7306-4da7-9944-62c4c5575a5a) and Campaign (6af31407-3f46-4f1d-90d0-bf08af2e9600) confirmed present in callflow_qa.
  ...
  [Nest] 20768 - 15/11/2026, 7:26:27 am LOG [DatabaseIsolation] Stripped production environment variable: SUPABASE_URL
  [Nest] 20768 - 15/11/2026, 7:26:27 am LOG [NestApplication] Nest application successfully started +6ms
  === [CallFlow QA] Backend Successfully Running in QA Mode ===
  ```

### 3.3 Database & Health Endpoints
- **Database Identity:** `callflow_qa` on `127.0.0.1:5433` (User: `callflow_qa_user`)
- **GET `http://127.0.0.1:3000/health`:**
  ```json
  {
    "status": "healthy",
    "timestamp": "2026-11-15T02:06:38.164Z",
    "services": {
      "database": {
        "status": "up"
      }
    }
  }
  ```
- **GET `http://127.0.0.1:3000/qa/status` (Authenticated with `x-qa-key`):**
  ```json
  {
    "qaEnabled": true,
    "configValid": true,
    "configErrors": [],
    "activeRun": null
  }
  ```

### 3.4 Runtime Dual-Buyer Resolution Proof (Direct Compiled Dist Execution)
Tested via `qa/verify-remediation-c.mjs` importing directly from `apps/api/dist`:

1. **Buyer A Resolution:**
   `+12025550199` -> `sip:arpitmishra9178@sip.telnyx.com` (`[PASS]`)
2. **Buyer B Resolution:**
   `+12025550198` -> `sip:arpitmishra9178b@sip.telnyx.com` (`[PASS]`)
3. **Distinct Destination Proof:**
   Buyer A and Buyer B resolve to **distinct, non-identical SIP URIs** matching their respective Telnyx credential connections (`[PASS]`).
4. **Buyer B Missing Config (No Fallback):**
   Unsetting `TELEPHONY_QA_BUYER_B_SIP_URI` throws:
   `QA SIP URI adapter failed closed: TELEPHONY_QA_BUYER_B_SIP_URI is not configured` (`[PASS]` — zero fallback to Buyer A).
5. **Unknown Buyer Rejection:**
   - `+12025550197`: Blocked by QA allowlist guard (`[PASS]`)
   - `+15551234567`: Blocked by QA allowlist guard (`[PASS]`)
   - `+14155552671`: Blocked by QA allowlist guard (`[PASS]`)
   - `unauthorized_string`: Rejected as invalid E.164 candidate (`[PASS]`)

---

## 4. Hard Safety Restrictions Audit

| Safety Restriction | Status | Forensic Verification |
| :--- | :--- | :--- |
| **No Live Calls Placed** | Verified | Zero carrier/PSTN test calls initiated |
| **No Telnyx Dialing** | Verified | Active calls on Telnyx account remains `0` |
| **No Production Service Restarts** | Verified | Only QA backend daemon on port 3000 restarted |
| **No Production DB Writes** | Verified | Backend pinned exclusively to `127.0.0.1:5433/callflow_qa` |
| **No Purchases or Charges** | Verified | Telnyx balance remains unchanged at `$1.86 USD` ($0.00 cost) |
| **Asterisk Media State** | Verified | Asterisk container channels = `0`, bridges = `0` |

---

## 5. Final Verdict & Next Steps

With the successful recompilation of `apps/api/dist` and the clean restart of the QA backend daemon, the stale build desynchronization that caused the previous `BLOCKED` preflight verdict is completely resolved.

### Categorical Verdict: **`READY FOR FRESH PREFLIGHT`**
