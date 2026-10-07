-- CreateEnum
CREATE TYPE "SettlementParticipantType" AS ENUM ('BUYER', 'VENDOR');

-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('DRAFT', 'FINALIZED', 'CLOSED', 'CANCELED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('UNPROCESSED', 'PENDING', 'SUCCEEDED', 'FAILED', 'CANCELED');

-- CreateEnum
CREATE TYPE "PaymentDirection" AS ENUM ('COLLECTION', 'DISBURSEMENT');

-- CreateEnum
CREATE TYPE "AdjustmentDirection" AS ENUM ('CREDIT', 'CLAWBACK');

-- CreateEnum
CREATE TYPE "AdjustmentStatus" AS ENUM ('PENDING', 'APPLIED', 'VOIDED');

-- CreateEnum
CREATE TYPE "InstructionStatus" AS ENUM ('CREATED', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELED');

-- CreateEnum
CREATE TYPE "ExecutionStatus" AS ENUM ('INITIATED', 'PROCESSING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "ReconciliationStatus" AS ENUM ('UNRECONCILED', 'RECONCILED', 'DISCREPANCY');

-- CreateEnum
CREATE TYPE "ReconciliationRunType" AS ENUM ('BATCH_LEVEL', 'WORKSPACE_LEVEL');

-- CreateEnum
CREATE TYPE "ReconciliationIssueType" AS ENUM ('SUM_MISMATCH', 'DUPLICATE_CALL', 'CURRENCY_MISMATCH', 'MISSING_PAYMENT');

-- CreateTable
CREATE TABLE "settlement_batches" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "batch_number" TEXT NOT NULL,
    "participant_type" "SettlementParticipantType" NOT NULL,
    "buyer_id" TEXT,
    "vendor_id" TEXT,
    "currency" TEXT NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "gross_amount" DECIMAL(12,4) NOT NULL DEFAULT 0.0000,
    "adjustments_amount" DECIMAL(12,4) NOT NULL DEFAULT 0.0000,
    "net_amount" DECIMAL(12,4) NOT NULL DEFAULT 0.0000,
    "item_count" INTEGER NOT NULL DEFAULT 0,
    "settlement_status" "SettlementStatus" NOT NULL DEFAULT 'DRAFT',
    "payment_status" "PaymentStatus" NOT NULL DEFAULT 'UNPROCESSED',
    "reconciliation_status" "ReconciliationStatus" NOT NULL DEFAULT 'UNRECONCILED',
    "finalized_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settlement_batches_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "settlement_batches_participant_check" CHECK (
        ("participant_type" = 'BUYER' AND "buyer_id" IS NOT NULL AND "vendor_id" IS NULL) OR
        ("participant_type" = 'VENDOR' AND "vendor_id" IS NOT NULL AND "buyer_id" IS NULL)
    )
);

-- CreateTable
CREATE TABLE "settlement_items" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "settlement_batch_id" TEXT NOT NULL,
    "call_commercial_id" TEXT NOT NULL,
    "amount" DECIMAL(12,4) NOT NULL,
    "currency" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settlement_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlement_adjustments" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "call_financial_adjustment_id" TEXT NOT NULL,
    "source_call_commercial_id" TEXT NOT NULL,
    "source_settlement_batch_id" TEXT NOT NULL,
    "target_settlement_batch_id" TEXT,
    "participant_type" "SettlementParticipantType" NOT NULL,
    "buyer_id" TEXT,
    "vendor_id" TEXT,
    "direction" "AdjustmentDirection" NOT NULL,
    "amount" DECIMAL(12,4) NOT NULL,
    "currency" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "AdjustmentStatus" NOT NULL DEFAULT 'PENDING',
    "applied_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settlement_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_instructions" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "settlement_batch_id" TEXT NOT NULL,
    "direction" "PaymentDirection" NOT NULL,
    "participant_type" "SettlementParticipantType" NOT NULL,
    "buyer_id" TEXT,
    "vendor_id" TEXT,
    "amount" DECIMAL(12,4) NOT NULL,
    "currency" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "status" "InstructionStatus" NOT NULL DEFAULT 'CREATED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_instructions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_executions" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "payment_instruction_id" TEXT NOT NULL,
    "attempt_number" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_transaction_id" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "amount" DECIMAL(12,4) NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "ExecutionStatus" NOT NULL DEFAULT 'INITIATED',
    "failure_code" TEXT,
    "failure_reason" TEXT,
    "initiated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "payment_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliation_runs" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "run_type" "ReconciliationRunType" NOT NULL DEFAULT 'BATCH_LEVEL',
    "settlement_batch_id" TEXT,
    "status" "ReconciliationStatus" NOT NULL DEFAULT 'UNRECONCILED',
    "items_checked" INTEGER NOT NULL DEFAULT 0,
    "discrepancy_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reconciliation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliation_issues" (
    "id" TEXT NOT NULL,
    "reconciliation_run_id" TEXT NOT NULL,
    "issue_type" "ReconciliationIssueType" NOT NULL,
    "description" TEXT NOT NULL,
    "call_commercial_id" TEXT,
    "expected_amount" DECIMAL(12,4),
    "actual_amount" DECIMAL(12,4),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reconciliation_issues_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "settlement_batches_workspace_id_settlement_status_idx" ON "settlement_batches"("workspace_id", "settlement_status");

-- CreateIndex
CREATE INDEX "settlement_batches_workspace_id_participant_type_buyer_id_idx" ON "settlement_batches"("workspace_id", "participant_type", "buyer_id");

-- CreateIndex
CREATE INDEX "settlement_batches_workspace_id_participant_type_vendor_id_idx" ON "settlement_batches"("workspace_id", "participant_type", "vendor_id");

-- CreateIndex
CREATE INDEX "settlement_batches_period_start_period_end_idx" ON "settlement_batches"("period_start", "period_end");

-- CreateIndex
CREATE UNIQUE INDEX "settlement_batches_workspace_id_batch_number_key" ON "settlement_batches"("workspace_id", "batch_number");

-- CreateIndex
CREATE UNIQUE INDEX "settlement_items_call_commercial_id_key" ON "settlement_items"("call_commercial_id");

-- CreateIndex
CREATE INDEX "settlement_items_workspace_id_idx" ON "settlement_items"("workspace_id");

-- CreateIndex
CREATE INDEX "settlement_items_settlement_batch_id_idx" ON "settlement_items"("settlement_batch_id");

-- CreateIndex
CREATE UNIQUE INDEX "settlement_adjustments_call_financial_adjustment_id_key" ON "settlement_adjustments"("call_financial_adjustment_id");

-- CreateIndex
CREATE INDEX "settlement_adjustments_workspace_id_status_idx" ON "settlement_adjustments"("workspace_id", "status");

-- CreateIndex
CREATE INDEX "settlement_adjustments_buyer_id_idx" ON "settlement_adjustments"("buyer_id");

-- CreateIndex
CREATE INDEX "settlement_adjustments_vendor_id_idx" ON "settlement_adjustments"("vendor_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_instructions_settlement_batch_id_key" ON "payment_instructions"("settlement_batch_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_instructions_idempotency_key_key" ON "payment_instructions"("idempotency_key");

-- CreateIndex
CREATE INDEX "payment_instructions_workspace_id_status_idx" ON "payment_instructions"("workspace_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "payment_executions_idempotency_key_key" ON "payment_executions"("idempotency_key");

-- CreateIndex
CREATE INDEX "payment_executions_workspace_id_idx" ON "payment_executions"("workspace_id");

-- CreateIndex
CREATE INDEX "payment_executions_provider_transaction_id_idx" ON "payment_executions"("provider_transaction_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_executions_payment_instruction_id_attempt_number_key" ON "payment_executions"("payment_instruction_id", "attempt_number");

-- CreateIndex
CREATE INDEX "reconciliation_runs_workspace_id_idx" ON "reconciliation_runs"("workspace_id");

-- CreateIndex
CREATE INDEX "reconciliation_issues_reconciliation_run_id_idx" ON "reconciliation_issues"("reconciliation_run_id");

-- AddForeignKey
ALTER TABLE "settlement_batches" ADD CONSTRAINT "settlement_batches_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_batches" ADD CONSTRAINT "settlement_batches_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "buyers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_batches" ADD CONSTRAINT "settlement_batches_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_items" ADD CONSTRAINT "settlement_items_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_items" ADD CONSTRAINT "settlement_items_settlement_batch_id_fkey" FOREIGN KEY ("settlement_batch_id") REFERENCES "settlement_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_items" ADD CONSTRAINT "settlement_items_call_commercial_id_fkey" FOREIGN KEY ("call_commercial_id") REFERENCES "call_commercials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_adjustments" ADD CONSTRAINT "settlement_adjustments_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_adjustments" ADD CONSTRAINT "settlement_adjustments_call_financial_adjustment_id_fkey" FOREIGN KEY ("call_financial_adjustment_id") REFERENCES "call_financial_adjustments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_adjustments" ADD CONSTRAINT "settlement_adjustments_source_call_commercial_id_fkey" FOREIGN KEY ("source_call_commercial_id") REFERENCES "call_commercials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_adjustments" ADD CONSTRAINT "settlement_adjustments_source_settlement_batch_id_fkey" FOREIGN KEY ("source_settlement_batch_id") REFERENCES "settlement_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_adjustments" ADD CONSTRAINT "settlement_adjustments_target_settlement_batch_id_fkey" FOREIGN KEY ("target_settlement_batch_id") REFERENCES "settlement_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_adjustments" ADD CONSTRAINT "settlement_adjustments_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "buyers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_adjustments" ADD CONSTRAINT "settlement_adjustments_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_instructions" ADD CONSTRAINT "payment_instructions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_instructions" ADD CONSTRAINT "payment_instructions_settlement_batch_id_fkey" FOREIGN KEY ("settlement_batch_id") REFERENCES "settlement_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_instructions" ADD CONSTRAINT "payment_instructions_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "buyers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_instructions" ADD CONSTRAINT "payment_instructions_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_executions" ADD CONSTRAINT "payment_executions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_executions" ADD CONSTRAINT "payment_executions_payment_instruction_id_fkey" FOREIGN KEY ("payment_instruction_id") REFERENCES "payment_instructions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_runs" ADD CONSTRAINT "reconciliation_runs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_runs" ADD CONSTRAINT "reconciliation_runs_settlement_batch_id_fkey" FOREIGN KEY ("settlement_batch_id") REFERENCES "settlement_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_issues" ADD CONSTRAINT "reconciliation_issues_reconciliation_run_id_fkey" FOREIGN KEY ("reconciliation_run_id") REFERENCES "reconciliation_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
