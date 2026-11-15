# CallFlow — Phase 7B-4: Controlled QA Workspace Provisioning Report

**Document ID:** CALLFLOW-PHASE-7B-4-QA-PROVISIONING-REPORT  
**Execution Boundary:** STRICT PROVISIONING SAFETY GATE & PRECONDITION ENFORCEMENT  
**Evaluation Date:** November 10, 2026  
**Final Status:** **BLOCKED — PREREQUISITES NOT MET**  
*(Execution halted prior to script invocation in strict adherence to Phase 7B-4 safety boundaries. Zero database records were created or modified. Zero live carrier calls or mutations occurred).*

---

## Executive Summary

Phase 7B-4 is the execution gate for controlled provisioning of the isolated QA workspace. The gate strictly requires that all 10 mandatory preconditions be met before executing [`qa/provision-qa.js`](file:///C:/Projects/callflow-agent-a/qa/provision-qa.js).

Upon pre-execution evaluation, the following blockers were identified:
1. **`TELEPHONY_QA_ENABLED=true` in root `.env`:** Precondition 1 requires `TELEPHONY_QA_ENABLED=false` to ensure ingress fails closed while records are provisioned.
2. **Dedicated Telnyx QA DID Not Yet Purchased:** Preconditions 5 & 7 cannot be satisfied because the operator has not yet acquired or provided the real US local DID and its associated Telnyx Number ID (`provider_number_id`).
3. **Dedicated QA Call Control Application Not Created:** Precondition 6 requires a dedicated Telnyx Call Control Application to isolate webhooks from the production application (`3049733953897366872`).
4. **Carrier Credential Rotation Unconfirmed:** Preconditions 8 & 9 require confirmed rotation of SIP credentials.

In strict compliance with the Phase 7B-4 directive (*"If any prerequisite fails, STOP. Do not execute the provisioning script"*), execution was immediately halted. **Zero writes occurred to the database or carrier.**

---

## 1. Mandatory Preconditions Verification Matrix

| # | Precondition Requirement | Evaluated State | Compliance Status | Evidence / Notes |
| :--- | :--- | :--- | :--- | :--- |
| **1** | `TELEPHONY_QA_ENABLED=false` | `TELEPHONY_QA_ENABLED=true` | **FAILED (BLOCKER)** | Set to `true` in root [`.env`](file:///C:/Projects/callflow-agent-a/.env)#L34. Operator must toggle to `false` prior to provisioning. |
| **2** | `TELNYX_QA_TRACKING_DID` is empty | `TELNYX_QA_TRACKING_DID=` | **PASSED** | Decoupled in root [`.env`](file:///C:/Projects/callflow-agent-a/.env)#L52. Production DID `+14845560110` is disconnected. |
| **3** | `QA_WORKSPACE_ID` is empty | Unset / Missing | **PASSED** | Not present in root [`.env`](file:///C:/Projects/callflow-agent-a/.env) or [`apps/api/.env`](file:///C:/Projects/callflow-agent-a/apps/api/.env). Ingress fails closed. |
| **4** | `TELEPHONY_QA_ALLOWED_DESTINATIONS` is empty | Empty string (`""`) | **PASSED** | Set to empty in root [`.env`](file:///C:/Projects/callflow-agent-a/.env)#L38. Outbound dials strictly blocked. |
| **5** | Dedicated QA Telnyx DID has been purchased | None provided | **FAILED (BLOCKER)** | Operator has not yet purchased a dedicated US local DID. |
| **6** | Dedicated QA Call Control Application created | Production app only | **FAILED (BLOCKER)** | Only production Call Control App `3049733953897366872` exists. |
| **7** | DID and `provider_number_id` verified in portal | None provided | **FAILED (BLOCKER)** | Operator has not provided the verified DID / `provider_number_id` pair. |
| **8** | QA SIP credentials separate from production | Unverified | **FAILED (BLOCKER)** | Requires operator confirmation of dedicated credentials. |
| **9** | Exposed credentials rotated and verified | Unverified | **FAILED (BLOCKER)** | Operator has not confirmed portal rotation of SIP passwords. |
| **10** | Production DID `+14845560110` not used in QA | Excluded | **PASSED** | Production DID is not in any QA variable and is hardcoded in `FORBIDDEN_PRODUCTION_DIDS`. |

---

## 2. Pre-Execution Script & Environment Inspection

### 2.1 Provisioning Script Integrity & Hashes
The script files were audited and verified identical in logic:
- **`qa/provision-qa.js` SHA256:** `C1BAA82EDC3F8636530ADA371F9F0F6304ACCEB14C5E555D1D812FCC336A9DD7`
- **`qa/provision-qa.ts` SHA256:** `61AF7401FBD4A21E24E5B75CCB787AD204EB8968FDA75393427C6B6F4321A376`

### 2.2 Target Parameters Ready for Controlled Execution
When unblocked, the script will execute with the following exact parameters:
- **Target Workspace Slug:** `callflow-qa-autonomous`
- **Target Workspace Name:** `CallFlow QA Autonomous Workspace`
- **Target Campaign Name:** `QA Autonomous Telephony Campaign`
- **Target Buyer Name:** `QA Test SIP Buyer`
- **Logical QA Buyer Destination CLI:** `+12025550199`
- **Initial QA Funding Amount:** Exactly `50000000n` ($50.00 USD / `5000` minor units)
- **Database Target Identity:**
  - Host: `aws-0-ap-northeast-1.pooler.supabase.com`
  - Port: `6543` (transaction pooler) / `5432` (direct)
  - Database: `postgres`
  - Supabase Project Ref: `uwycbvnqnpnfisvvbabu`
  - *(Credentials omitted for security)*

### 2.3 Protection Boundaries Reconfirmed
- **Protected Production Workspace:** `5c3d8331-04a6-4264-888f-d0ebf57e3c7d` (workspace `xyz`) is in `FORBIDDEN_WORKSPACE_IDS`.
- **Protected Production DIDs:** `+14845560110`, `+17658268661`, `+13215033884`, `+18668300066` are in `FORBIDDEN_PRODUCTION_DIDS`.
- **Atomic Transaction:** All 6 steps (`Workspace`, `WorkspaceBalance`, `WalletTransaction`, `Campaign`, `Buyer`, `CampaignBuyer`, `PhoneNumber`) are executed inside a single `prisma.$transaction`. Any error triggers an immediate, full rollback.

---

## 3. Post-Review Database Verification (Read-Only)

Because execution was blocked by the safety gate:
- **QA Workspace:** None created.
- **QA Campaign:** None created.
- **Logical QA Buyer:** None created.
- **CampaignBuyer Mapping:** None created.
- **Dedicated QA PhoneNumber:** None created.
- **QA Wallet & Ledger:** None created.
- **Production Resources:** Workspace `xyz` ($74.55 balance) and DID `+14845560110` remain 100% untouched.
- **Partial Provisioning:** None. Zero database writes were executed.

---

## 4. Operator Action Items to Unblock Provisioning

To proceed to provisioning execution, the operator must complete the following 4 prerequisites:

### Action 1: Environment Safety Toggle
Update root [`.env`](file:///C:/Projects/callflow-agent-a/.env):
```ini
TELEPHONY_QA_ENABLED=false
```

### Action 2: Telnyx Portal Setup
1. Log into the Telnyx Mission Control Portal.
2. Purchase a standard US local DID (e.g. `+1XXXXXXXXXX`).
3. Create a Call Control Application named `CallFlow Autonomous QA` with Webhook URL:
   ```
   https://<your-ngrok-domain>/api/telephony/calls/events
   ```
4. Assign the purchased DID to the `CallFlow Autonomous QA` Call Control Application.
5. Note the purchased DID and the Telnyx Number ID (`provider_number_id`, e.g. `30XXXXXXXXXXXX`).

### Action 3: Confirm Carrier Ownership & Run Provisioning Script
Execute the verified provisioning script passing the purchased DID and `provider_number_id` with mandatory confirmation:
```bash
node -e 'import("./qa/provision-qa.js").then(m => m.provisionDedicatedQaEnvironment({ newQaTrackingDid: "+1XXXXXXXXXX", telnyxProviderNumberId: "30XXXXXXXXXXXX", confirmCarrierOwnership: true }))'
```

### Action 4: Update Environment Keys
Add the newly generated IDs to root [`.env`](file:///C:/Projects/callflow-agent-a/.env):
```ini
QA_WORKSPACE_ID=<generated-qa-workspace-id>
TELNYX_QA_TRACKING_DID=+1XXXXXXXXXX
TELNYX_QA_CALL_CONTROL_APP_ID=<new-qa-call-control-app-id>
```

---

## 5. Final Status

### **BLOCKED — PREREQUISITES NOT MET**

*Execution stopped before running the provisioning script. The codebase, script, and test architecture are fully ready, but execution cannot proceed until the operator toggles `TELEPHONY_QA_ENABLED=false`, purchases the dedicated Telnyx DID, and provides the carrier IDs.*
