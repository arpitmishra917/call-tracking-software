CREATE UNIQUE INDEX IF NOT EXISTS unique_owner_per_user ON "workspace_members" (user_id) WHERE role = 'OWNER';
