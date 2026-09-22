# Architecture Decision Record: POC Reuse Boundaries

## Title
ADR-006: POC Reuse Boundaries

## Status
Accepted

## Context
A validated Telephony Proof of Concept (POC) exists in the repository. It proves the routing mechanics, webhook ingestion, and provider SDK integrations for Telnyx and Twilio. We must define exactly what will be reused and what must be discarded in the transition to the MVP1 production environment.

## Decision
**To Be Reused (Ported):**
* The conceptual `TelephonyProvider` contract (`answerCall`, `dialBuyer`, `bridgeCalls`, `hangupCall`).
* The normalized internal event dictionary (`CALL_INITIATED`, `CALL_ANSWERED`, etc.).
* Telnyx signature verification logic utilizing `client.webhooks.unwrap()`.
* Twilio native `<Conference>` XML generation logic for bridging audio.
* Twilio signature validation logic.

**To Be Rewritten (Not Reused):**
* **In-Memory Call State**: The `callController.js` Map object must be discarded. In-memory state is transient, destroyed on server restart, and impossible to scale horizontally across instances. It will be replaced by database-backed atomic state machines.
* **In-Memory Webhook Idempotency**: The `webhookHandler.js` Set object must be discarded for the same reasons. We will use a unique `webhook_events` PostgreSQL table to enforce exactly-once processing.
* **Hardcoded Environments**: Direct references to `.env.BUYER_A_NUMBER` will be replaced by dynamic database queries resolving campaigns to prioritized buyers.
* **Raw Express Architecture**: The raw Express CommonJS codebase will not be augmented. It will remain strictly as a reference folder while the new TypeScript NestJS Monorepo is scaffolded.

## Consequences
* We preserve the hardest-won knowledge (Twilio audio bridging hacks, Telnyx raw body signature parsing) without importing technical debt (in-memory unscalable state) into production.

## Alternatives Considered
* **Blindly converting POC to TS:** Rejected. The POC architecture explicitly violates the state machine durability requirement detailed in Section 13.

## Relationship to MVP1_BUILD_SPEC_v5.md
Strictly enforces Section 3 (Current POC Handoff) and Section 3.2 (POC Reuse Rule).
