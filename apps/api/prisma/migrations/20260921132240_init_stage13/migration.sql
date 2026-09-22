-- CreateEnum
CREATE TYPE "CallState" AS ENUM ('INITIATED', 'ROUTING', 'COMPLETED', 'NO_ANSWER', 'FAILED', 'CANCELED');

-- CreateEnum
CREATE TYPE "CallAttemptState" AS ENUM ('INITIATED', 'RINGING', 'ANSWERED', 'COMPLETED', 'NO_ANSWER', 'FAILED', 'CANCELED');

-- CreateTable
CREATE TABLE "calls" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "campaign_id" TEXT,
    "provider" TEXT NOT NULL,
    "provider_call_id" TEXT NOT NULL,
    "from_number" TEXT NOT NULL,
    "to_number" TEXT NOT NULL,
    "state" "CallState" NOT NULL DEFAULT 'INITIATED',
    "duration_secs" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "call_attempts" (
    "id" TEXT NOT NULL,
    "call_id" TEXT NOT NULL,
    "buyer_id" TEXT NOT NULL,
    "provider_call_id" TEXT,
    "state" "CallAttemptState" NOT NULL DEFAULT 'INITIATED',
    "duration_secs" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "call_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "calls_provider_call_id_key" ON "calls"("provider_call_id");

-- CreateIndex
CREATE INDEX "calls_workspace_id_idx" ON "calls"("workspace_id");

-- CreateIndex
CREATE INDEX "calls_campaign_id_idx" ON "calls"("campaign_id");

-- CreateIndex
CREATE INDEX "calls_provider_call_id_idx" ON "calls"("provider_call_id");

-- CreateIndex
CREATE UNIQUE INDEX "call_attempts_provider_call_id_key" ON "call_attempts"("provider_call_id");

-- CreateIndex
CREATE INDEX "call_attempts_call_id_idx" ON "call_attempts"("call_id");

-- CreateIndex
CREATE INDEX "call_attempts_buyer_id_idx" ON "call_attempts"("buyer_id");

-- AddForeignKey
ALTER TABLE "calls" ADD CONSTRAINT "calls_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calls" ADD CONSTRAINT "calls_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_attempts" ADD CONSTRAINT "call_attempts_call_id_fkey" FOREIGN KEY ("call_id") REFERENCES "calls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_attempts" ADD CONSTRAINT "call_attempts_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "buyers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
