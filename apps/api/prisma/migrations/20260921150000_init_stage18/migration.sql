-- CreateEnum
CREATE TYPE "RecordingStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "UsageType" AS ENUM ('CALL_MINUTE', 'PHONE_NUMBER', 'RECORDING_STORAGE');

-- CreateTable
CREATE TABLE "recordings" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "call_id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "recording_url" TEXT,
    "duration_secs" INTEGER,
    "status" "RecordingStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recordings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_records" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "type" "UsageType" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "source_id" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "usage_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "recordings_provider_id_key" ON "recordings"("provider_id");

-- CreateIndex
CREATE INDEX "recordings_workspace_id_idx" ON "recordings"("workspace_id");

-- CreateIndex
CREATE INDEX "recordings_call_id_idx" ON "recordings"("call_id");

-- CreateIndex
CREATE UNIQUE INDEX "usage_records_idempotency_key_key" ON "usage_records"("idempotency_key");

-- CreateIndex
CREATE INDEX "usage_records_workspace_id_idx" ON "usage_records"("workspace_id");

-- CreateIndex
CREATE INDEX "usage_records_type_idx" ON "usage_records"("type");

-- AddForeignKey
ALTER TABLE "recordings" ADD CONSTRAINT "recordings_call_id_fkey" FOREIGN KEY ("call_id") REFERENCES "calls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recordings" ADD CONSTRAINT "recordings_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

