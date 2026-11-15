# CALLFLOW — STEP 2: BUYER ORGANIZATION & DESTINATION NUMBER FOUNDATION
## Implementation Report

**Execution Date**: November 2026  
**Auditor & Implementation Agent**: Antigravity Core Telephony & Platform Architecture Agent  
**Execution Phase**: Step 2 (Foundation Implementation)  
**Status**: **PASS** (100% verified with automated tests & static validation)  

---

## 1. IMPLEMENTED SCHEMA CHANGES

The schema foundation was implemented in [`apps/api/prisma/schema.prisma`](file:///C:/Projects/callflow-agent-a/apps/api/prisma/schema.prisma) adhering strictly to the approved Step 1 audit decisions:

1. **`Buyer` Organization Model Enrichment**:
   - Added `email String?` to represent corporate contact identity.
   - Added 1:N relation `destination_numbers DestinationNumber[]`.
   - Relaxed legacy columns: `destination_number String? @default("")`, `timeout Int? @default(30)`, `max_concurrent_calls Int? @default(1)` so newly created Buyer Organizations are not constrained to a single phone endpoint while preserving backward compatibility.
2. **`DestinationNumber` New Entity Model**:
   - Created independent entity with:
     - `id String @id @default(uuid())`
     - `workspace_id String`
     - `buyer_id String`
     - `destination_number String` (E.164)
     - `name String?` (label, e.g. "Primary Call Center")
     - `timeout Int @default(30)`
     - `max_concurrent_calls Int @default(1)`
     - `status String @default("ACTIVE")`
     - Timestamps (`created_at`, `updated_at`)
   - Unique constraint: `@@unique([workspace_id, destination_number])`
   - Indexes: `@@index([workspace_id])`, `@@index([buyer_id])`
   - Referential integrity: `onDelete: Cascade` on `workspace` and `buyer`.
3. **`CampaignDestinationNumber` Foundation Model**:
   - Created direct campaign endpoint assignment entity with:
     - `id String @id @default(uuid())`
     - `workspace_id String`
     - `campaign_id String`
     - `destination_number_id String`
     - `priority Int @default(1)`
     - `weight Int @default(100)`
     - `status String @default("ACTIVE")`
     - Timestamps (`created_at`, `updated_at`)
   - Unique constraint: `@@unique([campaign_id, destination_number_id])`
   - Indexes: `@@index([workspace_id])`, `@@index([campaign_id])`, `@@index([destination_number_id])`
4. **`CallAttempt` Historical Dial Snapshot**:
   - Added `destination_number_id String?` linking to `DestinationNumber` (`onDelete: SetNull`).
   - Added `destination_number String?` storing an immutable snapshot of the raw E.164 dialed string.
   - Added index: `@@index([destination_number_id])`.
   - Preserved `buyer_id` for commercial attribution and backward compatibility.
5. **Prisma Client Generation**:
   - Generated Prisma Client v6.19.3 to `node_modules/@prisma/client`.

---

## 2. FILES CHANGED

| File Path | Type | Description |
|---|---|---|
| [`apps/api/prisma/schema.prisma`](file:///C:/Projects/callflow-agent-a/apps/api/prisma/schema.prisma) | Modified | Added `DestinationNumber`, `CampaignDestinationNumber`, `Buyer.email`, `CallAttempt` snapshots and relations. |
| [`apps/api/prisma/migrations/20261107120000_buyer_org_and_destination_number_foundation/migration.sql`](file:///C:/Projects/callflow-agent-a/apps/api/prisma/migrations/20261107120000_buyer_org_and_destination_number_foundation/migration.sql) | Created | Non-destructive, idempotent PostgreSQL DDL migration script. |
| [`apps/api/src/routing/buyers.controller.ts`](file:///C:/Projects/callflow-agent-a/apps/api/src/routing/buyers.controller.ts) | Modified | Updated `create` endpoint to accept `email` and pass to `BuyersService`. |
| [`apps/api/src/routing/buyers.service.ts`](file:///C:/Projects/callflow-agent-a/apps/api/src/routing/buyers.service.ts) | Modified | Enforced `name` and valid `email` on Buyer creation. Added nested `destination_numbers` inclusion on retrieval. |
| [`apps/api/src/routing/destination-numbers.service.ts`](file:///C:/Projects/callflow-agent-a/apps/api/src/routing/destination-numbers.service.ts) | Created | Full CRUD service for independent Destination Numbers with E.164 validation, duplicate protection, and RBAC scoping. |
| [`apps/api/src/routing/destination-numbers.controller.ts`](file:///C:/Projects/callflow-agent-a/apps/api/src/routing/destination-numbers.controller.ts) | Created | REST API endpoints for destination numbers under `/workspaces/:workspaceId/buyers/:buyerId/destination-numbers` and `/workspaces/:workspaceId/destination-numbers`. |
| [`apps/api/src/routing/routing.module.ts`](file:///C:/Projects/callflow-agent-a/apps/api/src/routing/routing.module.ts) | Modified | Registered `DestinationNumbersService` and `DestinationNumbersController`. |
| [`apps/api/src/scripts/backfill-destination-numbers.ts`](file:///C:/Projects/callflow-agent-a/apps/api/src/scripts/backfill-destination-numbers.ts) | Created | Idempotent data migration script for backfilling destination numbers, campaign assignments, attempt snapshots, and member mappings. |
| [`apps/api/src/routing/buyers.service.spec.ts`](file:///C:/Projects/callflow-agent-a/apps/api/src/routing/buyers.service.spec.ts) | Created | Unit tests verifying Buyer Organization creation, email validation, and workspace isolation. |
| [`apps/api/src/routing/destination-numbers.service.spec.ts`](file:///C:/Projects/callflow-agent-a/apps/api/src/routing/destination-numbers.service.spec.ts) | Created | Unit tests for Destination Number creation, E.164 validation, duplicate protection, and status management. |
| [`apps/api/src/scripts/backfill-destination-numbers.spec.ts`](file:///C:/Projects/callflow-agent-a/apps/api/src/scripts/backfill-destination-numbers.spec.ts) | Created | Verification tests for backfill idempotency, multi-buyer mapping preservation, and historical snapshots. |
| [`apps/api/src/routing/routing.spec.ts`](file:///C:/Projects/callflow-agent-a/apps/api/src/routing/routing.spec.ts) | Modified | Updated existing routing test suite to supply required email parameter. |

---

## 3. MIGRATION FILES AND SQL SUMMARY

Migration File: `apps/api/prisma/migrations/20261107120000_buyer_org_and_destination_number_foundation/migration.sql`

```sql
-- 1. Add email column to buyers and relax legacy single-number constraints
ALTER TABLE "buyers" ADD COLUMN IF NOT EXISTS "email" TEXT;
ALTER TABLE "buyers" ALTER COLUMN "destination_number" DROP NOT NULL;
ALTER TABLE "buyers" ALTER COLUMN "destination_number" SET DEFAULT '';
ALTER TABLE "buyers" ALTER COLUMN "timeout" DROP NOT NULL;
ALTER TABLE "buyers" ALTER COLUMN "timeout" SET DEFAULT 30;
ALTER TABLE "buyers" ALTER COLUMN "max_concurrent_calls" DROP NOT NULL;
ALTER TABLE "buyers" ALTER COLUMN "max_concurrent_calls" SET DEFAULT 1;

-- 2. Create destination_numbers table
CREATE TABLE IF NOT EXISTS "destination_numbers" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "buyer_id" TEXT NOT NULL,
    "destination_number" TEXT NOT NULL,
    "name" TEXT,
    "timeout" INTEGER NOT NULL DEFAULT 30,
    "max_concurrent_calls" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "destination_numbers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "destination_numbers_workspace_id_destination_number_key" ON "destination_numbers"("workspace_id", "destination_number");
CREATE INDEX IF NOT EXISTS "destination_numbers_workspace_id_idx" ON "destination_numbers"("workspace_id");
CREATE INDEX IF NOT EXISTS "destination_numbers_buyer_id_idx" ON "destination_numbers"("buyer_id");

-- Foreign key constraints with IF NOT EXISTS guard
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'destination_numbers_workspace_id_fkey') THEN
        ALTER TABLE "destination_numbers" ADD CONSTRAINT "destination_numbers_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'destination_numbers_buyer_id_fkey') THEN
        ALTER TABLE "destination_numbers" ADD CONSTRAINT "destination_numbers_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "buyers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- 3. Create campaign_destination_numbers table
CREATE TABLE IF NOT EXISTS "campaign_destination_numbers" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "destination_number_id" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 1,
    "weight" INTEGER NOT NULL DEFAULT 100,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "campaign_destination_numbers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "campaign_destination_numbers_campaign_id_destination_number_id_key" ON "campaign_destination_numbers"("campaign_id", "destination_number_id");
CREATE INDEX IF NOT EXISTS "campaign_destination_numbers_workspace_id_idx" ON "campaign_destination_numbers"("workspace_id");
CREATE INDEX IF NOT EXISTS "campaign_destination_numbers_campaign_id_idx" ON "campaign_destination_numbers"("campaign_id");
CREATE INDEX IF NOT EXISTS "campaign_destination_numbers_destination_number_id_idx" ON "campaign_destination_numbers"("destination_number_id");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campaign_destination_numbers_workspace_id_fkey') THEN
        ALTER TABLE "campaign_destination_numbers" ADD CONSTRAINT "campaign_destination_numbers_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campaign_destination_numbers_campaign_id_fkey') THEN
        ALTER TABLE "campaign_destination_numbers" ADD CONSTRAINT "campaign_destination_numbers_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campaign_destination_numbers_destination_number_id_fkey') THEN
        ALTER TABLE "campaign_destination_numbers" ADD CONSTRAINT "campaign_destination_numbers_destination_number_id_fkey" FOREIGN KEY ("destination_number_id") REFERENCES "destination_numbers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- 4. Add destination snapshot columns to call_attempts
ALTER TABLE "call_attempts" ADD COLUMN IF NOT EXISTS "destination_number_id" TEXT;
ALTER TABLE "call_attempts" ADD COLUMN IF NOT EXISTS "destination_number" TEXT;

CREATE INDEX IF NOT EXISTS "call_attempts_destination_number_id_idx" ON "call_attempts"("destination_number_id");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'call_attempts_destination_number_id_fkey') THEN
        ALTER TABLE "call_attempts" ADD CONSTRAINT "call_attempts_destination_number_id_fkey" FOREIGN KEY ("destination_number_id") REFERENCES "destination_numbers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
```

**Critical PostgreSQL Validation**: In Supabase PostgreSQL, all primary and foreign key IDs across `workspaces`, `buyers`, `campaigns`, and `call_attempts` are typed as `TEXT` (not `UUID`). The migration explicitly uses `TEXT` to prevent type mismatch errors.

---

## 4. BACKFILL STRATEGY AND EXECUTION STATUS

The backfill script is implemented in [`apps/api/src/scripts/backfill-destination-numbers.ts`](file:///C:/Projects/callflow-agent-a/apps/api/src/scripts/backfill-destination-numbers.ts):
- **Step 1 (Destination Numbers)**: For each `Buyer`, creates a corresponding `DestinationNumber` record using `destination_number`, preserving `timeout`, `max_concurrent_calls`, and `status`. Skips existing records via `findUnique({ workspace_id_destination_number })`.
- **Step 2 (Campaign Assignments)**: For each `CampaignBuyer`, creates a corresponding `CampaignDestinationNumber` record linking `campaign_id` to the buyer's `DestinationNumber.id`, preserving `priority` and `status`.
- **Step 3 (Historical Snapshots)**: For each `CallAttempt` missing `destination_number`, writes the immutable string snapshot from `buyer.destination_number` and sets `destination_number_id`.
- **Step 4 (Member Preservation)**: Inspects `WorkspaceMemberBuyer`. Safely links single-buyer members directly to `WorkspaceMember.buyer_id` while preserving all `WorkspaceMemberBuyer` join rows for multi-buyer accounts.
- **Idempotency Guarantee**: Tested in unit test `backfill-destination-numbers.spec.ts`. Running the script twice creates 0 duplicate records.

---

## 5. SUPABASE MIGRATION STATUS

- **Pre-Implementation Verification**:
  - Live Supabase connection established via pooler (`aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres`).
  - Cataloged current data: 3 Buyers, 1 WorkspaceMemberBuyer, 4 CampaignBuyers, 75 CallAttempts.
  - Zero duplicate numbers in Supabase.
- **Phase E Compliance**:
  - In strict compliance with Phase E instructions ("*Do not apply a production Supabase migration without explicit approval of the migration plan*"), the migration SQL is **STAGED AND VALIDATED**.
  - Ready for immediate remote execution upon user approval.

---

## 6. MEMBER MAPPING ANALYSIS (MULTI-BUYER MEMBERS)

- **Audit Findings in Supabase Database**:
  - Total `workspace_members`: 6
  - Total `workspace_member_buyers`: 1
  - **Members with multiple buyers in production**: **0**
  - **Single-buyer members**: 1 (`219769fc-66ae-4994-a468-41b39163a0f2` mapped to Buyer `574f9d10-1a3e-4455-bf40-ef0a80bb4e01`).
- **Safe Transitional Mapping**:
  - `WorkspaceMemberBuyer` join table is **retained and not dropped**.
  - `WorkspaceMember.buyer_id` is populated for single-buyer users.
  - In `DestinationNumbersService` and `BuyersService`, RBAC checks query both `WorkspaceMemberBuyer` join table and direct `buyer_id` to ensure zero member access is lost during transition.

---

## 7. API CHANGES

1. `POST /workspaces/:workspaceId/buyers`:
   - Requires `name` (string) and `email` (valid email address).
   - Rejects missing email with `400 Bad Request: "Buyer Organization email is required."`.
   - Rejects invalid email format with `400 Bad Request: "Invalid email format for Buyer Organization."`.
   - Optional `destinationNumber` (if provided, creates initial `DestinationNumber` under the new organization).
2. `GET /workspaces/:workspaceId/buyers` and `GET /workspaces/:workspaceId/buyers/:id`:
   - Returns Buyer details enriched with `destination_numbers: DestinationNumber[]`.
3. `POST /workspaces/:workspaceId/buyers/:buyerId/destination-numbers`:
   - Creates independent destination number for the specified buyer.
   - Requires `destinationNumber` (E.164 normalized).
   - Rejects cross-workspace buyer IDs (`404 Not Found`).
   - Rejects duplicate destination numbers in the workspace (`409 Conflict`).
4. `GET /workspaces/:workspaceId/buyers/:buyerId/destination-numbers`:
   - Returns all destination numbers owned by the buyer.
5. `GET /workspaces/:workspaceId/destination-numbers`:
   - Lists workspace-wide destination numbers with search and pagination.
6. `GET /workspaces/:workspaceId/destination-numbers/:id`:
   - Retrieves single destination number.
7. `PUT/PATCH /workspaces/:workspaceId/destination-numbers/:id`:
   - Updates `name`, `timeout`, `maxConcurrentCalls`, or `status`.
8. `POST /workspaces/:workspaceId/destination-numbers/:id/archive`:
   - Sets status to `INACTIVE`.
9. `POST /workspaces/:workspaceId/destination-numbers/:id/activate`:
   - Sets status to `ACTIVE`.
10. `DELETE /workspaces/:workspaceId/destination-numbers/:id`:
    - Deletes destination number entity (call attempts set to null, preserving historical string snapshot).

---

## 8. RBAC AND TENANT ISOLATION VALIDATION

- Every endpoint is guarded by `JwtAuthGuard`, `WorkspaceRolesGuard`, and `PermissionsGuard`.
- Destination Number mutations (`create`, `update`, `archive`, `activate`, `delete`) require `WorkspaceRole.OWNER` or `WorkspaceRole.ADMIN` and permission `buyer:update`.
- Tenant isolation is enforced:
  - All queries filter on `workspace_id: workspaceId`.
  - Associating a destination number with a buyer belonging to another workspace is blocked (`404 Not Found`).
  - Read queries for restricted users (`ASSIGNED`) scope to allowed buyer organizations only.

---

## 9. TEST RESULTS WITH EXACT COMMANDS

### Test Command 1: Step 2 Core & Backfill Test Suites
```bash
npx --prefix apps/api vitest run \
  src/routing/buyers.service.spec.ts \
  src/routing/destination-numbers.service.spec.ts \
  src/scripts/backfill-destination-numbers.spec.ts \
  src/routing/routing.spec.ts
```

**Output**:
```
 ✓ apps/api/src/routing/routing.spec.ts (6 tests) 1271ms
 ✓ apps/api/src/routing/destination-numbers.service.spec.ts (8 tests) 1869ms
 ✓ apps/api/src/routing/buyers.service.spec.ts (7 tests) 1492ms
 ✓ apps/api/src/scripts/backfill-destination-numbers.spec.ts (5 tests) 24ms

 Test Files  4 passed (4)
      Tests  26 passed (26)
   Duration  9.31s
```

### Test Command 2: Commercial Suite Integrity Verification
```bash
npx --prefix apps/api vitest run src/commercial/
```

**Output**:
```
 ✓ apps/api/src/commercial/commercial-disputes.spec.ts (50 tests) 1713ms
 ✓ apps/api/src/commercial/commercial-finalization.spec.ts (10 tests) 1371ms
 ✓ apps/api/src/commercial/commercial-evaluator.spec.ts (85 tests) 1661ms

 Test Files  3 passed (3)
      Tests  145 passed (145)
   Duration  12.52s
```

---

## 10. COMMERCIAL INTEGRITY VERIFICATION

- Zero modifications were made to `CallCommercial`, `CallDispute`, `SettlementBatch`, or `SettlementItem` schemas.
- No commercial evaluator logic or settlement workflow code was altered.
- All 145 commercial evaluator, financial finalization, and dispute tests passed with 100% success.

---

## 11. KNOWN LIMITATIONS & STEP 3 HANDOFF

- Live telephony routing ([`call-controller.ts`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/call-controller.ts) and [`calls.service.ts`](file:///C:/Projects/callflow-agent-a/apps/api/src/calls/calls.service.ts)) continues to route calls via `CampaignBuyer` until the routing migration phase.
- Frontend UI components for Destination Numbers will be implemented in the designated UI phase.
- Production Supabase database migration is staged pending explicit user authorization.

---

## 12. ROLLBACK AND RECOVERY STRATEGY

Because the schema changes are purely additive:
- Legacy columns (`buyers.destination_number`, `buyers.timeout`, `buyers.max_concurrent_calls`) and legacy join table `workspace_member_buyers` remain fully functional.
- In the event of rollback, dropping the new tables (`destination_numbers`, `campaign_destination_numbers`) and snapshot columns does not alter or damage any existing business data.

---

## 13. PHASE STATUS

**STEP 2 FOUNDATION IMPLEMENTATION: PASS**  

*All Step 2 foundation criteria have been met. Execution is stopped as required by protocol. Awaiting explicit user approval before proceeding to Step 3.*
