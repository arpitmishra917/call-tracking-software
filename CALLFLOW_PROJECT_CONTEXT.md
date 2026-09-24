# READ THIS FILE FIRST.

**MASTER SPECIFICATION:**  
MVP1_BUILD_SPEC_v5.md

*(The specification remains the product source of truth while this file describes the implemented repository.)*

## 1. What CallFlow is
CallFlow is a multi-tenant call tracking and sequential buyer-routing SaaS platform. It provisions tracking numbers, routes inbound calls to a sequence of buyers based on campaign priorities, and provides tracking, recording, and usage billing for its tenants.

## 2. Current architecture
Multi-tenant SaaS with Workspace-based isolation. The frontend communicates with a REST API backend. Telephony is abstracted behind a provider interface, with Telnyx as primary production and Twilio for development.

## 3. Tech stack
- **Frontend:** Next.js + React + TypeScript (App Router)
- **Backend:** NestJS + TypeScript
- **Database:** PostgreSQL + Prisma ORM
- **Authentication:** Supabase Auth (Asymmetric JWKS)
- **Billing:** Stripe

## 4. Product scope
- Telnyx tracking numbers
- Inbound call tracking
- Sequential buyer routing with fallback
- Campaign-specific buyer priority
- Blocked caller lists
- Call recording
- Usage metering & SaaS billing
- Authenticated Customer API & Webhooks
- Workspaces and Roles (OWNER, ADMIN, MEMBER, VIEWER)

## 5. Out-of-scope features
- Dynamic Number Insertion (DNI)
- Visitor/session tracking
- Interactive Voice Response (IVR)
- Geographic/Time routing
- Real-time bidding (RTB) / Ping/Post
- White label

## 6. Current implementation status
Stages 0 through 23 are implemented.
Routing sequential logic is IMPLEMENTED and MOCK VERIFIED. Real Telnyx campaign routing is NOT VERIFIED., however real production E2E has limitations (see below).

## 7. Current verified provider status
- **REAL TELNYX E2E VERIFIED** — provisioning through Call Control and call recording (Number: +14845560110, Resource ID: 3054705903149254493).
- **CAMPAIGN ROUTING REAL-PROVIDER E2E** — NOT VERIFIED.
- Twilio: Dev-only real E2E functional.

## 8. Main database entities
- Workspace, WorkspaceMember, Profile (Multi-tenancy/Auth)
- PhoneNumber, Campaign, Buyer, CampaignBuyer (Routing config)
- BlockedCaller
- Call, CallAttempt, Recording (Call execution)
- UsageRecord, Plan, Subscription, Invoice, BillingCustomer (Billing)
- ApiKey, OutboundWebhook, WebhookDelivery (API)

## 9. Main frontend routes
- /login, /signup, /auth/callback, /onboarding
- /protected (Dashboard)
- /protected/phone-numbers, /protected/campaigns, /protected/buyers, /protected/blocked-callers
- /protected/calls, /protected/calls/[callId]
- /protected/api-keys, /protected/billing

## 10. Main backend modules
- workspaces, uth, uthorization
- phone-numbers, 
outing
- 	elephony (Telnyx/Twilio adapters)
- calls, usage, illing
- pi-keys, public-api, webhooks

## 11. Authentication model
Supabase Auth provides identity. Frontend uses @supabase/ssr cookies. Backend uses passport-jwt verifying HS256 symmetrical tokens via JWT_SECRET.

## 12. Authorization model
Role-Based Access Control (RBAC) via WorkspaceMember. Decorators (@WorkspaceRoles) and Guards enforce isolation. All database reads/writes are tenant-scoped using workspace_id.

## 13. Routing model
Sequential priority-based fallback. Incoming calls check the blocklist, find the mapped Campaign, load active Buyers sorted by priority, and attempt them sequentially. The first to answer wins.

## 14. Telnyx model
Telnyx is the production provider via Call Control APIs. Uses webhook signatures (	elnyx-signature-ed25519). Provider abstraction ensures domain logic is isolated from Telnyx-specifics. Relies on TELNYX_CALL_CONTROL_APP_ID.

## 15. API model
Internal frontend REST API using Supabase tokens. Public customer API under /api/v1/* using hashed API keys with prefixes. Strict tenant-isolation.

## 16. Webhook model
Provider webhooks arrive at /api/webhooks/telnyx, use DB lock-based idempotency to prevent duplicate provider events. Note: Routing concurrency / double-routing across multiple active calls is a KNOWN LIMITATION. Customer outbound webhooks use atomic worker claiming, encrypted secrets, HMAC signing, and exponential retries.

## 17. Billing model
Stripe integration mapping Plans to Subscriptions. Usage (CALL_MINUTE, PHONE_NUMBER, RECORDING_STORAGE) is tracked separately from Billing.

## 18. Security model
Strict JWT validation, tenant isolation, hashed API keys, encrypted webhook secrets, SSRF protection for outbound hooks, HMAC signatures.

## 19. Testing model
Unit and integration testing. Fake providers for routing logic. Known limitations exist in E2E.

## 20. Important environment variables
- TELEPHONY_PROVIDER
- TELNYX_CALL_CONTROL_APP_ID
- TELNYX_API_KEY
- TELNYX_PUBLIC_KEY
- TWILIO_ACCOUNT_SID
- TWILIO_AUTH_TOKEN
- DATABASE_URL
- JWT_SECRET
- SUPABASE_URL

## 21. Known limitations
- SSRF protection (safeFetch) is vulnerable to TOCTOU DNS rebinding.
- Fresh production deployment, backup/restore, and rollback procedures are documented but NOT VERIFIED in reality.

## 22. Known test failures/limitations
- Routing-engine E2E concurrency/data-collision failure.

## 23. Production readiness status
- Implementation: VERIFIED
- Code tests: VERIFIED
- Production operational docs: IMPLEMENTED
- Fresh deployment/Infrastructure: NOT VERIFIED
- Backup/Restore/Rollback execution: NOT VERIFIED

## 24. Git workflow
- main: stable integration branch
- rontend-dev: Frontend development
- ackend-dev: Backend development
- documentation: Documentation changes

## 25. Documentation map
See docs/ for deep technical documentation covering architecture, modules, database, frontend, API, security, testing, operations, and development rules.

## 26. Rules for future AI agents
See docs/10-development/AGENT_RULES.md. Agents must NEVER invent APIs, modify without inspecting, expose secrets, or break working architecture.
