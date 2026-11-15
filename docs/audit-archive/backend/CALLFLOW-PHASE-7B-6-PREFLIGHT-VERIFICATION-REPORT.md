# CallFlow — Phase 7B-6: QA Carrier Attachment Preflight & Verification Report

**Verification Status**: COMPLETED (Read-Only)  
**Timestamp**: 2026-11-10T22:04:00+05:30  
**Target QA Database**: `callflow_qa` (`127.0.0.1:5433`, PostgreSQL 17.11)  
**Execution Scope**: Read-Only Carrier & Preflight Verification (Zero Database Writes, Zero Telnyx Mutations)  

---

## 1. Verification Summary Table

| Verification Item | Status | Exact Evidence & Details |
| :--- | :---: | :--- |
| **QA database isolation** | **PASS** | `apps/api/.env.qa` resolves to `postgresql://callflow_qa_user:***@127.0.0.1:5433/callflow_qa`. `callflow-postgres-qa` container is running healthy on loopback `127.0.0.1:5433`. Hard rejection active for any Supabase/remote hosts. |
| **Workspace and campaign identity** | **PASS** | Read-only SQL query confirmed in `callflow_qa`:<br>• `workspaces`: `5e20bafe-7306-4da7-9944-62c4c5575a5a` (`CallFlow QA Autonomous Workspace`, slug `callflow-qa-autonomous`, `ACTIVE`)<br>• `campaigns`: `6af31407-3f46-4f1d-90d0-bf08af2e9600` (`QA Autonomous Telephony Campaign`, `ACTIVE`)<br>• `buyers`: `7deb4e0a-8674-4b4b-a170-0aff3991f69c` (`QA Test SIP Buyer`, `+12025550199`, `ACTIVE`)<br>• `campaign_buyers`: `69bb8587-a7f8-40f1-b550-5293a7dcc3e2` (priority: 1, `ACTIVE`) |
| **Telnyx DID ownership** | **PASS** | Authenticated Telnyx API query `GET /v2/phone_numbers?filter[phone_number]=%2B17252574041` returned `HTTP 200 OK` with 1 matching active number belonging to the authenticated account. |
| **Provider Number ID ↔ DID mapping** | **PASS** | Authenticated Telnyx API query `GET /v2/phone_numbers/3090205705303492543` returned `HTTP 200 OK` with `phone_number: "+17252574041"` and `status: "active"`. 1:1 mapping confirmed. |
| **QA Call Control App identity** | **PASS** | Authenticated Telnyx API query `GET /v2/call_control_applications/3090207513618941231` returned `HTTP 200 OK` (`application_name: "CallFlow Autonomous QA"`, `active: true`). Distinct from Production App `3049733953897366872` (`"poc"`). |
| **DID ↔ QA App assignment** | **PASS** | Phone number record `3090205705303492543` returned `connection_id: "3090207513618941231"`. The carrier DID is assigned directly to the QA Call Control App. |
| **Webhook current URL** | **PASS** | Telnyx QA App `3090207513618941231` has `webhook_event_url: "https://coherent-undrilled-disarm.ngrok-free.dev/webhooks/telnyx"`. |
| **Webhook reachability** | **FAIL** | HTTP GET to `https://coherent-undrilled-disarm.ngrok-free.dev/health` returned `HTTP 404` with payload: `The endpoint coherent-undrilled-disarm.ngrok-free.dev is offline. ERR_NGROK_3200`. Neither ngrok process nor NestJS backend (port 3000) is running. |
| **Webhook signature verification** | **PASS** | Code audit of `TelnyxWebhookController` confirms Ed25519 signature unwrapping via `client.webhooks.unwrap()` using `telnyx-signature-ed25519` and `telnyx-timestamp` headers against `TELNYX_PUBLIC_KEY`. |
| **Webhook event idempotency** | **PASS** | Code audit of `WebhookIdempotencyService` confirms atomic database locking using `webhook_events` table with compound constraint `@@unique([provider, providerEventId])` and P2002 race protection. |
| **Stage B schema readiness** | **PASS** | Prisma model `PhoneNumber` in `apps/api/prisma/schema.prisma` contains all required fields (`workspace_id`, `phone_number`, `provider`, `provider_number_id`, `campaign_id`). `attachQaCarrierNumber` enforces ownership verification, E.164 validation, and production DID blacklisting. |
| **Production isolation** | **PASS** | Zero connections or writes to Supabase `uwycbvnqnpnfisvvbabu`. Workspace `xyz`, DID `+14845560110`, App `3049733953897366872`, and production `.env` files remain 100% untouched. |

---

## 2. Detailed Findings

### 2.1. Telnyx Asset Independent Verification
- **Target Carrier DID**: `+17252574041`
- **Carrier Record ID (`provider_number_id`)**: `3090205705303492543`
- **Assigned Connection ID**: `3090207513618941231`
- **Call Control Application Name**: `CallFlow Autonomous QA`
- **Production Call Control Application**: `3049733953897366872` (`poc`)
- **Isolation Assessment**: The user-provided claims regarding DID ownership, provider number ID, and application assignment were independently verified via read-only Telnyx API calls. The carrier DID is fully attached to the QA application in the carrier portal.

### 2.2. Webhook Infrastructure & Reachability Blockers
- **Configured Endpoint**: `https://coherent-undrilled-disarm.ngrok-free.dev/webhooks/telnyx`
- **Public Tunnel Status**: **OFFLINE** (`ERR_NGROK_3200`)
- **Local Application Port**: Port `3000` (NestJS) has no active listener (`OwningProcess` not found).
- **Implication**: While Telnyx is configured to dispatch events to this URL, any webhook dispatched by Telnyx will fail with 404/502 until the ngrok tunnel is restarted and the NestJS backend application is launched.

### 2.3. Stage B Readiness (Database Record Attachment vs. Live Carrier Testing)
- **Database Readiness**: All prerequisite records exist in `callflow_qa`. Writing the `PhoneNumber` record via `attachQaCarrierNumber()` requires:
  1. `newQaTrackingDid: "+17252574041"`
  2. `telnyxProviderNumberId: "3090205705303492543"`
  3. `confirmCarrierOwnership: true`
- **Live Carrier Testing Readiness**: Live calling remains blocked because:
  1. `TELEPHONY_QA_ENABLED=false` (correct pre-execution state).
  2. Inbound webhook tunnel is offline.
  3. Destination allowlist is empty.

---

## 3. Final Verdict

**BLOCKED — VERIFICATION REQUIRED**

> [!CAUTION]
> **Blocking Condition**: **Webhook Reachability is OFFLINE (`ERR_NGROK_3200`)**.  
> While the Telnyx DID ownership, Provider Number ID, and Call Control Application assignment are 100% verified PASS, live event ingestion cannot function until the ngrok tunnel is brought online and connected to the running backend.
> 
> If Stage B authorization is strictly scoped to the **offline PostgreSQL database attachment** of the verified DID (`PhoneNumber` table insertion), all database and carrier prerequisites are satisfied. However, before authorizing live carrier calls, the ngrok tunnel must be online and reachable.
