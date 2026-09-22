# API Client Diagnostic Report

## 1. Exact reason Campaign API gets 401
The `CampaignsController` in the NestJS backend is decorated with `@UseGuards(WorkspaceRolesGuard)` but is completely missing the `@UseGuards(JwtAuthGuard)` decorator. Because `JwtAuthGuard` never runs, the `request.user` property is never populated from the incoming JWT token. Subsequently, the `WorkspaceRolesGuard` detects that `request.user` is undefined and immediately throws a 401 `UnauthorizedException('Authentication required')`.

## 2. Exact reason Buyer API gets 401
Exactly the same reason. The `BuyersController` is missing the `@UseGuards(JwtAuthGuard)` decorator, causing the roles guard to fail due to a missing user object.

## 3. Whether Authorization header is missing or invalid
The `Authorization` header is **PRESENT** and valid. 
The client-side `apiFetch()` utility successfully reads the browser session via `supabase.auth.getSession()` and attaches the `Authorization: Bearer <token>` header. We know the session is present because if it weren't, `apiFetch()` would throw a local client error (`"Not authenticated"`) rather than yielding a server-issued 401 JSON response. The failure is entirely backend-side due to missing guards.

## 4. Which component is responsible for constructing the request
The `apiFetch()` utility located in `apps/web/src/lib/api.ts` constructs the request. It correctly builds a browser-side Supabase client, extracts the active `access_token`, and seamlessly attaches it to the HTTP `Headers` object alongside the `Content-Type`.

## 5. Why protected page authentication still works
The backend controllers serving those specific routes—such as `WorkspacesController` and `CallsController`—are properly configured. They explicitly include `@UseGuards(JwtAuthGuard, WorkspaceRolesGuard)` or equivalent. For those requests, the `JwtAuthGuard` intercepts the `Authorization` header, mathematically verifies the ES256 signature using the JWKS, and injects the authenticated `userId` into `request.user`. The roles guard then uses that ID to successfully evaluate workspace permissions.

## 6. Working request vs failing request comparison
- **Working request (`CallsController`):** 
  Decorated with `@UseGuards(JwtAuthGuard, WorkspaceRolesGuard)`. Request arrives → Token validated → User injected → Roles checked (PASS).
- **Failing request (`CampaignsController`):** 
  Decorated with `@UseGuards(WorkspaceRolesGuard)`. Request arrives → Roles checked immediately → User undefined (FAIL - 401).

## 7. Smallest correct fix
Add the `JwtAuthGuard` to the `@UseGuards` decorator list on all backend controllers that are currently missing it. The correct implementation pattern should look like:
`@UseGuards(JwtAuthGuard, WorkspaceRolesGuard)`

## 8. Recommended files that would need modification
Based on the codebase inspection, the following controllers enforce `WorkspaceRolesGuard` but are missing `JwtAuthGuard`:
- `apps/api/src/routing/campaigns.controller.ts`
- `apps/api/src/routing/buyers.controller.ts`
- `apps/api/src/routing/blocked-callers.controller.ts`
- `apps/api/src/phone-numbers/phone-numbers.controller.ts`
