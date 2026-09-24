# Workspaces

## Purpose
Tenant isolation layer. Manages workspace entities.

## Responsibilities
Manage workspaces logic for CallFlow.

## Architecture
Standard NestJS Controller-Service-Module pattern.

## Database
Interacts via `PrismaService`.

## API
Internal API accessed by frontend.

## Frontend
Pages located in `apps/web/src/app/protected/`.

## Backend
Implemented in `apps/api/src/workspaces/`.

## External providers
As required (e.g., Supabase, Telnyx).

## Security
Guarded by `JwtAuthGuard` and `WorkspaceRolesGuard`. Tenant isolated.

## State transitions
Defined in Prisma schema.

## Important files
- `apps/api/src/workspaces/`
- `apps/api/src/prisma/schema.prisma`

## Tests
- `apps/api/test/`
- Associated `.spec.ts` files in `apps/api/src/workspaces/`

## Known limitations
None specifically recorded outside of global limitations.

## Current verification status
IMPLEMENTED and VERIFIED (Automated mock testing).
