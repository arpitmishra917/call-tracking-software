-- AlterTable
ALTER TABLE "wallet_transactions" ADD COLUMN "amount_micro" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "wallet_transactions" ADD COLUMN "balance_after_micro" BIGINT NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "workspace_balances" ADD COLUMN "balance_micro" BIGINT NOT NULL DEFAULT 0;

-- Data Migration Backfill
UPDATE "wallet_transactions" SET "amount_micro" = ("amount_minor" * 10000);
UPDATE "wallet_transactions" SET "balance_after_micro" = ("balance_after" * 10000);
UPDATE "workspace_balances" SET "balance_micro" = ("balance_minor" * 10000);

-- AlterTable Drop Defaults (Optional but cleaner, we'll leave them for safety or drop them if needed. Prisma expects no defaults for dynamic fields)
ALTER TABLE "wallet_transactions" ALTER COLUMN "amount_micro" DROP DEFAULT;
ALTER TABLE "wallet_transactions" ALTER COLUMN "balance_after_micro" DROP DEFAULT;
ALTER TABLE "workspace_balances" ALTER COLUMN "balance_micro" DROP DEFAULT;
