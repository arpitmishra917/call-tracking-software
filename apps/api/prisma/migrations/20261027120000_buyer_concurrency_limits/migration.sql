-- AlterTable
ALTER TABLE "buyers" ADD COLUMN "max_concurrent_calls" INTEGER;

-- Backfill existing buyers with approved limit (1)
UPDATE "buyers" SET "max_concurrent_calls" = 1 WHERE "max_concurrent_calls" IS NULL;

-- AlterTable to enforce NOT NULL
ALTER TABLE "buyers" ALTER COLUMN "max_concurrent_calls" SET NOT NULL;

-- CreateEnum
CREATE TYPE "BuyerReservationStatus" AS ENUM ('ACTIVE', 'RELEASED');

-- CreateTable
CREATE TABLE "buyer_reservations" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "buyer_id" TEXT NOT NULL,
    "call_id" TEXT NOT NULL,
    "attempt_id" TEXT NOT NULL,
    "status" "BuyerReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "buyer_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "buyer_reservations_attempt_id_key" ON "buyer_reservations"("attempt_id");

-- CreateIndex
CREATE INDEX "buyer_reservations_buyer_id_status_idx" ON "buyer_reservations"("buyer_id", "status");

-- CreateIndex
CREATE INDEX "buyer_reservations_call_id_idx" ON "buyer_reservations"("call_id");

-- CreateIndex
CREATE INDEX "buyer_reservations_workspace_id_idx" ON "buyer_reservations"("workspace_id");

-- AddForeignKey
ALTER TABLE "buyer_reservations" ADD CONSTRAINT "buyer_reservations_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buyer_reservations" ADD CONSTRAINT "buyer_reservations_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "buyers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buyer_reservations" ADD CONSTRAINT "buyer_reservations_call_id_fkey" FOREIGN KEY ("call_id") REFERENCES "calls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buyer_reservations" ADD CONSTRAINT "buyer_reservations_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "call_attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
