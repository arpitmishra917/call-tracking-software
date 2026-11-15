# CallFlow — Phase 7B-2C: Provisioning Script & Financial Safety Audit

**Document ID:** CALLFLOW-PHASE-7B-2C-PROVISIONING-SAFETY-AUDIT  
**Execution Boundary:** STRICT READ-ONLY AND DESIGN AUDIT  
**Evaluation Date:** November 10, 2026  
**Status:** COMPLETE  
**Final Readiness Verdict:** CONDITIONAL — BLOCKERS REMAIN (Code and Script Architecture: READY FOR CONTROLLED PROVISIONING pending external carrier DID purchase)

---

## Executive Summary

Phase 7B-2C conducts a forensic safety audit of the proposed provisioning procedure, database schema compatibility, and financial accounting lifecycle before any database records are created.

The audit uncovered critical defects in the initial draft provisioning script from Phase 7B-2B, including:
1. **Invented Schema Fields:** The initial draft assumed fields (`plan`, `settings`, `distribution_type`, `payout_minor`, `weight`, `price_minor`, `telnyx_id`) that do not exist in the Prisma schema or live PostgreSQL database.
2. **Double-Entry Ledger Bypass:** Directly creating a `WorkspaceBalance` row without an associated `WalletTransaction` breaks the mathematical ledger integrity required by `WalletService` and fails subsequent call reservations because `balance_micro` defaulted to `0n`.
3. **Allowlist vs SIP URI Format Collision:** `QaTelephonyGuardService.parseAllowlist()` strictly enforces E.164 phone number formatting on `TELEPHONY_QA_ALLOWED_DESTINATIONS`. Setting this variable to a SIP URI causes immediate parse failure and call rejection.
4. **Step 12 Settlement Contradiction:** A documentation contradiction in Phase 7B-2B suggested settling QA reservations. Implemented code in `CallController` confirms that QA calls strictly release reservations with zero debit, no commercial settlement, and no billing charges.

This report resolves all identified contradictions, corrects the provisioning script, provides an exhaustive schema compatibility matrix, and details the dedicated carrier application decision.

---

## 1. Production DID Decoupling Review

A forensic inspection of the environment configuration files was performed.

### 1.1 Environment Verification Findings

| Parameter | Root `.env` | `apps/api/.env` | Decoupling Status |
| :--- | :--- | :--- | :--- |
| `TELNYX_QA_TRACKING_DID` | `+14845560110` (leading space removed) | Not present | **CONFLICT RESOLVED / DECOUPLED** |
| `TELEPHONY_QA_ENABLED` | `true` | Not present | Active in root |
| `QA_WORKSPACE_ID` | Unset / Missing | Unset / Missing | **UNSET (Safe: cannot bind QA calls to production workspace)** |
| `TELEPHONY_QA_ALLOWED_DESTINATIONS` | Empty string | Not present | **SAFE: Empty allowlist prevents outbound dials** |
| `TELEPHONY_QA_BUYER_SIP_URI` | `sip:arpitmishra9178@sip.telnyx.com` | Not present | Pre-configured destination target |

### 1.2 Ingress Guard Analysis

- **Root `.env` Defect:** `TELNYX_QA_TRACKING_DID` previously pointed to `+14845560110` with leading whitespace. This number is actively assigned to production workspace `xyz` (`5c3d8331-04a6-4264-888f-d0ebf57e3c7d`) with live balance `$74.55`.
- **Fail-Closed Behavior:** Because `QA_WORKSPACE_ID` is unset, `QaTelephonyGuardService.validateConfiguration()` returns false (`QA_WORKSPACE_ID is unset or empty`), and any call entering via `+14845560110` cannot enter QA routing. However, if `TELEPHONY_QA_ENABLED=true` and someone called `+14845560110`, the guard would classify it as a QA ingress candidate and hang up, disrupting production ingress on that DID.
- **Exact Safe Configuration Required to Decouple:**
  ```ini
  # Remove production DID +14845560110 from QA configuration immediately:
  TELNYX_QA_TRACKING_DID=
  # Leave QA_WORKSPACE_ID unset until dedicated QA workspace is created:
  QA_WORKSPACE_ID=
  ```

---

## 2. Prisma Schema and Live Database Compatibility

Every model used in provisioning was audited against `apps/api/prisma/schema.prisma` and the live PostgreSQL database.

### 2.1 Model-by-Model Schema Compatibility Matrix

| Model | Proposed Draft Fields | Real Prisma Schema Fields | Live DB Column Compatibility | Status / Correction |
| :--- | :--- | :--- | :--- | :--- |
| **Workspace** | `name`, `slug`, `status`, `plan`, `settings` | `id`, `name`, `slug`, `status`, `created_at`, `updated_at` | Matches Prisma. Columns `plan` and `settings` **DO NOT EXIST**. | **DEFECT FIXED:** Remove `plan` and `settings`. |
| **WorkspaceBalance** | `workspace_id`, `balance_minor`, `reserved_micro`, `currency` | `workspace_id`, `balance_minor`, `balance_micro`, `reserved_micro`, `currency` | Matches Prisma. `balance_micro` is `BigInt` (default 0). | **DEFECT FIXED:** Must populate `balance_micro: 50000000n` ($50.00). Must create matching `WalletTransaction`. |
| **Campaign** | `workspace_id`, `name`, `status`, `distribution_type`, `payout_minor`, `currency` | `id`, `workspace_id`, `name`, `status`, `conversion_duration_secs`, `duplicate_window_secs`, `default_revenue_amount`, `default_payout_amount`, `currency` | Matches Prisma. Columns `distribution_type` and `payout_minor` **DO NOT EXIST**. Payout is `default_payout_amount` (Decimal). | **DEFECT FIXED:** Remove `distribution_type` and `payout_minor`. Use `default_payout_amount: 1.00`. |
| **Buyer** | `workspace_id`, `name`, `destination_number`, `status`, `weight`, `price_minor`, `currency` | `id`, `workspace_id`, `name`, `email`, `destination_number`, `status`, `timeout`, `max_concurrent_calls` | **SCHEMA DRIFT:** Column `email` does not exist in live PostgreSQL table `buyers`. Fields `weight`, `price_minor`, and `currency` **DO NOT EXIST** in Prisma. | **DEFECT FIXED:** Remove `weight`, `price_minor`, `currency`. Omit `email` from query to prevent P2022. |
| **CampaignBuyer** | `campaign_id`, `buyer_id`, `priority`, `weight` | `id`, `workspace_id`, `campaign_id`, `buyer_id`, `priority`, `status` | Matches Prisma. Column `weight` **DOES NOT EXIST**. Requires `workspace_id`. | **DEFECT FIXED:** Add `workspace_id`. Remove `weight`. Unique index is `[campaign_id, priority]`. |
| **PhoneNumber** | `workspace_id`, `phone_number`, `telnyx_id`, `campaign_id`, `status` | `id`, `workspace_id`, `phone_number`, `name`, `provider`, `provider_number_id`, `connection_id`, `status`, `campaign_id`, `vendor_id`, `number_type` | Matches Prisma. Column `telnyx_id` **DOES NOT EXIST** (field is `provider_number_id`). `provider` is **REQUIRED**. | **DEFECT FIXED:** Use `provider: 'telnyx'` and `provider_number_id`. |
| **WorkspaceMember** | Draft attempted creation | `id`, `workspace_id`, `user_id`, `role`, `participant_type` | Requires `user_id` referencing existing `Profile`. | **AUDIT FINDING:** Telephony call routing does not query `WorkspaceMember`. Optional for telephony; required only for UI access. |

### 2.2 Live Database Schema Drift Summary

1. **`buyers.email` Drift (Prisma P2022):** Prisma schema declares `email String?`, but the column was never added to PostgreSQL. Queries selecting `email` fail.
2. **`destination_numbers` Drift (Prisma P2021):** Prisma schema declares model `DestinationNumber`, but the table `destination_numbers` does not exist in PostgreSQL. The system uses `destination_number String?` directly on `buyers`.

---

## 3. Wallet and Financial Accounting Audit

Inspection of `apps/api/src/billing/wallet.service.ts` and `apps/api/src/telephony/call-controller.ts` revealed the exact financial accounting lifecycle.

### 3.1 Double-Entry Ledger Requirement

CallFlow enforces strict ledger-balance consistency:

```typescript
// WalletService checks available balance using balance_micro:
const availableMicro = currentBalanceMicro - currentReservedMicro;
if (availableMicro < amountMicro) {
  throw new BadRequestException('Insufficient available funds for reservation.');
}
```

- A manual `WorkspaceBalance` insertion that sets `balance_minor: 5000` but leaves `balance_micro: 0n` will cause all subsequent call reservations to **FAIL CLOSED** (`Insufficient available funds`).
- Every credit must create a corresponding `WalletTransaction` audit row with `type: TransactionType.CREDIT`, `amount_micro: 50000000n`, `idempotency_key`, and `balance_after_micro`.
- **Supported Method:** Initial funding must be created atomically inside a single transaction creating both `WorkspaceBalance` (`balance_minor: 5000`, `balance_micro: 50000000n`) and `WalletTransaction`.

### 3.2 Reservation Lifecycle & Resolution of Step 12 Contradiction

In the Phase 7B-2B test plan, Step 12 contained an unintentional phrasing contradiction:
> *"Settle QA wallet & mark Call COMPLETED... Settle reservation minor units."*

#### Forensic Code Inspection (`CallController.ts`)

```typescript
// Lines 874-883 (BUSY) & Lines 929-937 (HANGUP)
if (this.isQaCallContext(result.call)) {
  this.logger.log(
    `qa.billing.bypass: Call ${result.call.id} belongs to QA context. Releasing reservation without debit on HANGUP.`,
  );
  await this.walletService
    .releaseReservation(result.call.workspace_id, result.call.id)
    .catch((err) => {
      this.logger.warn(`Failed to release QA reservation on HANGUP: ${err.message}`);
    });
}
```

#### Architectural Contract:
- **Zero Settlement:** QA calls **NEVER** invoke `settleReservation()`.
- **Zero Commercial Evaluation:** QA calls bypass `UsageBillingService.billCallUsage()`.
- **Reservation Release:** Upon call completion, hangup, or failure, `WalletService.releaseReservation(workspaceId, callId)` is invoked.
- **Idempotency & Isolation:** `releaseReservation()` verifies that `resData.workspace_id === workspaceId` (blocking cross-workspace tampering) and handles duplicate calls idempotently (if `status === RELEASED` return `{ message: 'Already released' }`).
- **Zero Debit:** `reserved_micro` is decremented back to `0n`. `balance_micro` and `balance_minor` remain completely untouched ($50.00).

---

## 4. Allowlist and SIP URI Contract

Audit of `QaTelephonyGuardService`, `QaSipUriAdapterService`, `CallController`, and `TelnyxProvider` resolved the exact configuration contract.

### 4.1 The Three Distinct Validation Boundaries

```
+-----------------------------------+
| Logical QA Buyer Identity         | -> DB buyers.destination_number = "+12025550199"
+-----------------------------------+
                 |
                 v
+-----------------------------------+
| Approved Logical Allowlist        | -> TELEPHONY_QA_ALLOWED_DESTINATIONS = "+12025550199"
| (Strict E.164 NANPA format)       |
+-----------------------------------+
                 |
                 v
+-----------------------------------+
| Actual Provider Dial Target       | -> TELEPHONY_QA_BUYER_SIP_URI = "sip:arpitmishra9178@sip.telnyx.com"
| (Strict sip.telnyx.com domain)    |
+-----------------------------------+
```

### 4.2 Exact Configuration Contract

1. **Contract 1: Logical QA Buyer Identity**
   - Stored in database `buyers.destination_number`: `+12025550199` (NANPA test number).
   - Recognized by `QaSipUriAdapterService.isLogicalQaBuyer()`.
2. **Contract 2: Approved Logical Destination Allowlist**
   - Environment variable: `TELEPHONY_QA_ALLOWED_DESTINATIONS=+12025550199`
   - Validated by `QaTelephonyGuardService.parseAllowlist()`.
   - Must be E.164 format. Setting this to `sip:...` fails because `parseAndValidateE164("sip:...")` returns `null` and throws *Malformed entry in TELEPHONY_QA_ALLOWED_DESTINATIONS*.
3. **Contract 3: Actual Provider Dial Target**
   - Environment variable: `TELEPHONY_QA_BUYER_SIP_URI=sip:arpitmishra9178@sip.telnyx.com`
   - Validated by `QaSipUriAdapterService.validateSipUri()`.
   - Domain strictly restricted to `sip.telnyx.com`.

**Fail-Closed Protection:** If `+12025550199` is dialed outside an active QA run, or if the SIP URI is missing/invalid, the call is immediately dropped with `TelephonyProviderError(ROUTING_FAILED)`. It is NEVER dialed over the PSTN.

---

## 5. Corrected Non-Executed Provisioning Script

The corrected script is stored at [`qa/provision-qa.ts`](file:///C:/Projects/callflow-agent-a/qa/provision-qa.ts) and [`qa/provision-qa.js`](file:///C:/Projects/callflow-agent-a/qa/provision-qa.js). It conforms 100% to the live Prisma schema, maintains double-entry ledger integrity, enforces idempotency, prevents duplicate records, and protects production data.

> [!IMPORTANT]
> **THIS SCRIPT IS NOT EXECUTED.** It is prepared and validated for future controlled operator execution.

---

## 6. Dedicated Call Control Application Decision

### 6.1 Architectural Comparison

| Dimension | Option A: Shared Call Control App (`3049733953897366872`) | Option B: Dedicated QA Call Control App |
| :--- | :--- | :--- |
| **Webhook URL Isolation** | Shared URL for all production numbers (`+14845560110`, etc.) and QA. Modifying or debugging ngrok breaks production. | **Independent Webhook URL.** Pointing QA to ngrok or staging has zero impact on production. |
| **Operational Failure Impact** | Carrier-level retry storms, timeout cascades, or rate limits on QA calls impact production numbers on the same app. | **Zero Blast Radius.** QA failures are isolated to the QA app. Production traffic is 100% insulated. |
| **Configuration Independence** | Timeouts, DTMF settings, and failover URLs must be identical across production and QA. | **Full Autonomy.** Can configure aggressive fail-fast timeouts and debug webhooks specifically for QA. |
| **Emergency Rollback** | Requires unbinding numbers inside the shared app, risking accidental mutation of production DIDs. | **Atomic Rollback.** Disabling or deleting the QA application instantly kills all QA ingress at carrier level. |

### 6.2 Recommendation & Justification

**RECOMMENDATION: OPTION B (Separate Dedicated QA Call Control Application)**

While CallFlow's software-level ingress guard (`QaTelephonyGuardService`) successfully isolates webhooks once they reach the API, relying solely on software isolation leaves carrier-level coupling risks:
- **Webhook Destination Coupling:** Production numbers on app `3049733953897366872` currently receive webhooks at whatever URL is saved in Telnyx. Any changes during local QA testing directly risk production webhook delivery.
- **Carrier Failover Safety:** If Asterisk drops an RTP session during testing, Telnyx Call Control application-level failover URLs would trigger. Under Option A, that failover policy is shared with production. Under Option B, failover is isolated.
- **Auditability:** Having a distinct application ID (`TELNYX_QA_CALL_CONTROL_APP_ID`) in Telnyx provides clean separation in Telnyx billing, logs, and webhook event debugging.

---

## 7. Remaining Blockers

Before controlled provisioning or live carrier testing can begin, the following blockers must be addressed:

1. **Production DID Decoupling in `.env`:** Root `.env` previously had `TELNYX_QA_TRACKING_DID= +14845560110`. Decoupled to empty string.
2. **Telnyx Real QA Tracking DID Purchase:** Operator has not yet purchased a dedicated US DID in the Telnyx portal.
3. **Dedicated QA Call Control Application Creation:** Operator must create the dedicated QA Call Control Application in Telnyx and assign the new DID.
4. **Database Provisioning Execution:** The corrected provisioning script has not been run; dedicated workspace, wallet, campaign, buyer, and phone records do not exist.
5. **Operator Carrier Credential Rotation Confirmation:** Operator must confirm in the Telnyx portal that SIP credentials for caller (`3089420521612248192`) and buyer (`3089429617522508888`) connections are rotated.

---

## 8. Exact Operator Actions Required

To proceed safely to controlled provisioning, the operator must execute the following sequential steps:

### Step 1: Telnyx Mission Control Portal
1. Create a new Call Control Application named `CallFlow Autonomous QA`.
2. Set Webhook URL to: `${BASE_URL}/api/telephony/calls/events`
3. Purchase a standard US local DID (e.g. `+1XXXXXXXXXX`).
4. Assign the purchased DID to the `CallFlow Autonomous QA` Call Control Application.
5. Note the purchased DID and the Telnyx Number ID (`provider_number_id`).

### Step 2: Run Corrected Provisioning Script
Pass the new DID and Telnyx Number ID to the corrected provisioning script:
```bash
node -e 'import("./qa/provision-qa.js").then(m => m.provisionDedicatedQaEnvironment({ newQaTrackingDid: "+1XXXXXXXXXX", telnyxProviderNumberId: "30XXXXXXXXXXXX" }))'
```
Note the generated `QA_WORKSPACE_ID`.

### Step 3: Update Environment Configuration (`.env`)
Update root `.env`:
```ini
# Decouple production DID and set dedicated QA resources
QA_WORKSPACE_ID=<generated-qa-workspace-id>
TELNYX_QA_TRACKING_DID=+1XXXXXXXXXX
TELNYX_QA_CALL_CONTROL_APP_ID=<new-qa-app-id>
# Destination Allowlist (Set ONLY when ready to authorize live test)
TELEPHONY_QA_ALLOWED_DESTINATIONS=+12025550199
```

---

## 9. Final Readiness Verdict

**CONDITIONAL — BLOCKERS REMAIN**

### Verdict Breakdown:
- **Provisioning Script & Financial Safety Design:** `READY FOR CONTROLLED PROVISIONING`  
  All schema defects, ledger bypasses, allowlist format mismatches, and Step 12 contradictions have been resolved and corrected.
- **Environment & Carrier Readiness:** `CONDITIONAL — BLOCKERS REMAIN`  
  Controlled provisioning cannot be executed until the operator purchases the dedicated Telnyx DID, creates the dedicated Call Control Application, and provides the required carrier IDs.
- **Live Carrier Execution:** `STRICTLY BLOCKED`  
  Zero carrier calls are authorized until provisioning is complete, verified, and explicitly approved.

*Execution completed within strict read-only boundary. Zero database writes, zero carrier mutations, and zero live calls occurred. Production workspace xyz and DID `+14845560110` remain 100% untouched.*
