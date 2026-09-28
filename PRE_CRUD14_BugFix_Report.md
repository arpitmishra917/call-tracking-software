# PRE-CRUD-14 BUG FIX REPORT

## Root Cause
The `campaigns.map is not a function` error occurred because CRUD-9 introduced pagination to the backend (`listCampaigns`, `listBuyers`, etc.), causing the API to return a paginated response object of the shape `{ items, total }`. However, the frontend pages were still expecting the raw `data` array directly and calling `.map` on the object itself.

## API Response
The backend returns a paginated JSON response with the following shape:
```json
{
  "items": [ ... ],
  "total": 0
}
```

## Fix
Updated the `apiFetch` response handling directly within the affected frontend components. The state setters now safely extract `.items` if it exists, falling back to the raw `data` (to support non-paginated endpoints or mock data), and defaulting to an empty array to prevent `.map` from ever throwing an error.

Example change:
`setCampaigns(data);` → `setCampaigns(data?.items || data || []);`

## Paginated Page Audit
All relevant pages were audited and confirmed:
- **Campaigns:** FAIL (Fixed during this pass)
- **Buyers:** FAIL (Fixed during this pass)
- **Phone Numbers:** FAIL (Fixed during this pass)
- **Blocked Callers:** FAIL (Fixed during this pass)
- **Calls:** PASS (Already correctly implemented `setCalls(data.items)` during CRUD-9)

## Tests
**Command:** (Frontend has no unit tests configured yet)

## Typecheck
**Command:** `npm run typecheck --prefix apps/web`
**Result:** 0 errors

## Lint
**Command:** `npm run lint --prefix apps/web`
**Result:** 0 errors, 0 warnings

## Build
**Command:** `npm run build --prefix apps/web`
**Result:** Compiled successfully. 0 errors.

## Manual Browser Verification
- Campaigns: page loads, cards render, pagination/create/edit work. (No runtime `*.map is not a function` errors).
- Buyers: page loads, list renders.
- Phone Numbers: page loads, list renders.
- Blocked Callers: page loads, list renders.
- Calls: page loads, list renders.

## Files Changed
- `apps/web/src/app/protected/campaigns/page.tsx`
- `apps/web/src/app/protected/buyers/page.tsx`
- `apps/web/src/app/protected/phone-numbers/page.tsx`
- `apps/web/src/app/protected/blocked-callers/page.tsx`

## Remaining Issues
None related to the `.map` bug.

## CRUD-14 Status
NOT STARTED
