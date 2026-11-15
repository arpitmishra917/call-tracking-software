# CallFlow — Phase 7B-3: Controlled Provisioning Readiness Gate Report

**Document ID:** CALLFLOW-PHASE-7B-3-PROVISIONING-READINESS-REPORT  
**Execution Boundary:** STRICT READ-ONLY AND PRE-EXECUTION SAFETY REVIEW  
**Evaluation Date:** November 10, 2026  
**Final Readiness Verdict:** **CONDITIONALLY READY**  
*(Code and Script Architecture: 100% Verified and Hardened. Authorized ONLY for a separately approved, isolated QA database provisioning operation once the operator fulfills carrier purchase and environment toggle prerequisites. Live carrier calls, production mutations, and commercial settlements remain STRICTLY PROHIBITED).*

---

## Executive Summary

Phase 7B-3 conducts the final pre-execution safety review before any database records are created or carrier assets are configured. In strict compliance with the read-only execution boundary:
- **Zero database writes occurred.**
- **Zero Prisma migrations were run.**
- **Zero Telnyx carrier mutations or live calls were made.**
- **Zero environment files (`.env`) were modified.**
- **Production workspace `xyz` (`5c3d8331-04a6-4264-888f-d0ebf57e3c7d`) and production DID `+14845560110` remained 100% untouched.**

All script files, Prisma models, `WalletService` double-entry ledger mechanics, and test suites were verified directly against source code and isolated mocks.

---

## 1. Source-Code Verified Facts

The following facts are verified directly from source code inspection:

### 1.1 Script Bridge & Invocation Parity
- **Inspection of [`qa/provision-qa.ts`](file:///C:/Projects/callflow-agent-a/qa/provision-qa.ts) & [`qa/provision-qa.js`](file:///C:/Projects/callflow-agent-a/qa/provision-qa.js):**
  - Both files implement identical safety validation logic, database queries, and transaction parameters.
  - Neither file contains top-level auto-execution code. Importing the module or requiring the file registers the function without triggering database connections or side-effects.
- **Strict Boolean Assertion on `confirmCarrierOwnership`:**
  - Evaluated at lines 66–70 of `qa/provision-qa.ts`:
    ```typescript
    if (confirmCarrierOwnership !== true) {
      throw new Error(
        'ABORT: Mandatory operator confirmation missing. You must explicitly set "confirmCarrierOwnership: true" after verifying in the Telnyx Portal that the DID and provider_number_id belong together.',
      );
    }
    ```
  - Rejects `false`, `null`, `undefined`, and truthy string values like `"true"`.

### 1.2 Production Boundaries & Collision Protection
- **Protected Production Values:**
  - Hardcoded sets in `qa/provision-qa.ts` (lines 33–42):
    ```typescript
    export const FORBIDDEN_PRODUCTION_DIDS = new Set([
      '+14845560110',
      '+17658268661',
      '+13215033884',
      '+18668300066',
    ]);
    export const FORBIDDEN_WORKSPACE_IDS = new Set([
      '5c3d8331-04a6-4264-888f-d0ebf57e3c7d', // workspace xyz
    ]);
    ```
  - Attempts to provision any of these DIDs abort before starting the database transaction.
- **Cross-Workspace Uniqueness Enforced:**
  - Pre-transaction checks query `PhoneNumber` by `cleanDid` and `cleanProviderNumberId`, rejecting if assigned to any non-QA workspace.
  - Queries `Buyer` by destination number `+12025550199`, rejecting if assigned to any non-QA workspace.

### 1.3 CampaignBuyer Compound Unique Constraints
- **Prisma Schema (`schema.prisma` lines 332–333):**
  - Declares both `@@unique([campaign_id, priority])` and `@@unique([campaign_id, buyer_id])`.
- **Generated Prisma Client (`index.d.ts` lines 63758–63768):**
  - Generates both `campaign_id_priority` and `campaign_id_buyer_id` on `CampaignBuyerWhereUniqueInput`.
- **Collision Protection in Script (lines 350–390):**
  - Evaluates `where: { campaign_id_priority: { campaign_id, priority: 1 } }`. If mapped to a different buyer, it aborts with a priority collision error before attempting write operations.
  - Evaluates `where: { campaign_id_buyer_id: { campaign_id, buyer_id } }`. Validates priority and status if existing.

### 1.4 Wallet & Financial Accounting Invariants
- **Ledger Mathematics (`wallet.service.ts` lines 54–86):**
  - `WalletService` requires `balance_minor === Number(balance_micro / 10000n)`.
  - The script creates `WorkspaceBalance` (`balance_minor: 5000`, `balance_micro: 50000000n`, `reserved_micro: 0n`, `currency: 'USD'`) and a matching `CREDIT` `WalletTransaction`.
- **Double-Entry Ledger Reconciliation Audit (lines 201–219):**
  - When inspecting an existing balance, the script computes:
    $$\text{calculatedMicro} = \sum \text{CREDIT/REFUND} - \sum \text{DEBIT}$$
    Asserts $\text{calculatedMicro} === \text{balance\_micro}$. Any mismatch triggers an immediate abort.
- **Duplicate Initial Funding Prevention (lines 221–233):**
  - Queries `WalletTransaction` for `idempotency_key: qa_wallet_init_${workspaceId}`. If present, verifies amount ($50.00) and skips duplicate crediting.
- **Zero Debit / Zero Settlement on QA Calls:**
  - Verified in [`apps/api/src/telephony/call-controller.ts`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/call-controller.ts) lines 874–883 & 929–937: QA calls strictly bypass `UsageBillingService.billCallUsage()` and `settleReservation()`.
  - Verified in `call-controller.ts` (lines 669, 778, 831, 879, 934, 1079) and [`qa-orchestrator.service.ts`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/qa/qa-orchestrator.service.ts) (line 361): QA cleanup strictly calls `WalletService.releaseReservation()`, never raw SQL status mutations.

---

## 2. Mocked Test Results

Execution of isolated unit tests using in-memory mocked database emulation with transactional rollback verification:

**Command:**
```powershell
npm test --prefix apps/api src/telephony/qa/provision-qa.spec.ts
```

**Results:**
```
 RUN  v4.1.11 C:/Projects/callflow-agent-a/apps/api

 ✓ src/telephony/qa/provision-qa.spec.ts (10 tests) 136ms
   ✓ 1. Rejects invalid or malformed E.164 phone numbers
   ✓ 2. Rejects protected production DIDs
   ✓ 3. Rejects duplicate DID already assigned to a non-QA workspace
   ✓ 4. Rejects duplicate provider_number_id already bound to a different number
   ✓ 5. Enforces CampaignBuyer unique constraints (both priority and buyer compound unique)
   ✓ 6. Rejects corrupt existing wallet with ledger discrepancy
   ✓ 7. Prevents duplicate initial $50 funding when wallet is already initialized
   ✓ 8. Partial transaction failure rolls back all mutations cleanly
   ✓ 9. Repeated idempotent provisioning does not duplicate records
   ✓ 10. Requires mandatory operator confirmation of carrier ownership

 Test Files  1 passed (1)
      Tests  10 passed (10)
```

**Full QA Test Suite:**
```powershell
npm test --prefix apps/api src/telephony/qa
```
- **8 test files passed (8)**
- **156 tests passed (156)**
- Zero connection to live PostgreSQL database, Telnyx API, or Asterisk carrier trunks.

---

## 3. Environment Observations

A read-only inspection of repository configuration was performed. Credential values are omitted:

| Setting | Observed Value / State | Safety Assessment | Action Required |
| :--- | :--- | :--- | :--- |
| `TELEPHONY_QA_ENABLED` | `true` in root `.env` | **UNSAFE FOR PROVISIONING** | **Must be set to `false`** before executing provisioning to ensure fail-closed ingress while records are being created. |
| `TELNYX_QA_TRACKING_DID` | Empty string (`TELNYX_QA_TRACKING_DID=`) | **SAFE** | Production DID `+14845560110` is decoupled. Must remain empty until dedicated QA DID is acquired. |
| `QA_WORKSPACE_ID` | Unset / missing in all `.env` files | **SAFE** | Prevents binding QA test calls to any workspace. |
| `TELEPHONY_QA_ALLOWED_DESTINATIONS` | Empty string | **SAFE** | Prevents outbound dials to any destination. |
| Production DID `+14845560110` | Not configured in any QA setting | **SAFE** | Protected from QA routing. |
| `TELNYX_CALL_CONTROL_APP_ID` | Configured for production application | **SAFE (Coupling Risk Identified)** | Dedicated QA Call Control App ID (`TELNYX_QA_CALL_CONTROL_APP_ID`) must be created to isolate webhooks. |

---

## 4. Manual Operator Confirmations Still Required

Before controlled provisioning can be executed, the operator must complete the following sequential actions:

- [ ] **1. Disable QA Ingress during provisioning:** Set `TELEPHONY_QA_ENABLED=false` in root `.env`.
- [ ] **2. Purchase Dedicated QA DID:** Purchase a standard US local DID (e.g. `+1XXXXXXXXXX`) in the Telnyx Mission Control Portal.
- [ ] **3. Create Dedicated QA Call Control Application:**
  - Create application named `CallFlow Autonomous QA`.
  - Set Webhook URL to: `${BASE_URL}/api/telephony/calls/events`.
  - Assign the purchased DID to this application.
- [ ] **4. Manually Confirm Carrier Ownership:**
  - Note the Telnyx Number ID (`provider_number_id`, e.g. `30XXXXXXXXXXXX`) associated with the purchased DID.
  - Verify they belong to the same Telnyx account and application.
- [ ] **5. Rotate SIP Credentials:** Verify rotated SIP credentials for connections `3089420521612248192` and `3089429617522508888`.
- [ ] **6. Run Controlled Provisioning Script:**
  ```bash
  node -e 'import("./qa/provision-qa.js").then(m => m.provisionDedicatedQaEnvironment({ newQaTrackingDid: "+1XXXXXXXXXX", telnyxProviderNumberId: "30XXXXXXXXXXXX", confirmCarrierOwnership: true }))'
  ```
- [ ] **7. Update Environment Keys:** Set `QA_WORKSPACE_ID`, `TELNYX_QA_TRACKING_DID`, `TELNYX_QA_CALL_CONTROL_APP_ID`, and (when ready to test) `TELEPHONY_QA_ALLOWED_DESTINATIONS=+12025550199`.

---

## 5. Final Verdict

### **CONDITIONALLY READY**

#### Verdict Definition & Scope:
- **Code & Test Integrity:** **READY.** The provisioning script, compound unique constraint validations, double-entry ledger audits, and rollback mechanics are 100% verified and tested.
- **Remaining Prerequisites:** Controlled provisioning is authorized **ONLY** after the operator:
  1. Sets `TELEPHONY_QA_ENABLED=false` in `.env`.
  2. Purchases the dedicated Telnyx DID and creates the dedicated QA Call Control Application.
  3. Supplies the verified parameters with `confirmCarrierOwnership: true`.

*Live carrier calls, carrier mutations, production changes, wallet settlement, and commercial processing remain STRICTLY BLOCKED.*
