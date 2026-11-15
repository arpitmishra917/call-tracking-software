-- AlterTable
ALTER TABLE "wallet_transactions" ADD COLUMN "type" "TransactionType" NOT NULL DEFAULT 'CREDIT',
ADD COLUMN "idempotency_key" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "wallet_transactions_idempotency_key_key" ON "wallet_transactions"("idempotency_key");

-- CreateTable
CREATE TABLE "call_reservation_extensions" (
    "id" TEXT NOT NULL,
    "reservation_id" TEXT NOT NULL,
    "call_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "extension_index" INTEGER NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "amount_micro" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "call_reservation_extensions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "call_reservation_extensions_idempotency_key_key" ON "call_reservation_extensions"("idempotency_key");

-- CreateIndex
CREATE INDEX "call_reservation_extensions_reservation_id_idx" ON "call_reservation_extensions"("reservation_id");

-- CreateIndex
CREATE INDEX "call_reservation_extensions_call_id_idx" ON "call_reservation_extensions"("call_id");

-- AddForeignKey
ALTER TABLE "call_reservation_extensions" ADD CONSTRAINT "call_reservation_extensions_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "call_reservations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_reservation_extensions" ADD CONSTRAINT "call_reservation_extensions_call_id_fkey" FOREIGN KEY ("call_id") REFERENCES "calls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_reservation_extensions" ADD CONSTRAINT "call_reservation_extensions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
