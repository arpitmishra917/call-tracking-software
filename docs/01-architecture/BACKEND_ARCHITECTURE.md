# Backend Architecture
Implemented in `apps/api/` using NestJS.
- **Controllers:** Handle HTTP logic.
- **Services:** Execute core business/domain logic.
- **Providers:** Interface with external APIs (Prisma, Telnyx).
- **Guards:** Protect routes (`JwtAuthGuard`, `WorkspaceRolesGuard`).
- **Idempotency:** Webhooks use atomic locks to prevent duplicate processing.
