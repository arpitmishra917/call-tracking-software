-- CreateTable
CREATE TABLE "workspace_member_buyers" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "workspace_member_id" TEXT NOT NULL,
    "buyer_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_member_buyers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "workspace_member_buyers_workspace_member_id_buyer_id_key" ON "workspace_member_buyers"("workspace_member_id", "buyer_id");

-- CreateIndex
CREATE INDEX "workspace_member_buyers_workspace_id_idx" ON "workspace_member_buyers"("workspace_id");

-- CreateIndex
CREATE INDEX "workspace_member_buyers_workspace_member_id_idx" ON "workspace_member_buyers"("workspace_member_id");

-- CreateIndex
CREATE INDEX "workspace_member_buyers_buyer_id_idx" ON "workspace_member_buyers"("buyer_id");

-- AddForeignKey
ALTER TABLE "workspace_member_buyers" ADD CONSTRAINT "workspace_member_buyers_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_member_buyers" ADD CONSTRAINT "workspace_member_buyers_workspace_member_id_fkey" FOREIGN KEY ("workspace_member_id") REFERENCES "workspace_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_member_buyers" ADD CONSTRAINT "workspace_member_buyers_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "buyers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill existing buyer memberships into workspace_member_buyers
-- Only for members with participant_type = 'BUYER' where buyer_id is not null
-- and the buyer belongs to the same workspace as the member
INSERT INTO "workspace_member_buyers" ("id", "workspace_id", "workspace_member_id", "buyer_id", "created_at")
SELECT 
    md5(random()::text || clock_timestamp()::text || wm."id"),
    wm."workspace_id",
    wm."id",
    wm."buyer_id",
    NOW()
FROM "workspace_members" wm
INNER JOIN "buyers" b ON b."id" = wm."buyer_id" AND b."workspace_id" = wm."workspace_id"
WHERE wm."participant_type" = 'BUYER' 
  AND wm."buyer_id" IS NOT NULL
ON CONFLICT ("workspace_member_id", "buyer_id") DO NOTHING;
