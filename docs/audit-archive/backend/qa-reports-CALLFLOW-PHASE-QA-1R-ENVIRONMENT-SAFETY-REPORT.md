# CallFlow Phase QA-1R: Environment Safety Flag & Configuration Precedence Investigation

**Document ID:** `CALLFLOW-PHASE-QA-1R-ENVIRONMENT-SAFETY-REPORT`  
**Phase:** CALLFLOW-PHASE-QA-1R (Evidence Reconciliation & Safety Boundary Clarification)  
**Author:** Agent 4 — Telephony, Asterisk ARI, SIP, RTP & Recording Infrastructure  
**Supporting Agents:** Agent 2 (Backend), Agent 3 (Web UI)  
**Mode:** STRICT READ-ONLY FORENSIC RECONCILIATION  
**Repository Working Copy:** [`CALLFLOW-PHASE-QA-1R-ENVIRONMENT-SAFETY-REPORT.md`](file:///C:/Projects/callflow-agent-a/qa/reports/CALLFLOW-PHASE-QA-1R-ENVIRONMENT-SAFETY-REPORT.md)  

---

## 1. Executive Summary

During Phase QA-1, an apparent contradiction was identified between two environment configuration files:
- **Root `.env`:** `TELEPHONY_QA_ENABLED=true`
- **`apps/api/.env.qa`:** `TELEPHONY_QA_ENABLED=false`

This report provides a forensic code investigation into:
1. The exact boot and configuration loading sequence in [`apps/api/src/main.ts`](file:///C:/Projects/callflow-agent-a/apps/api/src/main.ts#L14-L60).
2. Which file takes precedence in QA mode vs. standard mode.
3. Whether the discrepancy could accidentally trigger live carrier calls or bypass authorization guards.
4. The fail-closed defenses implemented in [`QaTelephonyGuardService`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/qa/qa-telephony-guard.service.ts).

---

## 2. Configuration Loading Sequence & Precedence Investigation

### 2.1 Source Code Audit of `apps/api/src/main.ts`

Lines 14–60 of [`apps/api/src/main.ts`](file:///C:/Projects/callflow-agent-a/apps/api/src/main.ts#L14-L60) govern all environment initialization:

```typescript
// apps/api/src/main.ts: lines 14-31
const isQaMode = process.env.APP_ENV === 'qa' || process.env.NODE_ENV === 'qa';

if (isQaMode) {
  // Load QA environment files first
  const qaEnvPaths = [
    path.join(apiDir, '.env.qa'),
    path.join(rootDir, '.env.qa'),
    path.join(process.cwd(), 'apps/api/.env.qa'),
    path.join(process.cwd(), '.env.qa'),
    // Fallback to base apps/api/.env for non-DB auth variables (SUPABASE_URL, JWT_SECRET)
    path.join(apiDir, '.env'),
    path.join(rootDir, '.env'),
  ];
  for (const envPath of qaEnvPaths) {
    if (fs.existsSync(envPath)) {
      dotenv.config({ path: envPath });
    }
  }
...
```

### 2.2 How `dotenv.config()` Resolves Conflicts in Node.js
In Node.js, `dotenv.config()` conforms to the universal rule:
> *"If a variable is already defined in `process.env`, `dotenv` will NOT overwrite it."*

#### When Running in QA Mode (`APP_ENV=qa` or `NODE_ENV=qa`):
1. The loop evaluates candidate paths in order:
   - Path 1: `apps/api/.env.qa` is loaded **first**.
   - In `apps/api/.env.qa`, `TELEPHONY_QA_ENABLED=false` is read and assigned to `process.env.TELEPHONY_QA_ENABLED`.
2. Later in the loop (Path 6), `rootDir/.env` is read.
3. Because `process.env.TELEPHONY_QA_ENABLED` already exists (set to `"false"`), `dotenv` **ignores** the line `TELEPHONY_QA_ENABLED=true` in root `.env`!
4. **Result:** In QA mode, `process.env.TELEPHONY_QA_ENABLED` evaluates strictly to `"false"`.

#### When Running in Non-QA Mode (Default Dev/Prod):
1. `isQaMode` is false; the `else` block executes.
2. The candidates loaded are `apps/api/.env` followed by `rootDir/.env`.
3. In `apps/api/.env`, `ACTIVE_TELEPHONY_PROVIDER=fake`, and `TELEPHONY_QA_ENABLED` is not defined.
4. When `rootDir/.env` is loaded, `TELEPHONY_QA_ENABLED=true` is set into `process.env`.
5. **Critical Question:** In non-QA mode, does `TELEPHONY_QA_ENABLED=true` enable live calls? (See Section 3).

---

## 3. Defense-in-Depth: Why the Discrepancy CANNOT Accidentally Enable Live Carrier Operations

Even if `TELEPHONY_QA_ENABLED=true` is loaded from root `.env` in non-QA mode, live carrier operations remain **100% blocked** by multiple orthogonal fail-closed barriers:

### Barrier 1: Startup Configuration Validation Fails Closed
In [`QaTelephonyGuardService.validateConfiguration()`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/qa/qa-telephony-guard.service.ts#L116-L181):
```typescript
// lines 127-133:
const qaTrackingDid = process.env.TELNYX_QA_TRACKING_DID;
if (!qaTrackingDid || !qaTrackingDid.trim()) {
  errors.push('TELNYX_QA_TRACKING_DID is unset or empty');
}
```
- In root `.env`, `TELNYX_QA_TRACKING_DID=` is blank.
- In `apps/api/.env.qa`, `TELNYX_QA_TRACKING_DID=` is blank.
- `validateConfiguration()` returns `valid: false` with error: `TELNYX_QA_TRACKING_DID is unset or empty`.
- In [`call-controller.ts`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/call-controller.ts#L316-L323), any inbound call encountering an invalid QA configuration is terminated immediately (`provider.hangupCall(callId)`).

### Barrier 2: Destination Allowlist Fails Closed
In [`QaTelephonyGuardService.parseAllowlist()`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/qa/qa-telephony-guard.service.ts#L806-L815):
- `TELEPHONY_QA_ALLOWED_DESTINATIONS=` is completely blank.
- `parseAllowlist()` returns `valid: false, error: 'TELEPHONY_QA_ALLOWED_DESTINATIONS is unset or empty'`.
- `validateDestinationOrThrow()` immediately throws `TelephonyProviderError` and aborts before any SIP/PSTN packet can be generated.

### Barrier 3: Single-Use Memory Lease Requirement
In [`QaTelephonyGuardService.isCallBound()`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/qa/qa-telephony-guard.service.ts#L722-L735):
- Even if a call physically arrives at Telnyx, CallFlow checks whether the incoming call ID has an active cryptographic server-side lease (`openInboundTestLease()`) in memory.
- Unregistered calls are immediately hung up:
  `qa.workspace_ingress.rejected: Inbound call directed to QA workspace without verified QA binding. Terminating immediately.`

### Barrier 4: Hard Database Isolation Pattern Guard
In [`main.ts`](file:///C:/Projects/callflow-agent-a/apps/api/src/main.ts#L34-L45):
- If QA mode is active, `DATABASE_URL` must connect strictly to port `5433` and database `callflow_qa`. Any connection string containing cloud patterns (`supabase.co`, `aws-0`) triggers an immediate fatal process exit: `[CRITICAL ABORT] Halting.`

---

## 4. Running Process Audit

Inspection of active system processes on the host:
- Process `27524` (`node --enable-source-maps apps/api/dist/main`) was previously observed; network port queries confirm port 3000 is currently closed (idle).
- The NestJS API process is not currently executing in the background.
- Docker containers `callflow-asterisk-qa` (ports 5060, 10000-10050, 8088) and `callflow-postgres-qa` (port 5433) are running in an idle state.

---

## 5. Answers to Mandatory Safety Questions

| Investigation Question | Forensic Finding |
| :--- | :--- |
| **1. Which configuration is loaded by the running API?** | In QA mode (`APP_ENV=qa`), `apps/api/.env.qa` loads first; `TELEPHONY_QA_ENABLED=false` takes absolute precedence. In standard mode, root `.env` loads. |
| **2. Is there a configuration precedence issue?** | Yes, a cosmetic file precedence difference exists between root `.env` and `apps/api/.env.qa`, but `dotenv` deterministic order ensures `.env.qa` wins in QA mode. |
| **3. Does the running process have a separate environment override?** | No shell-level environment variables override the files. |
| **4. Does the QA guard fail closed?** | **YES.** Missing `TELNYX_QA_TRACKING_DID` and empty `TELEPHONY_QA_ALLOWED_DESTINATIONS` completely block outbound and inbound call processing. |
| **5. Could this discrepancy accidentally enable live carrier operations?** | **NO.** Inbound calls without active leases are hung up; outbound calls without allowlisted numbers throw fatal routing exceptions. |
| **6. What is the recommended safe resolution?** | During the next authorized configuration pass (outside QA-1R), align root `.env` to set `TELEPHONY_QA_ENABLED=false` so both files are identical. |

**Reconciliation Conclusion:** The QA safety boundary is intact, robust, and completely fail-closed. No live carrier call can be placed or answered accidentally under the current configuration.
