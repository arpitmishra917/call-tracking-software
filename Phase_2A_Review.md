# Phase 2A Billing Precision Review

## 1. Current Problem
The `WalletTransaction` and `WorkspaceBalance` tables use an integer data type (`amount_minor` and `balance_minor`) currently strictly tied to monetary cents (e.g. $25.00 = 2500).
The required telemetry pricing ($0.045 for calls and $0.0025 for recording) introduces sub-cent fractional values. It is physically impossible to subtract a value like `4.5` cents or `0.25` cents from an `Int` database column without destructive rounding, violating financial integrity invariants.

## 2. Existing Financial Model
The repository currently represents the prepaid schema as:
- `WorkspaceBalance.balance_minor`: Int
- `WalletTransaction.amount_minor`: Int
- `UsageRecord.quantity`: Int (Telemetry metric counting minutes/events)

## 3. Option A — Micro-Units
Migrate the `amount_minor` and `balance_minor` representations to a higher scale, specifically Micro-Dollars ($1 = 1,000,000 units), allowing $0.0025 to be stored losslessly as `2500` units.

**Pros:** 
- Retains native CPU/PostgreSQL integer math, entirely eliminating float precision data loss issues.
- Fast, natively indexable, and standard inside modern telecommunication billing.
**Cons:** 
- Discrepancy with Stripe/Cashfree APIs which natively speak in cents.
- The UI layer must always divide by 1,000,000 rather than 100.
**Migration impact:** 
- Requires renaming `amount_minor` to `amount_micro`, running a SQL migration multiplying existing values by 10,000, and refactoring API serialization logic to maintain frontend stability.
**Future provider impact:** 
- Payment gateway integrations must wrap their Top-Up requests with `(providerAmount * 10000)` before injecting them into the WalletService.

## 4. Option B — DECIMAL
Migrate the Postgres columns to a `DECIMAL(19,6)` or `DECIMAL(19,4)` representation.

**Pros:**
- Direct, 1:1 human-readable parity with rates (e.g., storing `0.045` directly).
**Cons:**
- Prisma ORM surfaces decimals as `Decimal.js` objects. All TypeScript backend mutation logic using standard `+` or `-` operators will fail and must be completely rewritten to `.add()` and `.sub()`.
**Migration impact:**
- High. Affects every line of mathematical logic in `WalletService` and controllers.
**Future provider impact:**
- Must actively convert the `Decimal.js` output to an integer string prior to firing payloads to Stripe/Cashfree, as payment providers reject float/decimal formats.

## 5. Option C — Fractional Usage Accumulation
Keep `amount_minor` as Cents. Introduce an intermediate `UnbilledUsage` layer tracking fractional remainders. When the sum of an account's fractional usage crosses `1.0` cent, debit the main Wallet and deduct from the accumulator.

**Pros:**
- No database migration required for the Wallet tables.
- Flawless native integration with Stripe/Cashfree.
**Cons:**
- Extreme architectural complexity. Disconnects real-time Usage from real-time Billing. 
**Migration impact:**
- Introduces dual-ledger synchronicity overhead. 
**Future provider impact:**
- None financially, but requires cron jobs or inline triggers to continually check for fractional threshold crosses.

## 6. Other Architecture
None genuinely better.

## 7. Call Pricing Precision Analysis
Explicit examples using:
- **$0.045**: 1 local call minute = 4.5 cents. The cent-wallet cannot deduct this.
- **$0.055**: 1 toll-free minute = 5.5 cents. 

## 8. Recording Pricing Precision Analysis
Explicit examples using:
- **$0.0025**: 1 recording minute = 0.25 cents. The cent-wallet cannot deduct this. 4 minutes = 1 cent exactly.

## 9. Recommendation
**Option A — Micro-Units (Micro-dollars)**
I recommend migrating the Wallet to `amount_micro` ($1 = 1,000,000). 
Why: Option B forces `Decimal.js` overhead across the entire NestJS application, which is a known vector for bugs. Option C introduces a massive asynchronous synchronization burden (a fractional debt ledger) which violates your preference against complex debt systems. Option A keeps the code synchronous, native to standard integer math, guarantees flawless accuracy for rates down to $0.000001, and only requires a simple `/ 10000` mapping wrapper at the edge interfaces (UI and Provider Webhooks).

## 10. Proposed Data Model
```prisma
model WalletTransaction {
    id              String          @id @default(uuid())
    workspace_id    String
    amount_micro    BigInt          // Changed from Int amount_minor to support $1,000,000 scale
    // ...
    balance_after   BigInt          // Uses BigInt to prevent overflow at million-scale
}
model WorkspaceBalance {
    balance_micro   BigInt
}
```
*Note: We would use `BigInt` because a $2,500.00 wallet balance equals `2,500,000,000` micro-units, which exceeds the safe bounds of standard 32-bit Integers (`2,147,483,647`).*

## 11. Idempotency Model
Identical to Phase 1: The WalletTransaction `idempotency_key` remains globally unique. `UsageRecord` maintains its telemetry `idempotency_key`, preventing duplicate telemetry insertions.

## 12. Wallet Settlement Model
Settlement occurs instantly and synchronously at the end of the Call lifecycle. The fractional micro-dollar math resolves inline, immediately debiting the WorkspaceBalance and recording a WalletTransaction without waiting for a 1-cent boundary.

## 13. Fractional Remainder Lifecycle
Under Option A, there is no "fractional remainder". The wallet itself holds fractions natively.
- **Continues using service**: Math executes losslessly.
- **Reaches zero balance**: A wallet hitting `0` micro-dollars perfectly aligns with exactly `$0.00`.
- **Becomes suspended/archived/closes account**: The final balance mathematically matches exact reality without pending fractional debts to write off.

## 14. Migration Plan
1. Introduce a schema patch renaming `amount_minor` to `amount_micro` (using `BigInt`), mapping `balance_minor` to `balance_micro` (`BigInt`).
2. Run a raw SQL data migration multiplying existing values by `10000`.
3. Refactor `WalletService` to utilize `BigInt` calculations.
4. Patch the `MockPaymentProvider` and Controllers to multiply incoming cents by `10000` before hitting the WalletService, and divide outgoing balances by `10000` for API consumers.
5. Update Frontend React UI casting the parsed `BigInt` (stringified) back to decimal dollars for display.

## 15. Risks
- `BigInt` serialization over standard JSON APIs requires custom `JSON.stringify` interceptors (because standard `JSON.stringify` throws a TypeError on BigInt).
- Existing Stripe Subscriptions mapping logic may require careful separation from Wallet Micro-units.

## 16. Phase 2 Implementation Plan
1. Schema & Migration (Option A BigInt).
2. JSON BigInt Interceptor middleware implementation.
3. Pricing Constants Definition Layer.
4. Usage/Billing Calculation Layer.
5. End-of-Call Event Hook -> Trigger Debit.
6. Recording Event Hook -> Trigger Debit.
7. Phone Number Hook (Deferred per instruction).
8. Validation & Testing.

## 17. Code Changes
NO CODE CHANGES

## 18. Database Changes
NO DATABASE CHANGES

## 19. Git
Branch: main
HEAD: 69b2df1
Working tree: clean (with untracked temp script files)
