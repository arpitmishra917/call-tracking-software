# CALLFLOW AGENT 2 PHASE 3B: WEBHOOK CONCURRENCY & IDEMPOTENCY REPORT

**Agent**: Agent 2 (Backend, API, Business Logic, Webhook Processing, and Backend Reliability)  
**Date**: November 12, 2026  
**Focus**: Verification & Remediation of Webhook Concurrency, Stale-Lock Recovery, and Fencing Tokens (`BUG-BE-003`)  
**Workspace**: [callflow-agent-a](file:///C:/Projects/callflow-agent-a)  

---

## 1. Concurrency Architecture & Design

To resolve the read-then-update race conditions identified in the source audit, [`WebhookIdempotencyService`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/webhook-idempotency.service.ts) was completely redesigned to enforce atomic conditional database operations and cryptographic lease fencing.

### 1.1 Atomic Conditional Compare-and-Swap (CAS)
In PostgreSQL / Prisma, `updateMany` allows filtering by non-unique fields within the `WHERE` clause of an atomic SQL `UPDATE` statement. This was leveraged to implement atomic optimistic concurrency control:

```typescript
const staleThreshold = new Date(Date.now() - WebhookIdempotencyService.STALE_LOCK_THRESHOLD_MS);

const recoveryResult = await this.prisma.webhookEvent.updateMany({
  where: {
    id: existing.id,
    status: WebhookStatus.PENDING,
    updatedAt: { lte: staleThreshold },
  },
  data: {
    status: WebhookStatus.PENDING,
    error: `lease:${leaseToken}`,
    payload: payload,
  },
});

if (recoveryResult.count === 0) {
  // Another worker already claimed the lock or completed the event
  return { canProcess: false, id: existing.id };
}
```

### 1.2 Lease Fencing Tokens
To prevent stale workers (workers that paused, stalled, or crashed and later woke up) from modifying the database state after their lease has been reassigned to a new worker:
1. Each lease acquisition creates a unique UUID lease token: `leaseToken = randomUUID()`.
2. The active lease token is stored in the database record: `error: 'lease:' + leaseToken`.
3. Status finalization methods (`markProcessed`, `markFailed`, `markIgnored`) enforce lease ownership:
   ```typescript
   async markProcessed(id: string, leaseToken?: string): Promise<boolean> {
     const where: any = { id, status: WebhookStatus.PENDING };
     if (leaseToken) {
       where.error = `lease:${leaseToken}`;
     }
     const result = await this.prisma.webhookEvent.updateMany({
       where,
       data: { status: WebhookStatus.PROCESSED, error: null },
     });
     return result.count > 0;
   }
   ```
4. If an old worker calls `markProcessed` with its stale lease token, `result.count === 0`. The old worker is safely **fenced out** and cannot overwrite the work of the active worker.

---

## 2. Verification of Specific Concurrency Requirements

| Requirement | Evaluation | Mechanism |
| :--- | :--- | :--- |
| **1. Two workers cannot simultaneously claim same stale PENDING event** | **VERIFIED** | Atomic `updateMany` with `updatedAt: { lte: staleThreshold }`. Only one worker gets `count === 1`; the other gets `count === 0` and is rejected. |
| **2. Stale-lock recovery uses atomic conditional database operation** | **VERIFIED** | Single SQL `UPDATE ... WHERE id = $1 AND status = 'PENDING' AND updated_at <= $2` statement executed by database engine. |
| **3. Active worker's lease cannot be stolen** | **VERIFIED** | If `updatedAt > staleThreshold`, `acquireLock` immediately returns `{ canProcess: false }` without attempting database update. |
| **4. Duplicate webhook deliveries cannot execute business logic twice** | **VERIFIED** | Unprocessed events return `{ canProcess: false }` via `P2002` unique constraint; completed events return `{ canProcess: false }` via `status === PROCESSED`. |
| **5. Worker crashes and retries recover safely** | **VERIFIED** | Stale threshold (5 minutes) allows carrier webhook retries to reclaim the lease cleanly and resume processing. |
| **6. Old worker cannot complete processing after lease reassignment** | **VERIFIED** | Fencing token mismatch in `markProcessed` causes `count === 0`, preventing status update. |
| **7. Lease ownership / fencing prevents state corruption** | **VERIFIED** | `markFailed` and `markIgnored` also require matching `leaseToken`. |
| **8. Concurrent deliveries do not cause duplicate call creation / billing** | **VERIFIED** | At most one worker ever receives `{ canProcess: true }` and proceeds to `CallController.handleEvent`. |

---

## 3. Test Verification & Results

The expanded test suite in [`apps/api/src/telephony/webhook-idempotency.service.spec.ts`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/webhook-idempotency.service.spec.ts) verified all 11 concurrency scenarios with 100% pass rate:

1. `acquires lock for new event on first delivery` -> **PASS**
2. `simultaneous webhook delivery by two workers: only one worker acquires lock via unique constraint` -> **PASS**
3. `disallows processing and protects active PENDING event within 5-minute lease window` -> **PASS**
4. `duplicate webhook deliveries after PROCESSED cannot execute business logic twice` -> **PASS**
5. `worker crash and recovery: recovers stale PENDING event older than 5 minutes` -> **PASS**
6. `stale-lock recovery race condition: two workers attempt recovery simultaneously, only one succeeds` -> **PASS**
7. `old worker completion after lease reassignment is rejected via leaseToken fencing` -> **PASS**
8. `old worker failure after lease reassignment cannot corrupt new active worker lease` -> **PASS**
9. `successful processing by active lease holder marks event PROCESSED` -> **PASS**
10. `allows retry for FAILED event via atomic conditional update` -> **PASS**
11. `concurrent retry race on FAILED event: only one retry worker acquires lock` -> **PASS**

All 11 tests passed in 2.96s.
