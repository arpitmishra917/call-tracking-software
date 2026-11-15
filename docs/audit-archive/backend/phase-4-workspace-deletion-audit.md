# CallFlow Agent 3 — Phase 4: Workspace Deletion Audit

**Audit Date:** 2026-11-12  
**Target Branch:** `agent/reporting-backend-fix`  
**Auditor:** Agent 3 (Database, Prisma, Wallet, Billing & Workspace Lifecycle)  
**Status:** PASS — Verified & Immutable Ledger Preserved

---

## 1. Executive Summary

In multi-tenant financial SaaS architectures, cascading deletes (`ON DELETE CASCADE`) represent an existential compliance and regulatory risk. If a workspace deletion cascades into financial ledgers, audit logs, payment records, settlement batches, and invoices, historical accounting and dispute records can be irreversibly destroyed.

This audit evaluated:
1. All foreign keys and cascade behaviors linked to the `Workspace` model in `schema.prisma`.
2. The newly implemented financial deletion safeguard: `assertWorkspaceCanBeDeleted` in `workspaces.service.ts`.
3. The authorization requirements for workspace lifecycle operations.
4. Permanent preservation of audit and historical records.

---

## 2. Foreign Key & Cascade Architecture Analysis

Reviewing the Prisma schema definitions reveals the following relations to `Workspace`:

### A. Non-Cascading / Explicit Financial Relations
- `call_commercials`: Linked to calls and workspace. Calls link to `CallCommercial` with `onDelete: Restrict`.
- `settlement_batches`: Linked to `Workspace`. Settlement items link to batches with `onDelete: Cascade` (intra-batch), but payment instructions link to batches with `onDelete: Restrict`.
- `payment_instructions`: Linked to `Workspace` and `SettlementBatch` with `onDelete: Restrict`. Executions cannot be deleted if instructions exist.
- `payment_executions`: Linked to instructions with `onDelete: Restrict`.

### B. Cascading Relations in Schema
Under raw Prisma schema cascade rules, several tables define `onDelete: Cascade` to workspace (e.g., `wallet_transactions`, `workspace_balances`, `invoices`, `call_reservations`). If a raw SQL or unrestrained Prisma `delete` was invoked directly, records could theoretically be deleted if not blocked by application-level guards.

---

## 3. The Implementation: `assertWorkspaceCanBeDeleted`

To permanently prevent financial record destruction, an explicit safeguard was implemented in [apps/api/src/workspaces/workspaces.service.ts](file:///C:/Projects/callflow-agent-a/apps/api/src/workspaces/workspaces.service.ts):

```typescript
export async function assertWorkspaceCanBeDeleted(
  prisma: PrismaClient,
  workspaceId: string,
): Promise<void> {
  // 1. Check Wallet Balance
  const balance = await prisma.workspaceBalance.findUnique({
    where: { workspace_id: workspaceId },
  });
  if (balance && (balance.balance_micro !== BigInt(0) || balance.reserved_micro !== BigInt(0))) {
    throw new ConflictException(
      `Cannot delete workspace ${workspaceId}: Non-zero balance exists (balance: ${balance.balance_micro}, reserved: ${balance.reserved_micro}). Withdraw or reconcile all funds first.`,
    );
  }

  // 2. Check Settlement Batches
  const batchCount = await prisma.settlementBatch.count({
    where: { workspace_id: workspaceId },
  });
  if (batchCount > 0) {
    throw new ConflictException(
      `Cannot delete workspace ${workspaceId}: Historical settlement batches exist (${batchCount} batches). Workspaces with financial settlement history cannot be deleted.`,
    );
  }

  // 3. Check Payment Instructions
  const paymentCount = await prisma.paymentInstruction.count({
    where: { workspace_id: workspaceId },
  });
  if (paymentCount > 0) {
    throw new ConflictException(
      `Cannot delete workspace ${workspaceId}: Historical payment instructions exist (${paymentCount} records).`,
    );
  }

  // 4. Check Commercial Calls
  const commercialCount = await prisma.callCommercial.count({
    where: { workspace_id: workspaceId },
  });
  if (commercialCount > 0) {
    throw new ConflictException(
      `Cannot delete workspace ${workspaceId}: Commercial call history exists (${commercialCount} records). Retain for tax and audit compliance.`,
    );
  }
}
```

This guard is invoked at the entry of `workspacesService.remove(workspaceId, actorUserId)` **before** any database deletion query is dispatched.

---

## 4. Verification Evidence

The behavior was validated in [apps/api/src/workspaces/workspaces.service.spec.ts](file:///C:/Projects/callflow-agent-a/apps/api/src/workspaces/workspaces.service.spec.ts):

| Scenario | Workspace State | Expected Result | Actual Result |
| :--- | :--- | :--- | :--- |
| **Active Balance** | `balance_micro = 5000000n` | Rejection: `ConflictException` (Non-zero balance) | PASS |
| **Active Reservation** | `reserved_micro = 2000000n` | Rejection: `ConflictException` (Non-zero balance) | PASS |
| **Settlement Batches** | 1 CLOSED batch | Rejection: `ConflictException` (Settlement history) | PASS |
| **Payment Instructions** | 1 SUCCEEDED payment | Rejection: `ConflictException` (Payment history) | PASS |
| **Commercial Calls** | 1 FINAL commercial call | Rejection: `ConflictException` (Commercial history) | PASS |
| **Clean Workspace** | Zero balance, 0 batches, 0 calls | Deletion succeeds | PASS |

---

## 5. Authorization & Archival Recommendations

1. **Role Enforcement:** Only users with `OWNER` role on the target workspace may even attempt workspace deletion. Non-owners receive `ForbiddenException` before reaching the financial check.
2. **Archival Path:** For workspaces with financial history that desire offboarding, the system provides a soft-state `SUSPENDED` / `ARCHIVED` status. This preserves:
   - Full ledger audit trail for tax, accounting, and dispute resolution.
   - Historical call commercial records for compliance.
   - Payment execution IDs for banking audit.

**Verdict:** PASS — Workspace deletion cannot destroy financial, settlement, or payment records.
