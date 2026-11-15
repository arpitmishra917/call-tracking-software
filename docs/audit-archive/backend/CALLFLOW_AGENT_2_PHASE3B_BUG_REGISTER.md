# CALLFLOW AGENT 2 PHASE 3B: BUG REGISTER

**Agent**: Agent 2 (Backend, API, Business Logic, Webhook Processing, and Backend Reliability)  
**Date**: November 12, 2026  
**Scope**: Defect Tracking and Remediation for Phase 3B Audit Areas  
**Workspace**: [callflow-agent-a](file:///C:/Projects/callflow-agent-a)  

---

## 1. Phase 3B Bug Register

| Bug ID | Title | Priority | Status | Affected Files | Fix Summary | Verified Test Suite |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **BUG-BE-003-RACE** | Read-then-update concurrency race on stale lock recovery and retries | **P1** | **RESOLVED** | [`webhook-idempotency.service.ts`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/webhook-idempotency.service.ts) | Implemented atomic conditional database operations via `updateMany` with `updatedAt: { lte: staleThreshold }` for stale locks, and `status in [FAILED, IGNORED]` for retries. | `webhook-idempotency.service.spec.ts` (11/11 passed) |
| **BUG-BE-003-FENCE** | Missing lease fencing token allows delayed stale workers to overwrite active state | **P1** | **RESOLVED** | [`webhook-idempotency.service.ts`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/webhook-idempotency.service.ts)<br>[`telnyx.webhook.controller.ts`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/telnyx/telnyx.webhook.controller.ts) | Introduced UUID `leaseToken` stored in database during lock acquisition; `markProcessed`, `markFailed`, and `markIgnored` require matching `leaseToken` to succeed. | `webhook-idempotency.service.spec.ts` (Tests 7, 8, 9 passed) |
| **BUG-BE-002-ROUTE** | `TwilioWebhookController` mounted in active application routing table | **P0** | **RESOLVED** | [`telephony.module.ts`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/telephony.module.ts) | Removed `TwilioWebhookController` from `controllers: [...]` in `TelephonyModule`. Route `/webhooks/twilio` is completely unregistered and returns 404. | `twilio-isolation.spec.ts` (Test 4 passed) |
| **BUG-BE-002-DI** | Environment variable could activate retired Twilio provider | **P0** | **RESOLVED** | [`telephony.module.ts`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/telephony.module.ts) | Removed `TwilioProvider` injection from `TELEPHONY_PROVIDER`; added fatal exception crash if `TELEPHONY_PROVIDER=twilio` is set. | `twilio-isolation.spec.ts` (Tests 1, 2, 3 passed) |
| **BUG-BE-002-FAILOPEN** | Twilio webhook controller failed open when auth token was unset | **P1** | **RESOLVED** | [`twilio.webhook.controller.ts`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/twilio/twilio.webhook.controller.ts) | Eliminated bypass; controller now rejects unauthenticated webhooks with 403 Forbidden. | `twilio.spec.ts` & `twilio-isolation.spec.ts` (passed) |

---

## 2. Full Bug Register Overview (Phase 3 & Phase 3B)

| Bug ID | Title | Priority | Status | Area |
| :--- | :--- | :--- | :--- | :--- |
| **BUG-BE-001** | Inbound Call Ingestion Allows Arbitrary Caller Numbers / Blocklist Bypass | P1 | **RESOLVED** | Validation & Routing |
| **BUG-BE-002** | Twilio Webhook Fail-Open & Legacy Provider Routing | P0 | **RESOLVED & RETIRED** | Provider Isolation |
| **BUG-BE-003** | Webhook Idempotency Lock Deadlock & Concurrency Race | P1 | **RESOLVED & HARDENED** | Reliability & Concurrency |
| **BUG-BE-004** | Phone Number Normalization Discrepancy Across Routing and Blocklist | P2 | **RESOLVED** | Routing & Blocklist |
| **BUG-BE-005** | Premature Call State Transition to COMPLETED Emits Incorrect Webhook Event | P1 | **RESOLVED** | Telephony Callflows |
| **BUG-BE-006** | Public API Controllers Missing Required Permission Decorators | P0 | **RESOLVED** | Authorization & RBAC |
| **BUG-BE-007** | Hardcoded Production Supabase URLs in Authentication Service | P0 | **RESOLVED** | Security & Environment |
| **BUG-BE-008** | Account Takeover Vulnerability via Workspace Invitation Password Reset | P0 | **RESOLVED** | Authentication & Security |
| **BUG-BE-009** | ApiKeysController Missing PermissionsGuard on Key Management Endpoints | P2 | **RESOLVED** | Authorization & RBAC |
| **BUG-BE-010** | Inactive Workspace API Keys Remain Valid for Public API Access | P1 | **RESOLVED** | Tenant Isolation |
| **BUG-BE-011** | QaTestController Missing Authentication Guard on Ingress Endpoints | P1 | **RESOLVED** | Perimeter Security |
| **BUG-BE-012** | Missing destination_number_id Column on call_attempts in Base Schema | P1 | **BLOCKED (AGENT 3)** | Database Schema |
| **BUG-BE-013** | Missing Global ValidationPipe in Main Application Bootstrap | P1 | **RESOLVED** | Request Validation |
| **BUG-BE-014** | Inconsistent dialBuyer Provider Method Signature in Unit Test Mocks | P2 | **RESOLVED** | Telephony Unit Tests |
| **BUG-BE-015** | Missing Pagination Parameters on List Endpoints | P2 | **RESOLVED** | API Scalability |
| **BUG-BE-016** | Inconsistent Permission Requirement on Saved Reports Endpoints | P2 | **RESOLVED** | Authorization & RBAC |
| **BUG-BE-017** | Unused reconcileNumber Method in PhoneNumbersService | P3 | **RESOLVED (AUDITED)** | Carrier Provisioning |
| **BUG-BE-018** | CallController.getCallState Stubs Return Null | P3 | **RESOLVED** | Telephony State Inspection |
