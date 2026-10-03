-- CreateTable
CREATE TABLE "permissions" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "group" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_member_permissions" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "workspace_member_id" TEXT NOT NULL,
    "permission_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_member_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "permissions_key_key" ON "permissions"("key");

-- CreateIndex
CREATE INDEX "workspace_member_permissions_workspace_id_idx" ON "workspace_member_permissions"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_member_permissions_workspace_member_id_permission_key" ON "workspace_member_permissions"("workspace_member_id", "permission_id");

-- AddForeignKey
ALTER TABLE "workspace_member_permissions" ADD CONSTRAINT "workspace_member_permissions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_member_permissions" ADD CONSTRAINT "workspace_member_permissions_workspace_member_id_fkey" FOREIGN KEY ("workspace_member_id") REFERENCES "workspace_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_member_permissions" ADD CONSTRAINT "workspace_member_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

