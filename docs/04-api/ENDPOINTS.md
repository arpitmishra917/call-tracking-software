# Endpoints

## Workspaces API
### Method
GET
### Path
`/workspaces`
### Authentication
`Bearer <Supabase JWT>`
### Workspace requirement
None (returns user's workspaces)
### Roles
Any
### Request
None
### Response
Array of workspaces
### Errors
401 Unauthorized
### Implementation
`apps/api/src/workspaces/workspaces.controller.ts`
### Tests
`apps/api/src/workspaces/workspaces.spec.ts`

## Campaigns API
### Method
GET/POST/PATCH/DELETE
### Path
`/workspaces/:workspaceId/campaigns`
### Authentication
`Bearer <Supabase JWT>`
### Workspace requirement
Yes
### Roles
OWNER, ADMIN, MEMBER
### Request
JSON Campaign DTO
### Response
Campaign object
### Errors
401, 403, 404
### Implementation
`apps/api/src/routing/campaigns.controller.ts`
### Tests
`apps/api/src/routing/routing.spec.ts`

## Buyers API
### Method
GET/POST/PATCH/DELETE
### Path
`/workspaces/:workspaceId/buyers`
### Authentication
`Bearer <Supabase JWT>`
### Workspace requirement
Yes
### Roles
OWNER, ADMIN, MEMBER
### Request
JSON Buyer DTO
### Response
Buyer object
### Errors
401, 403, 404
### Implementation
`apps/api/src/routing/buyers.controller.ts`
### Tests
`apps/api/src/routing/routing.spec.ts`

## Phone Numbers API
### Method
GET/POST
### Path
`/workspaces/:workspaceId/phone-numbers`
### Authentication
`Bearer <Supabase JWT>`
### Workspace requirement
Yes
### Roles
OWNER, ADMIN, MEMBER
### Request
JSON Number Provisioning DTO
### Response
PhoneNumber object
### Errors
401, 403, 404, 500
### Implementation
`apps/api/src/phone-numbers/phone-numbers.controller.ts`
### Tests
`apps/api/src/phone-numbers/phone-numbers.spec.ts`
