# Frontend Routes

| Route | Purpose | Auth | Workspace | API dependencies | Status |
|------|---------|------|-----------|------------------|--------|
| `/` | Landing | None | None | None | IMPLEMENTED |
| `/login` | Sign in | None | None | Supabase | IMPLEMENTED |
| `/signup` | Sign up | None | None | Supabase | IMPLEMENTED |
| `/auth/callback` | Auth redirect | None | None | Supabase | IMPLEMENTED |
| `/onboarding` | Initial setup | Required | None | `/workspaces` | IMPLEMENTED |
| `/protected` | Dashboard | Required | Required | Multiple | IMPLEMENTED |
| `/protected/phone-numbers` | List numbers | Required | Required | `/phone-numbers` | IMPLEMENTED |
| `/protected/campaigns` | Routing setup | Required | Required | `/campaigns` | IMPLEMENTED |
| `/protected/buyers` | Call destinations | Required | Required | `/buyers` | IMPLEMENTED |
| `/protected/calls` | Call history | Required | Required | `/calls` | IMPLEMENTED |
| `/protected/calls/[callId]` | Call details | Required | Required | `/calls/:id` | IMPLEMENTED |
| `/protected/blocked-callers` | Block list | Required | Required | `/blocked-callers` | IMPLEMENTED |
| `/protected/api-keys` | API keys | Required | Required | `/api-keys` | IMPLEMENTED |
| `/protected/billing` | SaaS billing | Required | Required | `/billing` | IMPLEMENTED |
