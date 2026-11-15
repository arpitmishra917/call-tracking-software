-- AlterTable
ALTER TABLE "calls" ADD COLUMN "phone_number_id" TEXT;
ALTER TABLE "calls" ADD COLUMN "vendor_id" TEXT;
ALTER TABLE "calls" ADD COLUMN "attributed_vendor_id" TEXT;
ALTER TABLE "calls" ADD COLUMN "attribution_source" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "calls_workspace_id_created_at_idx" ON "calls"("workspace_id", "created_at");
CREATE INDEX IF NOT EXISTS "calls_workspace_id_attributed_vendor_id_created_at_idx" ON "calls"("workspace_id", "attributed_vendor_id", "created_at");
CREATE INDEX IF NOT EXISTS "calls_workspace_id_vendor_id_created_at_idx" ON "calls"("workspace_id", "vendor_id", "created_at");
CREATE INDEX IF NOT EXISTS "calls_phone_number_id_idx" ON "calls"("phone_number_id");

-- AddForeignKey
ALTER TABLE "calls" ADD CONSTRAINT "calls_phone_number_id_fkey" FOREIGN KEY ("phone_number_id") REFERENCES "phone_numbers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calls" ADD CONSTRAINT "calls_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Deterministic Backfill inside same atomic transaction
-- 1. Backfill historical commercial calls with non-null commercial Vendor
UPDATE "calls" c
SET 
  "vendor_id" = cc."vendor_id",
  "attributed_vendor_id" = cc."vendor_id",
  "attribution_source" = 'LEGACY_COMMERCIAL'
FROM "call_commercials" cc
WHERE c."id" = cc."call_id"
  AND cc."vendor_id" IS NOT NULL
  AND c."attribution_source" IS NULL;

-- 2. Mark all remaining uncommercialized historical calls as missing historical snapshot
-- MANDATORY RULE: Never infer historical Vendor ownership from current PhoneNumber assignment
UPDATE "calls"
SET 
  "vendor_id" = NULL,
  "attributed_vendor_id" = NULL,
  "attribution_source" = 'LEGACY_UNATTRIBUTED'
WHERE "attribution_source" IS NULL;
