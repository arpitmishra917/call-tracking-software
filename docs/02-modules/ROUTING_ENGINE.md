# Routing Engine

## Purpose
Sequential buyer selection, priority sorting, fallback.

## Responsibilities
Manage routing engine logic for CallFlow.

## Architecture
Standard NestJS Controller-Service-Module pattern.

## Database
Interacts via `PrismaService`.

## API
Internal API accessed by frontend.

## Frontend
Pages located in `apps/web/src/app/protected/`.

## Backend
Implemented in `apps/api/src/routing/`.

## External providers
As required (e.g., Supabase, Telnyx).

## Security
Guarded by `JwtAuthGuard` and `WorkspaceRolesGuard`. Tenant isolated.

## State transitions
Defined in Prisma schema.

## Important files
- `apps/api/src/routing/`
- `apps/api/src/prisma/schema.prisma`

## Tests
- `apps/api/test/`
- Associated `.spec.ts` files in `apps/api/src/routing/`

## Known limitations
None specifically recorded outside of global limitations.

## Current verification status
Sequential routing is IMPLEMENTED and MOCK VERIFIED. 

**KNOWN LIMITATION**: Routing E2E exhibits concurrency/data-collision limitations when handling simultaneous active calls.
