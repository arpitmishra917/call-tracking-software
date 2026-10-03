-- AlterTable
ALTER TABLE "workspace_invitations" ADD COLUMN     "buyer_id" TEXT,
ADD COLUMN     "participant_type" "WorkspaceParticipantType" NOT NULL DEFAULT 'INTERNAL',
ADD COLUMN     "vendor_id" TEXT;

-- AddForeignKey
ALTER TABLE "workspace_invitations" ADD CONSTRAINT "workspace_invitations_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_invitations" ADD CONSTRAINT "workspace_invitations_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "buyers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

