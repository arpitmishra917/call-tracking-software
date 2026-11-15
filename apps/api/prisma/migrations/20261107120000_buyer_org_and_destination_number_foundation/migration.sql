-- Step 2: Buyer Organization & Destination Number Foundation Migration
-- Safe, additive, idempotent DDL

-- 1. Add email column to buyers and relax legacy single-number constraints
ALTER TABLE "buyers" ADD COLUMN IF NOT EXISTS "email" TEXT;
ALTER TABLE "buyers" ALTER COLUMN "destination_number" DROP NOT NULL;
ALTER TABLE "buyers" ALTER COLUMN "destination_number" SET DEFAULT '';
ALTER TABLE "buyers" ALTER COLUMN "timeout" DROP NOT NULL;
ALTER TABLE "buyers" ALTER COLUMN "timeout" SET DEFAULT 30;
ALTER TABLE "buyers" ALTER COLUMN "max_concurrent_calls" DROP NOT NULL;
ALTER TABLE "buyers" ALTER COLUMN "max_concurrent_calls" SET DEFAULT 1;

-- 2. Create destination_numbers table
CREATE TABLE IF NOT EXISTS "destination_numbers" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "buyer_id" TEXT NOT NULL,
    "destination_number" TEXT NOT NULL,
    "name" TEXT,
    "timeout" INTEGER NOT NULL DEFAULT 30,
    "max_concurrent_calls" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "destination_numbers_pkey" PRIMARY KEY ("id")
);

-- Unique and indexing constraints for destination_numbers
CREATE UNIQUE INDEX IF NOT EXISTS "destination_numbers_workspace_id_destination_number_key" ON "destination_numbers"("workspace_id", "destination_number");
CREATE INDEX IF NOT EXISTS "destination_numbers_workspace_id_idx" ON "destination_numbers"("workspace_id");
CREATE INDEX IF NOT EXISTS "destination_numbers_buyer_id_idx" ON "destination_numbers"("buyer_id");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'destination_numbers_workspace_id_fkey'
    ) THEN
        ALTER TABLE "destination_numbers" ADD CONSTRAINT "destination_numbers_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'destination_numbers_buyer_id_fkey'
    ) THEN
        ALTER TABLE "destination_numbers" ADD CONSTRAINT "destination_numbers_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "buyers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- 3. Create campaign_destination_numbers table
CREATE TABLE IF NOT EXISTS "campaign_destination_numbers" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "destination_number_id" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 1,
    "weight" INTEGER NOT NULL DEFAULT 100,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_destination_numbers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "campaign_destination_numbers_campaign_id_destination_number_id_key" ON "campaign_destination_numbers"("campaign_id", "destination_number_id");
CREATE INDEX IF NOT EXISTS "campaign_destination_numbers_workspace_id_idx" ON "campaign_destination_numbers"("workspace_id");
CREATE INDEX IF NOT EXISTS "campaign_destination_numbers_campaign_id_idx" ON "campaign_destination_numbers"("campaign_id");
CREATE INDEX IF NOT EXISTS "campaign_destination_numbers_destination_number_id_idx" ON "campaign_destination_numbers"("destination_number_id");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'campaign_destination_numbers_workspace_id_fkey'
    ) THEN
        ALTER TABLE "campaign_destination_numbers" ADD CONSTRAINT "campaign_destination_numbers_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'campaign_destination_numbers_campaign_id_fkey'
    ) THEN
        ALTER TABLE "campaign_destination_numbers" ADD CONSTRAINT "campaign_destination_numbers_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'campaign_destination_numbers_destination_number_id_fkey'
    ) THEN
        ALTER TABLE "campaign_destination_numbers" ADD CONSTRAINT "campaign_destination_numbers_destination_number_id_fkey" FOREIGN KEY ("destination_number_id") REFERENCES "destination_numbers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- 4. Add destination snapshot columns to call_attempts
ALTER TABLE "call_attempts" ADD COLUMN IF NOT EXISTS "destination_number_id" TEXT;
ALTER TABLE "call_attempts" ADD COLUMN IF NOT EXISTS "destination_number" TEXT;

CREATE INDEX IF NOT EXISTS "call_attempts_destination_number_id_idx" ON "call_attempts"("destination_number_id");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'call_attempts_destination_number_id_fkey'
    ) THEN
        ALTER TABLE "call_attempts" ADD CONSTRAINT "call_attempts_destination_number_id_fkey" FOREIGN KEY ("destination_number_id") REFERENCES "destination_numbers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
