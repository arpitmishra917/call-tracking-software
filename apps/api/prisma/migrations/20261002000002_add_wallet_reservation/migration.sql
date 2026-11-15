-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('ACTIVE', 'SETTLED', 'RELEASED', 'EXPIRED');

-- AlterTable
ALTER TABLE "workspace_balances" ADD COLUMN     "reserved_micro" BIGINT NOT NULL DEFAULT 0,
ALTER COLUMN "balance_micro" SET DEFAULT 0;

-- CreateTable
CREATE TABLE "call_reservations" (
    "id" TEXT NOT NULL,
    "call_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "status" "ReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "original_reserved_micro" BIGINT NOT NULL,
    "total_reserved_micro" BIGINT NOT NULL,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "call_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "call_reservations_call_id_key" ON "call_reservations"("call_id");

-- CreateIndex
CREATE INDEX "call_reservations_workspace_id_status_idx" ON "call_reservations"("workspace_id", "status");

-- CreateIndex
CREATE INDEX "call_reservations_status_expires_at_idx" ON "call_reservations"("status", "expires_at");

-- AddForeignKey
ALTER TABLE "call_reservations" ADD CONSTRAINT "call_reservations_call_id_fkey" FOREIGN KEY ("call_id") REFERENCES "calls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_reservations" ADD CONSTRAINT "call_reservations_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

