# Workspace Provisioning Diagnostic Report

## 1. Current workspace creation flow
There is **no workspace creation flow** currently implemented in the codebase. 
- The NestJS `WorkspacesController` only contains `GET`, `PUT`, and `DELETE` endpoints. There is no `POST /workspaces` endpoint.
- The Next.js frontend (`apps/web`) has no `/onboarding` or workspace creation forms.
- The Prisma migrations do not contain any Postgres triggers on Supabase's `auth.users` to auto-create workspaces.

## 2. Current workspace membership flow
Similarly, there is no flow to create a `WorkspaceMember` for a newly signed-up user. When a user signs up via `apps/web/src/app/signup/page.tsx`, it only calls Supabase's `auth.signUp()`, which creates the user in the internal Supabase `auth.users` table, but nothing provisions the application's `profiles`, `workspaces`, or `workspace_members` tables.

## 3. Current test user's workspace count
**0** workspaces in the database are owned by or associated with the test user.

## 4. Current test user's membership count
**0** memberships exist for the test user. (In fact, a database check confirms the user doesn't even have a `Profile` record).

## 5. Exact reason why `/workspaces` returns `[]`
The API is functioning exactly as coded. It successfully authenticates the user, extracts the `sub` (User ID) from the ES256 JWT, and queries the `workspace_members` table for that `user_id`. Because the user was never provisioned a workspace or membership upon signup, the database correctly returns `0` results, resulting in `[]`.

## 6. Whether this is expected behavior for a newly registered user
Mechanically, this is the expected behavior of the current codebase because the provisioning logic was never built. The frontend correctly handles the empty array by rendering the expected empty state: `"No workspaces"` in the selector and `"Select a workspace first."` on the dashboard.

## 7. Smallest correct fix, if a fix is actually required
To resolve this product gap, we must implement provisioning. The smallest correct fix would be one of two approaches:

**Approach A (Database Trigger - Fully Automatic):**
Write a Prisma migration to add a Supabase Postgres trigger on `auth.users` that automatically inserts a `Profile`, a default `Workspace`, and a `WorkspaceMember` (as OWNER) whenever a user signs up.

**Approach B (API Endpoint + Onboarding UI):**
1. Add a `POST /workspaces` endpoint in the NestJS `WorkspacesController` that creates a Workspace and assigns the user as `OWNER`.
2. Add an `/onboarding` page in Next.js that prompts the user for a workspace name.
3. Update the `ProtectedLayout` so that if `workspaces.length === 0`, it redirects the user to `/onboarding`.
