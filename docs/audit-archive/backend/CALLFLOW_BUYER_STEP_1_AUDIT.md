# CALLFLOW — STEP 1: BUYER & DESTINATION NUMBER FOCUSED ARCHITECTURE AUDIT

**Audit Date**: November 2026  
**Auditor**: Antigravity Core Telephony & Platform Architecture Agent  
**Audit Mode**: STRICT READ-ONLY — NO MUTATIONS / NO IMPLEMENTATION  
**Canonical Database**: Remote Supabase PostgreSQL (`aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres`)  
**Status**: COMPLETE — AUDIT PASS  

---

## EXECUTIVE SUMMARY

This forensic architecture audit provides the complete technical blueprint for redesigning the CallFlow Buyer and Destination Number architecture. 

Currently, CallFlow conflates **Buyer organizations** with **individual phone numbers**:
1. The `Buyer` database model stores an individual phone number (`destination_number String`) directly on the Buyer record.
2. The `Buyer` model has no `email` column, preventing a Buyer organization from having direct corporate contact/identity attributes upon creation.
3. To work around this 1:1 number restriction, a many-to-many bridge table (`WorkspaceMemberBuyer`) was implemented to stitch together multiple "Buyers" (which are functionally just destination numbers) under a single invited user account.
4. `CallAttempt` records store `buyer_id` but **do not store a snapshot of the dialed destination number**. If an administrator updates `Buyer.destination_number`, all historical reporting for dialed numbers is retroactively corrupted.

By contrast, CallFlow's **Vendor architecture** already implements the correct organizational separation:
- `Vendor` is an independent corporate entity (`id`, `workspace_id`, `name`, `status`).
- `PhoneNumber` (inbound DID) is an independent entity linking to `vendor_id` and `campaign_id` (`1 Vendor : N PhoneNumbers`).
- `WorkspaceMember` points directly to `vendor_id` (1:1), granting a vendor user immediate, automatic access to all phone numbers and inbound calls for their company without join-table overhead.

This audit details the exact migration path to align the Buyer architecture with the proven Vendor model, enabling:
- **Independent Destination Numbers** (`1 Buyer : N DestinationNumbers`).
- **Independent Buyer Organizations** with `name`, `email`, and organizational metadata.
- **Campaign-level Destination Number Assignment** (`CampaignDestinationNumber` waterfall).
- **Direct Workspace Member Scoping** (`WorkspaceMember.buyer_id`), where one invitation unlocks all destination numbers for that Buyer.
- **Combined and Granular Destination Number Reporting** with immutable `CallAttempt` destination snapshotting.

---

## 1. CURRENT ARCHITECTURE

### 1.1 Structural Defect: Conflation of Buyer and Phone Number
In `apps/api/prisma/schema.prisma` (lines 750–772):
```prisma
model Buyer {
  id                   String                 @id @default(uuid())
  workspace_id         String
  name                 String
  destination_number   String                 // <--- Single phone number tied directly to Buyer identity
  timeout              Int                    @default(30)
  max_concurrent_calls Int                    @default(1)
  status               BuyerStatus            @default(ACTIVE)
  created_at           DateTime               @default(now())
  updated_at           DateTime               @updatedAt
  // No email column!
  ...
}
```
Because `destination_number` is a non-null string directly on `Buyer`, a "Buyer" in the current system cannot represent a corporate entity with multiple endpoints, call centers, or hunt-group numbers. Each phone number requires creating a distinct `Buyer` entity.

### 1.2 The Workaround: `WorkspaceMemberBuyer` Join Table
Because one real-world buyer client often needs multiple numbers, the system added `WorkspaceMemberBuyer` (schema.prisma lines 1121–1132):
```prisma
model WorkspaceMemberBuyer {
  id                  String          @id @default(uuid())
  workspace_member_id String
  buyer_id            String
  created_at          DateTime        @default(now())
  workspace_member    WorkspaceMember @relation(...)
  buyer               Buyer           @relation(...)
  @@unique([workspace_member_id, buyer_id])
}
```
This forces a complex, manual administration workflow:
1. Admin creates "Buyer 1 (NY Office)" with number `+1555001`.
2. Admin creates "Buyer 2 (CA Office)" with number `+1555002`.
3. Admin invites user `client@acmecorp.com`.
4. Admin manually executes multiple `POST /workspaces/:id/members/:memberId/buyers` calls to attach each Buyer record.
5. If the admin later adds "Buyer 3", the user does not see it until another manual join record is inserted.

### 1.3 Campaign Assignment via `CampaignBuyer`
In `apps/api/prisma/schema.prisma` (lines 774–791):
```prisma
model CampaignBuyer {
  id          String   @id @default(uuid())
  campaign_id String
  buyer_id    String
  priority    Int      @default(1)
  weight      Int      @default(100)
  created_at  DateTime @default(now())
  updated_at  DateTime @updatedAt
  campaign    Campaign @relation(...)
  buyer       Buyer    @relation(...)
  @@unique([campaign_id, buyer_id])
}
```
Campaigns assign `Buyer` entities rather than destination numbers. Because a Buyer is 1:1 with a number, waterfall prioritization cannot separate priority by endpoint within a buyer.

### 1.4 Call Routing & Telephony Execution
In `apps/api/src/telephony/call-controller.ts` (lines 740–770) and `apps/api/src/calls/calls.service.ts` (`prepareNextBuyer`, lines 2027–2080):
- Router queries active `campaign_buyers` ordered by `priority ASC`.
- Router reads `cb.buyer.destination_number` to form the Telnyx outbound dial payload (`DialDestinationNumber`).
- Concurrency checks (`max_concurrent_calls`) count active calls where `buyer_id == buyer.id`.

### 1.5 The Audit Trail & Reporting Defect (`CallAttempt`)
In `apps/api/prisma/schema.prisma` (lines 872–900):
```prisma
model CallAttempt {
  id              String      @id @default(uuid())
  call_id         String
  buyer_id        String?     // Links to Buyer
  // MISSING: destination_number String snapshot!
  // MISSING: destination_number_id UUID!
  state           String
  started_at      DateTime
  ended_at        DateTime?
  duration_seconds Int?
  ...
}
```
In `apps/web/src/app/protected/reporting/page.tsx` (lines 100–125), `getFinalDestinationDisplay` falls back to `attempt.buyer.destination_number`. If an administrator edits a Buyer's phone number today, **historical reports for calls made 6 months ago dynamically change to display the new number**.

---

## 2. PROPOSED ARCHITECTURE

```
                               ┌────────────────────────────────┐
                               │           Workspace            │
                               └───────────────┬────────────────┘
                                               │ 1
                                               │
                       ┌───────────────────────┴───────────────────────┐
                       │ *                                             │ *
        ┌──────────────▼─────────────┐                  ┌──────────────▼─────────────┐
        │           Buyer            │                  │          Campaign          │
        │   (Independent Org)        │                  └──────────────┬─────────────┘
        │                            │                                 │ 1
        │ - id                       │                                 │
        │ - workspace_id             │                                 │
        │ - name                     │                                 │
        │ - email                    │                                 │
        │ - status (ACTIVE/INACTIVE) │                                 │
        └──────────────┬─────────────┘                                 │
                       │ 1                                             │
                       │                                               │
                       │ *                                             │
        ┌──────────────▼─────────────┐                                 │
        │     DestinationNumber      │                                 │
        │   (Independent Endpoint)   │                                 │
        │                            │                                 │
        │ - id                       │                                 │
        │ - workspace_id             │                                 │
        │ - buyer_id                 │                                 │
        │ - destination_number (E164)│                                 │
        │ - name / label             │                                 │
        │ - timeout (seconds)        │                                 │
        │ - max_concurrent_calls     │                                 │
        │ - status (ACTIVE/INACTIVE) │                                 │
        └───────▲────────────▲───────┘                                 │
                │ 1          │ 1                                       │
                │            │                                         │
                │ *          │ *                                       │ *
┌───────────────┴────┐   ┌───┴────────────────────────────┐    ┌───────▼────────────────────────┐
│    CallAttempt     │   │   CampaignDestinationNumber    │◄───┤ (replaces CampaignBuyer        │
│                    │   │   (Routing Waterfall)          │    │  for granular routing)         │
│ - destination_num_ │   │                                │    └────────────────────────────────┘
│   id (UUID)        │   │ - campaign_id                  │
│ - destination_num  │   │ - destination_number_id        │
│   (E.164 snapshot) │   │ - priority                     │
│ - buyer_id (UUID)  │   │ - weight                       │
└────────────────────┘   │ - status                       │
                         └────────────────────────────────┘
```

### 2.1 Core Architectural Principles
1. **Buyers are Organizations**:
   - `Buyer` represents the legal or corporate client organization.
   - Includes `name` and contact `email` (collected at creation time).
   - Has no direct phone number string.
2. **Destination Numbers are Independent Entities**:
   - Model `DestinationNumber` stores each termination endpoint.
   - Belongs to a `Buyer` (`1 Buyer : N DestinationNumbers`).
   - Owns endpoint routing properties: `destination_number` (E.164), `timeout`, `max_concurrent_calls`, `status`.
3. **Campaigns Assign Destination Numbers**:
   - `CampaignDestinationNumber` maps `campaign_id` to `destination_number_id` with `priority` and `weight`.
   - Allows fine-grained waterfall control (e.g., routing to Buyer A's Tier 1 line first, then Buyer B's line, then Buyer A's overflow line).
4. **Unified Buyer Member Access (Vendor Analogy)**:
   - `WorkspaceMember` contains a direct `buyer_id` foreign key (matching `WorkspaceMember.vendor_id`).
   - `WorkspaceInvitation` contains a direct `buyer_id` foreign key.
   - When a user accepts an invitation for a Buyer, they automatically have access to all `DestinationNumbers` belonging to that Buyer, plus all calls/attempts sent to those numbers.
   - `WorkspaceMemberBuyer` join table is eliminated.
5. **Immutable Historical Snapshotting**:
   - `CallAttempt` snapshots both `destination_number_id` (reference) and `destination_number` (raw E.164 string at dial time).
   - Preserves 100% forensic accuracy across configuration edits.

---

## 3. EXACT AFFECTED FILES

### Backend (`apps/api`)
| File Path | Description of Required Change |
|---|---|
| `apps/api/prisma/schema.prisma` | Define `DestinationNumber`, update `Buyer` (add `email`, remove `destination_number`, `timeout`, `max_concurrent_calls`), add `CampaignDestinationNumber`, update `WorkspaceMember` and `WorkspaceInvitation` to include direct `buyer_id`, update `CallAttempt` with destination snapshots. |
| `apps/api/src/routing/buyers.controller.ts` | Update validation: accept `email` in POST `/buyers`, remove single destination number requirement. Add endpoints for buyer destination numbers or manage via sub-resource. |
| `apps/api/src/routing/buyers.service.ts` | Update `createBuyer` to record `email`. Update `findAll` and `findOne` to include nested `destination_numbers`. |
| `apps/api/src/routing/dto/create-buyer.dto.ts` | Add `@IsEmail() email: string`, remove `@IsPhoneNumber() destinationNumber`. |
| `apps/api/src/routing/dto/update-buyer.dto.ts` | Allow updating buyer `name`, `email`, `status`. |
| `apps/api/src/destination-numbers/*` *(NEW)* | Create `DestinationNumbersModule`, `Controller`, `Service`, and DTOs for full CRUD on destination numbers (`GET`, `POST`, `PATCH`, `DELETE`). |
| `apps/api/src/campaigns/campaigns.controller.ts` | Update campaign destination number assignment endpoints (`POST /campaigns/:id/destination-numbers`, `DELETE ...`). |
| `apps/api/src/campaigns/campaigns.service.ts` | Replace/augment `assignBuyer` with `assignDestinationNumber`. Waterfall queries load `destination_number` endpoints. |
| `apps/api/src/campaigns/dto/campaign-buyer.dto.ts` | Create `campaign-destination-number.dto.ts` accepting `destinationNumberId`, `priority`, `weight`. |
| `apps/api/src/calls/calls.service.ts` | Update `prepareNextBuyer`: query next `CampaignDestinationNumber`, snapshot `destination_number` onto `CallAttempt`, evaluate concurrency against `destination_number_id`. |
| `apps/api/src/telephony/call-controller.ts` | Dial `destination_number.destination_number` instead of `buyer.destination_number`. |
| `apps/api/src/commercial/commercial-evaluator.service.ts` | Resolve `buyer_id` via `attempt.destination_number.buyer_id` (or direct snapshot) for commercial revenue assignment. |
| `apps/api/src/workspaces/workspaces.service.ts` | Simplify `inviteMember`: accept `buyerId` directly onto `WorkspaceInvitation`. In `acceptInvitation`: write `buyer_id` directly to `WorkspaceMember`. Remove `attachBuyerToMember` / `WorkspaceMemberBuyer`. |
| `apps/api/src/workspaces/workspaces.controller.ts` | Deprecate multi-buyer join endpoints; expose direct `buyer_id` assignment on member creation/invitation. |
| `apps/api/src/reporting/reporting.service.ts` | Support filtering calls/attempts by `buyer_id` (all numbers) or by specific `destination_number_id`. Return `destination_number` snapshot in attempt records. |

### Frontend (`apps/web`)
| File Path | Description of Required Change |
|---|---|
| `apps/web/src/app/protected/buyers/page.tsx` | Update table to show Buyer Name, Email, Number of Destination Numbers, Status. Create dialog asks for `name` and `email` (destination numbers configured separately or in sub-form). |
| `apps/web/src/app/protected/buyers/[buyerId]/page.tsx` | Show Buyer Organization details, email, and a dedicated data table of assigned Destination Numbers (`+ Add Destination Number`, status toggles, timeout, concurrency). |
| `apps/web/src/app/protected/campaigns/[campaignId]/page.tsx` | Change "Assign Buyer" dialog to "Assign Destination Number", displaying Buyer Organization + Number label (e.g. `Acme Corp - Main Line (+15551234567)`). |
| `apps/web/src/app/protected/members/page.tsx` | Simplify Member invite dialog: when selecting `Role: BUYER`, provide single dropdown of Buyer organizations (matching Vendor dropdown). |
| `apps/web/src/app/protected/reporting/page.tsx` | Add filter for Destination Number alongside Buyer filter. Update `getFinalDestinationDisplay` to read `attempt.destination_number` snapshot directly. |

---

## 4. CURRENT VS PROPOSED DATABASE MODELS

### 4.1 Current Prisma Models
```prisma
model Buyer {
  id                   String                 @id @default(uuid())
  workspace_id         String
  name                 String
  destination_number   String
  timeout              Int                    @default(30)
  max_concurrent_calls Int                    @default(1)
  status               BuyerStatus            @default(ACTIVE)
  created_at           DateTime               @default(now())
  updated_at           DateTime               @updatedAt
  campaign_buyers      CampaignBuyer[]
  call_attempts        CallAttempt[]
  call_commercials     CallCommercial[]
  workspace_members    WorkspaceMemberBuyer[]
  workspace            Workspace              @relation(...)
  @@map("buyers")
}

model CampaignBuyer {
  id          String   @id @default(uuid())
  campaign_id String
  buyer_id    String
  priority    Int      @default(1)
  weight      Int      @default(100)
  created_at  DateTime @default(now())
  updated_at  DateTime @updatedAt
  campaign    Campaign @relation(...)
  buyer       Buyer    @relation(...)
  @@unique([campaign_id, buyer_id])
  @@map("campaign_buyers")
}

model WorkspaceMemberBuyer {
  id                  String          @id @default(uuid())
  workspace_member_id String
  buyer_id            String
  created_at          DateTime        @default(now())
  workspace_member    WorkspaceMember @relation(...)
  buyer               Buyer           @relation(...)
  @@unique([workspace_member_id, buyer_id])
  @@map("workspace_member_buyers")
}
```

### 4.2 Proposed Prisma Models
```prisma
model Buyer {
  id                   String                 @id @default(uuid())
  workspace_id         String
  name                 String
  email                String?                // Buyer contact email
  status               BuyerStatus            @default(ACTIVE)
  created_at           DateTime               @default(now())
  updated_at           DateTime               @updatedAt
  destination_numbers  DestinationNumber[]
  workspace_members    WorkspaceMember[]      // Direct 1:N relationship!
  workspace_invitations WorkspaceInvitation[] // Direct 1:N relationship!
  call_commercials     CallCommercial[]
  workspace            Workspace              @relation(fields: [workspace_id], references: [id], onDelete: Cascade)

  @@index([workspace_id])
  @@map("buyers")
}

model DestinationNumber {
  id                   String                      @id @default(uuid())
  workspace_id         String
  buyer_id             String
  destination_number   String                      // E.164 format: e.g. +15551234567
  name                 String?                     // Friendly label: e.g. "Primary Call Center"
  timeout              Int                         @default(30)
  max_concurrent_calls Int                         @default(1)
  status               BuyerStatus                 @default(ACTIVE)
  created_at           DateTime                    @default(now())
  updated_at           DateTime                    @updatedAt
  buyer                Buyer                       @relation(fields: [buyer_id], references: [id], onDelete: Cascade)
  workspace            Workspace                   @relation(fields: [workspace_id], references: [id], onDelete: Cascade)
  campaign_assignments CampaignDestinationNumber[]
  call_attempts        CallAttempt[]

  @@unique([workspace_id, destination_number])
  @@index([workspace_id])
  @@index([buyer_id])
  @@map("destination_numbers")
}

model CampaignDestinationNumber {
  id                    String            @id @default(uuid())
  campaign_id           String
  destination_number_id String
  priority              Int               @default(1)
  weight                Int               @default(100)
  status                BuyerStatus       @default(ACTIVE)
  created_at            DateTime          @default(now())
  updated_at            DateTime          @updatedAt
  campaign              Campaign          @relation(fields: [campaign_id], references: [id], onDelete: Cascade)
  destination_number    DestinationNumber @relation(fields: [destination_number_id], references: [id], onDelete: Cascade)

  @@unique([campaign_id, destination_number_id])
  @@index([campaign_id])
  @@index([destination_number_id])
  @@map("campaign_destination_numbers")
}

model CallAttempt {
  id                    String             @id @default(uuid())
  call_id               String
  buyer_id              String?            // Retained for fast org query
  destination_number_id String?            // Reference to DestinationNumber entity
  destination_number    String?            // Immutable snapshot of dialed E.164 string
  state                 String
  started_at            DateTime
  ended_at              DateTime?
  duration_seconds      Int?
  dial_status           String?
  disconnect_reason     String?
  call                  Call               @relation(fields: [call_id], references: [id], onDelete: Cascade)
  buyer                 Buyer?             @relation(fields: [buyer_id], references: [id], onDelete: SetNull)
  destination_ref       DestinationNumber? @relation(fields: [destination_number_id], references: [id], onDelete: SetNull)

  @@index([call_id])
  @@index([buyer_id])
  @@index([destination_number_id])
  @@map("call_attempts")
}
```

---

## 5. EXISTING VENDOR ASSIGNMENT PATTERNS THAT CAN BE REUSED

CallFlow's Vendor module already solves this exact problem for inbound calls:

| Architectural Component | Vendor Pattern (Existing) | Buyer Pattern (Proposed) |
|---|---|---|
| **Organizational Entity** | `Vendor` (`id`, `workspace_id`, `name`, `status`) | `Buyer` (`id`, `workspace_id`, `name`, `email`, `status`) |
| **Phone Number Entity** | `PhoneNumber` (`id`, `workspace_id`, `vendor_id`, `campaign_id`, `phone_number`, `status`) | `DestinationNumber` (`id`, `workspace_id`, `buyer_id`, `destination_number`, `timeout`, `max_concurrent_calls`, `status`) |
| **Workspace Invitation** | `WorkspaceInvitation.vendor_id` (`participant_type: VENDOR`) | `WorkspaceInvitation.buyer_id` (`participant_type: BUYER`) |
| **Workspace Membership** | `WorkspaceMember.vendor_id` (`participant_type: VENDOR`) | `WorkspaceMember.buyer_id` (`participant_type: BUYER`) |
| **Authorization Check** | If `member.participant_type == VENDOR`, filter data by `member.vendor_id` | If `member.participant_type == BUYER`, filter data by `member.buyer_id` |
| **Access Scope** | Vendor user automatically sees all `PhoneNumbers` where `vendor_id == user.vendor_id` | Buyer user automatically sees all `DestinationNumbers` where `buyer_id == user.buyer_id` |

### Why Replicating the Vendor Pattern is Superior
1. **Zero Join Table Overhead**: Eliminates `WorkspaceMemberBuyer` query overhead and maintenance.
2. **Deterministic RBAC**: Guarding `buyer_id == req.user.buyerId` is a single indexed comparison.
3. **Consistency**: Frontend dialogs for "Invite Buyer" will directly mirror "Invite Vendor" (select Organization -> enter email -> send invitation).

---

## 6. CAMPAIGN AND ROUTING IMPACT

### 6.1 Routing Waterfall Logic
In `apps/api/src/telephony/call-controller.ts` and `apps/api/src/calls/calls.service.ts`:
- **Current Execution**:
  1. Fetch `campaign.campaign_buyers` ordered by `priority ASC`.
  2. Check concurrency for `buyer_id`.
  3. Dial `buyer.destination_number`.
- **Proposed Execution**:
  1. Fetch `campaign.campaign_destination_numbers` where `status = ACTIVE` and `destination_number.status = ACTIVE` and `destination_number.buyer.status = ACTIVE`, ordered by `priority ASC, weight DESC`.
  2. Check active calls for `destination_number_id` against `destination_number.max_concurrent_calls`.
  3. Dial `destination_number.destination_number`.
  4. Write `attempt.destination_number_id = dn.id`, `attempt.destination_number = dn.destination_number`, `attempt.buyer_id = dn.buyer_id`.

### 6.2 Concurrency Isolation
Under the proposed architecture, an organization with two call centers (e.g., East Coast with 5 lines, West Coast with 10 lines) can have granular concurrency limits enforced per endpoint, avoiding false-positive concurrency blocks across the entire corporate client.

---

## 7. BUYER INVITATION IMPACT

### 7.1 Invitation Flow Simplification
- **Current Flow**:
  1. Admin navigates to `/protected/members`.
  2. Admin enters user email, chooses `Role: BUYER`.
  3. Invitation is created with `participant_type: BUYER` (no buyer attached).
  4. User accepts invitation; `WorkspaceMember` row created.
  5. Admin must separately open `/protected/members/[id]`.
  6. Admin selects from a list of "Buyers" and clicks "Attach Buyer" for each individual number.
- **Proposed Flow**:
  1. Admin creates Buyer organization (with corporate email).
  2. Admin invites member: selects `Role: BUYER`, selects `Buyer: [Acme Corp]`.
  3. Invitation stores `buyer_id: acme_corp_id`.
  4. Upon accepting invitation, `WorkspaceMember` row is created with `buyer_id: acme_corp_id`.
  5. The Buyer user immediately accesses all destination numbers, call attempts, and commercial reports for Acme Corp.

---

## 8. REPORTING IMPACT: COMBINED & INDIVIDUAL DESTINATION NUMBERS

### 8.1 Reporting Aggregations
In `apps/api/src/reporting/reporting.service.ts`:
- **Combined Buyer Reporting**:
  - Filter: `{ buyer_id: buyerId }`.
  - Aggregates total calls, total answered, total qualified, revenue, payout, and profit across all of the buyer's destination numbers.
- **Individual Destination Number Reporting**:
  - Filter: `{ buyer_id: buyerId, destination_number_id: destinationNumberId }`.
  - Isolates performance, connect rate, average duration, and conversion rate for a specific call center or number.

### 8.2 Historical Dial Snapshotting
Because `CallAttempt.destination_number` will store the immutable dialed string:
- If a destination number entity is renamed or updated, historical reports accurately display the exact number dialed at that moment in time.
- If a destination number is deleted, historical attempts retain the snapshot number string with `destination_number_id: NULL` (via `onDelete: SetNull`).

---

## 9. RBAC AND TENANT ISOLATION RISKS

1. **Workspace Boundary**:
   - Every `DestinationNumber` must have `workspace_id`.
   - All queries must enforce `where: { workspace_id: user.workspaceId }` to prevent cross-tenant enumeration.
2. **Buyer Portal Scoping**:
   - When `user.participant_type === 'BUYER'`, the backend must force:
     ```typescript
     where: {
       workspace_id: user.workspaceId,
       buyer_id: user.buyerId
     }
     ```
   - Buyer users must be forbidden from accessing `/campaigns`, `/phone-numbers`, or other buyers' data.
3. **Number Uniqueness**:
   - `DestinationNumber` must enforce `@@unique([workspace_id, destination_number])`.
   - Prevents duplicate routing loops within the same workspace.

---

## 10. SUPABASE MIGRATION REQUIREMENTS (CANONICAL POSTGRESQL)

The migration must be executed in progressive, non-destructive stages:

### Stage 1: Create `destination_numbers` and Add Buyer Email
```sql
-- 1. Add email column to buyers
ALTER TABLE "buyers" ADD COLUMN IF NOT EXISTS "email" TEXT;

-- 2. Create destination_numbers table
CREATE TABLE IF NOT EXISTS "destination_numbers" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
    "buyer_id" UUID NOT NULL REFERENCES "buyers"("id") ON DELETE CASCADE,
    "destination_number" TEXT NOT NULL,
    "name" TEXT,
    "timeout" INTEGER NOT NULL DEFAULT 30,
    "max_concurrent_calls" INTEGER NOT NULL DEFAULT 1,
    "status" "BuyerStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT "destination_numbers_workspace_number_key" UNIQUE ("workspace_id", "destination_number")
);

CREATE INDEX IF NOT EXISTS "idx_destination_numbers_workspace" ON "destination_numbers"("workspace_id");
CREATE INDEX IF NOT EXISTS "idx_destination_numbers_buyer" ON "destination_numbers"("buyer_id");
```

### Stage 2: Backfill Existing Destination Numbers from `buyers`
```sql
-- Migrate current buyer destination numbers into destination_numbers table
INSERT INTO "destination_numbers" (
    "id", "workspace_id", "buyer_id", "destination_number", "name", "timeout", "max_concurrent_calls", "status", "created_at", "updated_at"
)
SELECT 
    gen_random_uuid(),
    "workspace_id"::UUID,
    "id"::UUID,
    "destination_number",
    "name" || ' Primary',
    "timeout",
    "max_concurrent_calls",
    "status",
    "created_at",
    "updated_at"
FROM "buyers"
ON CONFLICT ("workspace_id", "destination_number") DO NOTHING;
```

### Stage 3: Create `campaign_destination_numbers` and Backfill
```sql
CREATE TABLE IF NOT EXISTS "campaign_destination_numbers" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "campaign_id" UUID NOT NULL REFERENCES "campaigns"("id") ON DELETE CASCADE,
    "destination_number_id" UUID NOT NULL REFERENCES "destination_numbers"("id") ON DELETE CASCADE,
    "priority" INTEGER NOT NULL DEFAULT 1,
    "weight" INTEGER NOT NULL DEFAULT 100,
    "status" "BuyerStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT "campaign_destination_numbers_unique" UNIQUE ("campaign_id", "destination_number_id")
);

-- Backfill from campaign_buyers
INSERT INTO "campaign_destination_numbers" ("campaign_id", "destination_number_id", "priority", "weight", "created_at", "updated_at")
SELECT 
    cb."campaign_id"::UUID,
    dn."id",
    cb."priority",
    cb."weight",
    cb."created_at",
    cb."updated_at"
FROM "campaign_buyers" cb
JOIN "destination_numbers" dn ON dn."buyer_id" = cb."buyer_id"::UUID
ON CONFLICT ("campaign_id", "destination_number_id") DO NOTHING;
```

### Stage 4: Add `buyer_id` to Members & Invitations, Backfill
```sql
ALTER TABLE "workspace_members" ADD COLUMN IF NOT EXISTS "buyer_id" UUID REFERENCES "buyers"("id") ON DELETE SET NULL;
ALTER TABLE "workspace_invitations" ADD COLUMN IF NOT EXISTS "buyer_id" UUID REFERENCES "buyers"("id") ON DELETE SET NULL;

-- Backfill workspace_members.buyer_id from workspace_member_buyers
UPDATE "workspace_members" wm
SET "buyer_id" = wmb."buyer_id"::UUID
FROM "workspace_member_buyers" wmb
WHERE wm."id" = wmb."workspace_member_id"::UUID
  AND wm."buyer_id" IS NULL;
```

### Stage 5: Snapshot Columns on `call_attempts`
```sql
ALTER TABLE "call_attempts" ADD COLUMN IF NOT EXISTS "destination_number_id" UUID REFERENCES "destination_numbers"("id") ON DELETE SET NULL;
ALTER TABLE "call_attempts" ADD COLUMN IF NOT EXISTS "destination_number" TEXT;

-- Backfill historical destination number string from buyers table
UPDATE "call_attempts" ca
SET "destination_number" = b."destination_number"
FROM "buyers" b
WHERE ca."buyer_id"::UUID = b."id"
  AND ca."destination_number" IS NULL;
```

---

## 11. BACKWARD COMPATIBILITY PLAN

To guarantee zero downtime and prevent service interruption:
1. **Database Level**:
   - Legacy columns (`buyers.destination_number`, `buyers.timeout`, `buyers.max_concurrent_calls`) will remain in the database during Step 2 as optional/nullable.
   - Legacy join table `workspace_member_buyers` and `campaign_buyers` will remain populated via dual-write triggers or service logic until all services transition.
2. **API Dual-Read Compatibility**:
   - If an external integration or legacy frontend client requests `GET /buyers/:id`, the service returns `destination_number` populated from its primary `DestinationNumber` record.
3. **Telephony Fail-Safe**:
   - `prepareNextBuyer` router will check `CampaignDestinationNumber` first; if none exist, it will fallback to legacy `CampaignBuyer` records.

---

## 12. REQUIRED TESTS

1. **Unit Tests**:
   - `destination-numbers.service.spec.ts`: Test CRUD, E.164 formatting validation, workspace scoping, and unique constraint collision.
   - `buyers.service.spec.ts`: Test Buyer creation with email, cascade deletion of destination numbers.
   - `calls.service.spec.ts`: Test waterfall routing selecting `CampaignDestinationNumber` by priority and checking concurrency per destination number.
2. **Integration Tests**:
   - `buyer-invitation.spec.ts`: Verify inviting a member with `participant_type: BUYER` and `buyer_id`, accepting the invitation, and asserting the member accesses all buyer destination numbers.
   - `call-attempt-snapshot.spec.ts`: Dial call, update `DestinationNumber.destination_number`, assert `CallAttempt.destination_number` remains unchanged.
3. **Frontend E2E Tests**:
   - Admin creates Buyer with email -> adds 2 Destination Numbers -> assigns 1st number to Campaign A -> Buyer logs in -> verifies reporting dashboard reflects both combined and individual numbers.

---

## 13. UNRESOLVED ARCHITECTURAL DECISIONS

The following 4 decisions are presented for review prior to Step 2 implementation:

1. **Shared vs Exclusive Destination Numbers**:
   - *Question*: Can a single `DestinationNumber` be assigned to multiple Buyers?
   - *Recommendation*: **NO**. A destination number must belong exclusively to one Buyer (`1 Buyer : N DestinationNumbers`), matching the Vendor model (`1 Vendor : N PhoneNumbers`).
2. **Campaign Assignment Entity**:
   - *Question*: Should Campaigns assign `DestinationNumber` directly, or assign a `Buyer` and let the router dial all buyer numbers in round-robin?
   - *Recommendation*: **Assign `DestinationNumber` directly**. This gives media buyers precise control over endpoint priorities, caps, and hours of operation.
3. **Auto-Invite on Buyer Creation**:
   - *Question*: When an Admin creates a Buyer with an email address, should CallFlow automatically generate and send a workspace invitation?
   - *Recommendation*: **NO**. Keep invitation an explicit button/action (`Invite Buyer Contact`) to allow admins to set up destination numbers and campaigns before granting client access.
4. **Deprecation Timeline for `WorkspaceMemberBuyer`**:
   - *Question*: When should `WorkspaceMemberBuyer` be dropped?
   - *Recommendation*: Keep the table in the schema marked `@deprecated` during Step 2, and drop it in Step 3 after full production verification of the direct `buyer_id` mapping.

---

## 14. AUDIT CONCLUSION & READINESS

- **Current State**: Conflates Buyer with a single phone number; lacks Buyer email; uses cumbersome join-table workarounds; lacks dialed number snapshots on attempts.
- **Proposed State**: Clean 1:N separation matching the robust Vendor pattern; independent Destination Numbers; campaign-level destination routing; direct Buyer member scoping; immutable reporting snapshots.
- **Verification**: Remote Supabase database, Prisma schema, telephony controllers, commercial evaluators, and frontend pages have been completely cataloged and verified with read-only static analysis.

**STEP 1 AUDIT STATUS: PASS**  
*Execution halted. Awaiting explicit user approval before proceeding to Step 2.*
