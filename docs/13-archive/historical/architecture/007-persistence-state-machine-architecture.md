# Architecture Decision Record: Persistence and State Machine Architecture

## Title
ADR-007: Persistence and State Machine Architecture

## Status
Accepted

## Context
The routing engine must handle highly asynchronous telephony events (e.g. caller hangups, buyer timeouts, buyer answers). These events can arrive nearly simultaneously via webhooks, causing race conditions. The system must guarantee exactly one active call, one winning buyer, and one authoritative terminal state transition without duplication.

## Decision
* **Persisted Calls and Attempts**: We will split tracking into `calls` (the overall inbound session) and `call_attempts` (the individual dials to specific buyers). A failure on an attempt will trigger the creation of a new attempt for the next sequential buyer, rather than a new `call`.
* **Persisted Idempotency**: Webhook events will be logged into a `webhook_events` table featuring a `UNIQUE(provider, provider_event_id)` constraint to guarantee duplicate webhooks fail to insert and are safely ignored.
* **Atomic State Transitions**:
  * We will use PostgreSQL transactions and row-level locks (`SELECT ... FOR UPDATE`) to prevent race conditions during state transitions.
  * Example: If a Buyer A Timeout webhook and a Buyer A Answer webhook arrive concurrently, the database lock ensures one transaction completes first, updating the state, and the subsequent transaction aborts because the state is no longer valid.

## Consequences
* High reliability and zero duplicate buyer connections.
* Slightly increased latency on webhook processing due to database locking.
* Horizontal scaling is safe.

## Alternatives Considered
* **Redis Locks:** Rejected. We will use Postgres row-level locks initially to keep the infrastructure simple. Redis is explicitly optional and will only be introduced if PostgreSQL lock contention becomes a documented bottleneck.

## Relationship to MVP1_BUILD_SPEC_v5.md
Strictly enforces Section 12 (Call State Machine), Section 13 (Concurrency and Race Protection), and Section 14 (Call vs Call Attempt).
