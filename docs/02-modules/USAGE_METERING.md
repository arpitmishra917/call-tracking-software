# Usage Metering

## Purpose
Records raw telecom usage for billing.

## Responsibilities
Manage usage metering logic for CallFlow.

## Architecture
Standard NestJS Controller-Service-Module pattern.

## Database
Interacts via `PrismaService`.

## API
Internal API accessed by frontend.

## Frontend
Pages located in `apps/web/src/app/protected/`.

## Backend
Implemented in `apps/api/src/usage/`.

## External providers
As required (e.g., Supabase, Telnyx).

## Security
Guarded by `JwtAuthGuard` and `WorkspaceRolesGuard`. Tenant isolated.

## State transitions
Defined in Prisma schema.

## Important files
- `apps/api/src/usage/`
- `apps/api/src/prisma/schema.prisma`

## Tests
- `apps/api/test/`
- Associated `.spec.ts` files in `apps/api/src/usage/`

## Known limitations
None specifically recorded outside of global limitations.

## Current verification status
IMPLEMENTED and VERIFIED (Automated mock testing).
