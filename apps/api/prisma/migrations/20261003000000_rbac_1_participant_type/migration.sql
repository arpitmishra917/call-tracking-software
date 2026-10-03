-- CreateEnum
CREATE TYPE "WorkspaceParticipantType" AS ENUM ('INTERNAL', 'VENDOR', 'BUYER');

-- AlterTable
ALTER TABLE "workspace_members" ADD COLUMN     "participant_type" "WorkspaceParticipantType" NOT NULL DEFAULT 'INTERNAL';

