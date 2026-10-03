-- CreateEnum
CREATE TYPE "ReportVisibility" AS ENUM ('PERSONAL', 'SHARED');

-- CreateTable
CREATE TABLE "saved_reports" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "created_by_user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "visibility" "ReportVisibility" NOT NULL DEFAULT 'PERSONAL',
    "configuration" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "saved_reports_workspace_id_idx" ON "saved_reports"("workspace_id");

-- CreateIndex
CREATE INDEX "saved_reports_workspace_id_visibility_idx" ON "saved_reports"("workspace_id", "visibility");

-- CreateIndex
CREATE INDEX "saved_reports_workspace_id_created_by_user_id_idx" ON "saved_reports"("workspace_id", "created_by_user_id");

-- AddForeignKey
ALTER TABLE "saved_reports" ADD CONSTRAINT "saved_reports_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_reports" ADD CONSTRAINT "saved_reports_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
