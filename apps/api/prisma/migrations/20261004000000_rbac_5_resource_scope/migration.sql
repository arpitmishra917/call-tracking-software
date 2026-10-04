-- CreateEnum
CREATE TYPE "ResourceScopeType" AS ENUM ('ALL', 'ASSIGNED', 'CAMPAIGN', 'PHONE_NUMBER', 'BUYER', 'VENDOR');

-- DropIndex
DROP INDEX "workspace_member_permissions_workspace_member_id_permission_key";

-- AlterTable
ALTER TABLE "workspace_member_permissions" ADD COLUMN     "resource_id" TEXT,
ADD COLUMN     "scope_type" "ResourceScopeType" NOT NULL DEFAULT 'ALL';

