# System Architecture

CallFlow uses a decoupled frontend-backend model built on Next.js and NestJS, backed by a PostgreSQL database managed by Prisma. 
Tenant isolation is enforced via Supabase authentication and strict Role-Based Access Control on the backend.
Telephony is abstracted behind a generic `TelephonyProvider` interface to separate domain logic from provider-specific details.

```mermaid
flowchart TD
    subgraph Frontend [Next.js Web App]
        UI[React Components]
        SC[Supabase Client]
    end

    subgraph Backend [NestJS API]
        AuthGuard[JWT Auth Guard]
        RBAC[Workspace Roles Guard]
        API[Controllers & Services]
        TA[Telephony Abstraction]
    end

    subgraph External
        Supabase[Supabase Auth]
        Telnyx[Telnyx / Twilio]
        Stripe[Stripe Billing]
    end

    DB[(PostgreSQL)]

    UI <--> |REST| AuthGuard
    UI <--> |Sign-in| Supabase
    SC -.-> |Token| AuthGuard
    AuthGuard --> RBAC
    RBAC --> API
    API <--> DB
    API <--> TA
    TA <--> Telnyx
    API <--> Stripe
```
