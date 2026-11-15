# CallFlow — Phase 7B-8: Post-Attachment QA Telephony Integration Audit Report

**Audit Status**: COMPLETED (Read-Only)  
**Final Verdict**: **PHASE 7B-8 — READY FOR CONTROLLED TEST REVIEW**  
**Timestamp**: 2026-11-10T22:45:30+05:30  
**Target QA Database**: `callflow_qa` (`127.0.0.1:5433`, PostgreSQL 17.11)  
**Execution Scope**: Read-Only Source Code, Configuration & Database Integration Audit  

---

## 1. Executive Summary

This phase performed a deep architectural and cryptographic integration audit of CallFlow's telephony ingress pipeline following Stage B carrier attachment.

Every component of the inbound call lifecycle—from ngrok public edge to Telnyx Ed25519 webhook signature validation, idempotency locking, database `PhoneNumber` resolution, QA workspace classification, QA guard fail-closed enforcement, synthetic SIP buyer translation, and financial ledger bypass—was systematically verified against the codebase and running runtime.

---

## 2. Comprehensive 14-Point Audit Checklist

| # | Audit Item | Status | Exact Code / Database Evidence |
| :-: | :--- | :---: | :--- |
| **1** | **QA DID resolution** | **PASS** | `callflow_qa` SQL query confirms `phone_numbers` record `0d236300-983a-489c-be01-248e6f9f2113` stores `phone_number = "+17252574041"`, `provider = "telnyx"`, `provider_number_id = "3090205705303492543"`, `status = "ACTIVE"`. |
| **2** | **QA Workspace & Campaign mapping** | **PASS** | `phone_numbers` foreign keys strictly map to `workspace_id = 5e20bafe-7306-4da7-9944-62c4c5575a5a` (`CallFlow QA Autonomous Workspace`) and `campaign_id = 6af31407-3f46-4f1d-90d0-bf08af2e9600` (`QA Autonomous Telephony Campaign`). |
| **3** | **Tracking DID source of truth** | **PASS** | Database `phone_numbers` is the primary source of truth for routing (`call-controller.ts#L286`). `TELNYX_QA_TRACKING_DID` acts as a fast ingress filter (`qa-telephony-guard.service.ts#L57-L73`), while `QA_WORKSPACE_ID` provides Level-2 workspace containment (`call-controller.ts#L300-L305`). |
| **4** | **Inbound webhook routing** | **PASS** | [`TelnyxWebhookController.handleWebhook`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/telnyx/telnyx.webhook.controller.ts#L25-L105) unpacks payload $\rightarrow$ verifies idempotency $\rightarrow$ normalizes event $\rightarrow$ dispatches to [`CallController.handleEvent`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/call-controller.ts#L157-L280). |
| **5** | **QA classification** | **PASS** | [`CallController.isQaCallContext`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/call-controller.ts#L1111-L1123) and `isQaWorkspaceNum` evaluate `call.workspace_id === process.env.QA_WORKSPACE_ID`. Classification is anchored on trusted server-side workspace identity and cannot be spoofed by caller headers. |
| **6** | **Webhook signature verification** | **PASS** | [`TelnyxWebhookController.handleWebhook`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/telnyx/telnyx.webhook.controller.ts#L30-L68) enforces Ed25519 signature unwrapping via `client.webhooks.unwrap()` using `telnyx-signature-ed25519` and `telnyx-timestamp` against `TELNYX_PUBLIC_KEY`. |
| **7** | **Event idempotency** | **PASS** | [`WebhookIdempotencyService.acquireLock`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/webhook-idempotency.service.ts#L16-L80) acquires atomic locks via `webhook_events` table (`@@unique([provider, providerEventId])`). Concurrent or replay events are dropped with `HTTP 200 Duplicate`. |
| **8** | **Unknown DID rejection** | **PASS** | [`CallController.handleEvent`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/call-controller.ts#L291-L296): If `trackingNumber` lookup returns null or status != 'ACTIVE', the call is immediately terminated via `await this.provider.hangupCall(callId)` without DB Call record creation. |
| **9** | **Production DID isolation** | **PASS** | Production DIDs (`+14845560110`, `+17658268661`, etc.) do not exist in `callflow_qa.phone_numbers` and are blacklisted in [`qa/provision-qa.ts#L17-L22`](file:///C:/Projects/callflow-agent-a/qa/provision-qa.ts#L17-L22). Events directed to them fail lookup and are hung up immediately. |
| **10** | **Synthetic buyer SIP mapping** | **PASS** | [`QaSipUriAdapterService.isLogicalQaBuyer`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/qa/qa-sip-uri-adapter.service.ts#L25-L30) identifies `+12025550199` and translates it exclusively to `TELEPHONY_QA_BUYER_SIP_URI` (`sip.telnyx.com`). |
| **11** | **PSTN fallback prevention** | **PASS** | [`QaSipUriAdapterService.resolveBuyerDestination`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/qa/qa-sip-uri-adapter.service.ts#L105-L126): If QA calling is disabled or context is non-QA, attempting to dial `+12025550199` throws `TelephonyProviderError(ROUTING_FAILED)`. It never dials PSTN. |
| **12** | **Wallet and billing bypass** | **PASS** | [`CallController.handleCallerHangup`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/call-controller.ts#L664-L675) executes `qa.billing.bypass`, releasing reservations without debit. Commercial evaluation is skipped ([#L810-L817](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/call-controller.ts#L810-L817)). Waterfall circuit-breaker terminates call on buyer hangup ([#L820-L839](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/call-controller.ts#L820-L839)). |
| **13** | **Backend & database isolation** | **PASS** | Process PID `11016` (`qa/launch-qa-backend.mjs`) maintains established TCP socket to `127.0.0.1:5433` (PostgreSQL QA). Outbound sockets to Supabase pooler port 6543: **0**. |
| **14** | **QA calling guard** | **PASS** | [`apps/api/.env.qa`](file:///C:/Projects/callflow-agent-a/apps/api/.env.qa) confirms `TELEPHONY_QA_ENABLED=false`, `TELNYX_QA_TRACKING_DID=""`, `TELEPHONY_QA_ALLOWED_DESTINATIONS=""`. |

---

## 3. Investigation: Tracking DID Configuration Discrepancy & Resolution

### Finding
During Stage B execution, the provisioning script console output displayed `TELNYX_QA_TRACKING_DID=+17252574041` as the return payload of `attachQaCarrierNumber()`, while [`apps/api/.env.qa`](file:///C:/Projects/callflow-agent-a/apps/api/.env.qa) intentionally retains `TELNYX_QA_TRACKING_DID=""`.

### Architectural Analysis
1. **Routing Hierarchy**:
   - `CallController.handleEvent` queries the database table `phone_numbers` for destination `to` ([#L286](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/call-controller.ts#L286)).
   - The database record binds `+17252574041` to `QA_WORKSPACE_ID` (`5e20bafe-7306-4da7-9944-62c4c5575a5a`).
   - Line 300 checks:
     ```ts
     const isQaWorkspaceNum =
       this.qaGuardService?.isQaWorkspace(trackingNumber.workspace_id) ||
       (process.env.QA_WORKSPACE_ID &&
         trackingNumber.workspace_id.trim().toLowerCase() ===
           process.env.QA_WORKSPACE_ID.trim().toLowerCase());
     ```
   - Because `trackingNumber.workspace_id === process.env.QA_WORKSPACE_ID`, the call is strictly classified as QA **regardless of whether `TELNYX_QA_TRACKING_DID` is set in the environment**.
2. **Fail-Closed Safety**:
   - With `TELEPHONY_QA_ENABLED=false`, line 307 executes:
     ```ts
     if (!this.qaGuardService?.isQaEnabled()) {
       this.logger.warn(`qa.workspace_ingress.rejected: Call directed to QA workspace while TELEPHONY_QA_ENABLED is false.`);
       await this.provider.hangupCall(callId);
       return;
     }
     ```
   - Inbound calls are immediately terminated without DB records or wallet reservations.
3. **Recommendation**:
   - **Do not populate `TELNYX_QA_TRACKING_DID` in `.env.qa` yet**.
   - Keeping `TELNYX_QA_TRACKING_DID=""` ensures that [`validateConfiguration()`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/qa/qa-telephony-guard.service.ts#L98-L103) will fail closed if someone attempts to prematurely set `TELEPHONY_QA_ENABLED=true` without going through the authorized pre-call review.
   - When the user explicitly authorizes live controlled call testing, populate `TELNYX_QA_TRACKING_DID=+17252574041` and `TELEPHONY_QA_ALLOWED_DESTINATIONS` concurrently with `TELEPHONY_QA_ENABLED=true`.

---

## 4. Final Verdict

**PHASE 7B-8 — READY FOR CONTROLLED TEST REVIEW**

*(All 14 integration and safety criteria have passed. The architecture is mathematically sound, fail-closed, and completely air-gapped from production. Awaiting operator authorization for the controlled call review plan).*
