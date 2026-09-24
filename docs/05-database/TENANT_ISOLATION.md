# Tenant Isolation
Every database query in a service must filter on `workspace_id`.
The `WorkspaceRolesGuard` confirms the acting user is a member of the workspace before the controller executes.
