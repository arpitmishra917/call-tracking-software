-- CreateEnum
CREATE TYPE "CommercialStatus" AS ENUM ('PENDING', 'FINAL', 'ADJUSTED');

-- CreateEnum
CREATE TYPE "DisputeStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');

-- AlterTable
ALTER TABLE "phone_numbers" ADD COLUMN "vendor_id" TEXT;

-- AlterTable
ALTER TABLE "campaigns" ADD COLUMN "conversion_duration_secs" INTEGER DEFAULT 90,
ADD COLUMN "duplicate_window_secs" INTEGER DEFAULT 2592000,
ADD COLUMN "default_revenue_amount" DECIMAL(12,4),
ADD COLUMN "default_payout_amount" DECIMAL(12,4),
ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'USD';

-- CreateTable
CREATE TABLE "call_commercials" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "call_id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "vendor_id" TEXT,
    "buyer_id" TEXT,
    "qualified" BOOLEAN NOT NULL DEFAULT false,
    "converted" BOOLEAN NOT NULL DEFAULT false,
    "duplicate" BOOLEAN NOT NULL DEFAULT false,
    "duplicate_of_call_id" TEXT,
    "revenue" DECIMAL(12,4) NOT NULL DEFAULT 0.0000,
    "payout" DECIMAL(12,4) NOT NULL DEFAULT 0.0000,
    "cost" DECIMAL(12,4) NOT NULL DEFAULT 0.0000,
    "profit" DECIMAL(12,4) NOT NULL DEFAULT 0.0000,
    "status" "CommercialStatus" NOT NULL DEFAULT 'PENDING',
    "finalizes_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "call_commercials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "call_disputes" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "call_commercial_id" TEXT NOT NULL,
    "buyer_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "description" TEXT,
    "status" "DisputeStatus" NOT NULL DEFAULT 'PENDING',
    "created_by_user_id" TEXT NOT NULL,
    "resolved_by_user_id" TEXT,
    "resolution_notes" TEXT,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "call_disputes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "call_financial_adjustments" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "call_commercial_id" TEXT NOT NULL,
    "dispute_id" TEXT NOT NULL,
    "original_revenue" DECIMAL(12,4) NOT NULL,
    "original_payout" DECIMAL(12,4) NOT NULL,
    "adjusted_revenue" DECIMAL(12,4) NOT NULL,
    "adjusted_payout" DECIMAL(12,4) NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "call_financial_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "phone_numbers_vendor_id_idx" ON "phone_numbers"("vendor_id");

-- CreateIndex
CREATE UNIQUE INDEX "call_commercials_call_id_key" ON "call_commercials"("call_id");

-- CreateIndex
CREATE INDEX "call_commercials_workspace_id_status_idx" ON "call_commercials"("workspace_id", "status");

-- CreateIndex
CREATE INDEX "call_commercials_campaign_id_created_at_idx" ON "call_commercials"("campaign_id", "created_at");

-- CreateIndex
CREATE INDEX "call_commercials_vendor_id_idx" ON "call_commercials"("vendor_id");

-- CreateIndex
CREATE INDEX "call_commercials_buyer_id_idx" ON "call_commercials"("buyer_id");

-- CreateIndex
CREATE UNIQUE INDEX "call_disputes_call_commercial_id_key" ON "call_disputes"("call_commercial_id");

-- CreateIndex
CREATE INDEX "call_disputes_workspace_id_status_idx" ON "call_disputes"("workspace_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "call_financial_adjustments_call_commercial_id_key" ON "call_financial_adjustments"("call_commercial_id");

-- CreateIndex
CREATE UNIQUE INDEX "call_financial_adjustments_dispute_id_key" ON "call_financial_adjustments"("dispute_id");

-- CreateIndex
CREATE INDEX "call_financial_adjustments_workspace_id_idx" ON "call_financial_adjustments"("workspace_id");

-- AddForeignKey
ALTER TABLE "phone_numbers" ADD CONSTRAINT "phone_numbers_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_commercials" ADD CONSTRAINT "call_commercials_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_commercials" ADD CONSTRAINT "call_commercials_call_id_fkey" FOREIGN KEY ("call_id") REFERENCES "calls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_commercials" ADD CONSTRAINT "call_commercials_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_commercials" ADD CONSTRAINT "call_commercials_duplicate_of_call_id_fkey" FOREIGN KEY ("duplicate_of_call_id") REFERENCES "calls"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_commercials" ADD CONSTRAINT "call_commercials_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_commercials" ADD CONSTRAINT "call_commercials_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "buyers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_disputes" ADD CONSTRAINT "call_disputes_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_disputes" ADD CONSTRAINT "call_disputes_call_commercial_id_fkey" FOREIGN KEY ("call_commercial_id") REFERENCES "call_commercials"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_disputes" ADD CONSTRAINT "call_disputes_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "buyers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_financial_adjustments" ADD CONSTRAINT "call_financial_adjustments_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_financial_adjustments" ADD CONSTRAINT "call_financial_adjustments_call_commercial_id_fkey" FOREIGN KEY ("call_commercial_id") REFERENCES "call_commercials"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_financial_adjustments" ADD CONSTRAINT "call_financial_adjustments_dispute_id_fkey" FOREIGN KEY ("dispute_id") REFERENCES "call_disputes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
