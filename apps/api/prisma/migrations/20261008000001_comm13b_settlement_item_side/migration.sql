-- DropIndex
DROP INDEX "settlement_items_call_commercial_id_key";

-- AlterTable: Add participant_type column (nullable first to safely populate if existing rows exist)
ALTER TABLE "settlement_items" ADD COLUMN "participant_type" "SettlementParticipantType";

-- Backfill participant_type from parent settlement_batch for any existing rows
UPDATE "settlement_items" si
SET "participant_type" = sb."participant_type"
FROM "settlement_batches" sb
WHERE si."settlement_batch_id" = sb."id";

-- AlterTable: Make participant_type NOT NULL
ALTER TABLE "settlement_items" ALTER COLUMN "participant_type" SET NOT NULL;

-- CreateIndex: Composite unique constraint per (call_commercial_id, participant_type)
CREATE UNIQUE INDEX "settlement_items_call_commercial_id_participant_type_key" ON "settlement_items"("call_commercial_id", "participant_type");
