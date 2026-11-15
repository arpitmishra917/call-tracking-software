# CALLFLOW — AGENT 1 (FRONTEND)
## PHASE 2: IMPLEMENTED FIX CHANGELOG

**Author:** Agent 1 — Frontend, UI, UX & Client-Side Functionality  
**Scope:** Strictly Frontend (`apps/web/*`)  
**Date:** November 12, 2026  
**Status:** 100% Implemented, Built & Verified  

---

### File 1: `apps/web/src/app/page.tsx`
- **Bug ID:** `CB-FE-001`
- **Description:** Replaced standard create-next-app starter boilerplate with auth-aware redirect logic.
- **Verification:** Unit test `apps/web/src/app/page.test.tsx` (2/2 PASSED) and production build.

#### Code Diff:
```diff
-import Image from "next/image";
-
-export default function Home() {
-  return (
-    <div className="grid grid-rows-[20px_1fr_20px] items-center justify-items-center min-h-screen p-8 pb-20 gap-16 sm:p-20 font-[family-name:var(--font-geist-sans)]">
-      <main className="flex flex-col gap-8 row-start-2 items-center sm:items-start">
-        <Image
-          className="dark:invert"
-          src="/next.svg"
-          alt="Next.js logo"
-          width={180}
-          height={38}
-          priority
-        />
-...
+import { createClient } from '@/utils/supabase/server';
+import { redirect } from 'next/navigation';
+
+export default async function RootPage() {
+  const supabase = await createClient();
+  const {
+    data: { user },
+  } = await supabase.auth.getUser();
+
+  if (user) {
+    redirect('/protected');
+  } else {
+    redirect('/login');
+  }
+}
```

---

### File 2: `apps/web/src/utils/supabase/middleware.ts`
- **Bug ID:** `CB-FE-002`
- **Description:** Preserved invitation tokens when unauthenticated users visit invitation routes.
- **Verification:** Unit test `apps/web/src/utils/supabase/middleware.spec.ts` (6/6 PASSED).

#### Code Diff:
```diff
     const isPublicRoute =
       request.nextUrl.pathname.startsWith('/login') ||
       request.nextUrl.pathname.startsWith('/auth') ||
+      request.nextUrl.pathname.startsWith('/invitations') ||
       request.nextUrl.pathname.startsWith('/signup');

+    const isInviteRoute =
+      request.nextUrl.pathname.startsWith('/protected/accept-invitation') ||
+      request.nextUrl.pathname.startsWith('/protected/invitations');
+    const token = request.nextUrl.searchParams.get('token');

     if (!user && !isPublicRoute) {
+      if (isInviteRoute && token) {
+        const url = request.nextUrl.clone();
+        url.pathname = '/invitations';
+        url.searchParams.set('token', token);
+        return NextResponse.redirect(url);
+      }
       const url = request.nextUrl.clone();
       url.pathname = '/login';
       return NextResponse.redirect(url);
     }
```

---

### File 3: `apps/web/src/components/header.tsx`
- **Bug ID:** `CB-FE-003`
- **Description:** Decoupled live calls polling from billing balance polling using `Promise.allSettled`.
- **Verification:** Unit test `apps/web/src/components/header.test.tsx` (4/4 PASSED).

#### Code Diff:
```diff
-      try {
-        const [liveCallsRes, balanceRes] = await Promise.all([
-          apiFetch('/calls/live-calls'),
-          apiFetch('/billing/balance'),
-        ]);
-        if (isMounted) {
-          setLiveCalls(liveCallsRes.activeCalls ?? 0);
-          setBalance(balanceRes.balance ?? null);
-        }
-      } catch {
-        // Ignore polling errors silently
-      }
+      try {
+        const [liveCallsResult, balanceResult] = await Promise.allSettled([
+          apiFetch('/calls/live-calls'),
+          apiFetch('/billing/balance'),
+        ]);
+
+        if (isMounted) {
+          if (liveCallsResult.status === 'fulfilled') {
+            setLiveCalls(liveCallsResult.value.activeCalls ?? 0);
+          }
+          if (balanceResult.status === 'fulfilled') {
+            setBalance(balanceResult.value.balance ?? null);
+          } else {
+            setBalance(null);
+          }
+        }
+      } catch {
+        // Ignore polling errors silently
+      }
```

---

### File 4: `apps/web/src/lib/payments.ts`
- **Bug ID:** `CB-FE-004`
- **Description:** Standardized `PaymentInstruction.direction` enum type to canonical `'COLLECTION' | 'DISBURSEMENT'`.
- **Verification:** TypeScript compilation and `apps/web/src/app/protected/payments/page.test.tsx` (20/20 PASSED).

#### Code Diff:
```diff
 export interface PaymentInstruction {
   id: string;
   workspace_id: string;
   settlement_batch_id: string;
-  direction: 'COLLECTION' | 'PAYOUT';
+  direction: 'COLLECTION' | 'DISBURSEMENT';
   amount: string;
   currency: string;
```

---

### File 5: `apps/web/src/app/onboarding/onboarding-client.tsx`
- **Bug ID:** `CB-FE-005`
- **Description:** Captured created workspace ID, synchronized `sessionStorage`, and routed directly to reporting dashboard with workspace context.
- **Verification:** Unit test `apps/web/src/app/onboarding/page.test.tsx` (4/4 PASSED).

#### Code Diff:
```diff
-      await apiFetch('/workspaces', {
+      const created = await apiFetch('/workspaces', {
         method: 'POST',
         body: JSON.stringify({ name }),
       });
-      router.push('/protected');
+      const createdWorkspaceId = created?.id;
+      if (createdWorkspaceId && typeof window !== 'undefined') {
+        sessionStorage.setItem('callflow.active_workspace_id', createdWorkspaceId);
+      }
+      if (createdWorkspaceId) {
+        router.push(`/protected/reporting?workspace=${createdWorkspaceId}`);
+      } else {
+        router.push('/protected/reporting');
+      }
+      router.refresh();
```

---

### File 6: `apps/web/src/app/protected/reporting/page.tsx`
- **Bug IDs:** `CB-FE-006`, `CB-FE-007`
- **Description:**
  1. Eliminated infinite fetch/re-render loop causing recording playback test timeouts by stabilizing `searchParamsString = searchParams.toString()` in `useCallback` dependency array and adding `hasNew` guard to `setCampaigns`.
  2. Made `localStorage` column configuration restore logic defensive: checks `Array.isArray(parsed)`, maps valid items, and appends newly introduced default columns without destroying saved order.
- **Verification:** Integration tests `apps/web/src/app/protected/reporting/reporting-recording-playback.test.tsx` (5/5 PASSED).

#### Code Diff:
```diff
+  const searchParamsString = searchParams.toString();
+
   const fetchReporting = useCallback(async () => {
...
-        setCampaigns(extractedCampaigns);
+        setCampaigns(prev => {
+          const hasNew = extractedCampaigns.some(c => !prev.some(p => p.id === c.id));
+          return hasNew || prev.length !== extractedCampaigns.length ? extractedCampaigns : prev;
+        });
...
-  }, [workspaceId, searchParams, rangeFilter, startDate, endDate, selectedCampaign, selectedPublisher, selectedBuyer]);
+  }, [workspaceId, searchParamsString, rangeFilter, startDate, endDate, selectedCampaign, selectedPublisher, selectedBuyer]);

...

-      if (saved) {
-        const parsed = JSON.parse(saved);
-        const filtered = parsed.filter((p: any) => validIds.has(p.id));
-        
-        const newCols = DEFAULT_COLUMNS.map(def => {
-          const found = filtered.find((p: any) => p.id === def.id);
-          if (found) {
-            return { ...def, visible: def.locked ? true : found.visible, order: found.order };
-          }
-          return def;
-        }).sort((a, b) => a.order - b.order);
-        
-        setColumns(newCols);
-      }
+      if (saved) {
+        const parsed = JSON.parse(saved);
+        if (Array.isArray(parsed)) {
+          const filtered = parsed.filter((p: any) => p && typeof p === 'object' && validIds.has(p.id));
+          let maxSavedOrder = -1;
+          const savedMap = new Map<string, { visible: boolean; order: number }>();
+          for (const item of filtered) {
+            const order = typeof item.order === 'number' ? item.order : 0;
+            savedMap.set(item.id, {
+              visible: typeof item.visible === 'boolean' ? item.visible : true,
+              order,
+            });
+            if (order > maxSavedOrder) maxSavedOrder = order;
+          }
+          const newCols = DEFAULT_COLUMNS.map(def => {
+            const found = savedMap.get(def.id);
+            if (found) {
+              return { ...def, visible: def.locked ? true : found.visible, order: found.order };
+            }
+            maxSavedOrder += 1;
+            return { ...def, order: maxSavedOrder };
+          }).sort((a, b) => a.order - b.order);
+          newCols.forEach((c, i) => { c.order = i; });
+          setColumns(newCols);
+          return;
+        }
+      }
```

---

### File 7: `apps/web/src/lib/api.ts`
- **Bug ID:** `CB-FE-008`
- **Description:** Enhanced `apiFetch` error handling to parse NestJS `{ message }` arrays and objects into human-readable strings while attaching `.status` and `.statusCode`.
- **Verification:** Full API error handling unit tests and invitation/webhooks suites.

#### Code Diff:
```diff
     if (!res.ok) {
       const text = await res.text();
+      let detailedMessage = text;
+      try {
+        const parsed = JSON.parse(text);
+        if (parsed && parsed.message) {
+          detailedMessage = Array.isArray(parsed.message)
+            ? parsed.message.join(', ')
+            : String(parsed.message);
+        }
+      } catch {
+        // Keep original text
+      }
-      const error = new Error(`API error (${res.status}): ${text}`);
+      const error = new Error(`API error (${res.status}): ${detailedMessage}`) as any;
+      error.status = res.status;
+      error.statusCode = res.status;
       throw error;
     }
```

---

### File 8 & 9: `apps/web/src/app/login/page.tsx` & `apps/web/src/app/signup/page.tsx`
- **Bug ID:** `CB-FE-009`
- **Description:** Added defensive server-side redirect for authenticated users navigating to `/login` or `/signup`.
- **Verification:** Unit tests `apps/web/src/app/login/page.test.tsx` (3/3 PASSED) and `apps/web/src/app/auth-recovery.spec.tsx` (10/10 PASSED).

#### Code Diff:
```diff
 export default async function LoginPage(
   props: { searchParams: Promise<{ token?: string, message?: string }> }
 ) {
   const searchParams = await props.searchParams;
   const token = searchParams.token;
 
+  const supabase = await createClient();
+  const authUserResult = typeof supabase?.auth?.getUser === 'function' ? await supabase.auth.getUser() : null;
+  const user = authUserResult?.data?.user;
+
+  if (user) {
+    if (token) {
+      redirect(`/protected/accept-invitation?token=${token}`);
+    } else {
+      redirect('/protected');
+    }
+  }
```

---

### File 10: `apps/web/src/app/protected/webhooks/page.tsx`
- **Description:** Cleaned up PowerShell escaped newline literal syntax artifact (`n`n) before `ConfirmDialog`.
- **Verification:** Unit tests `apps/web/src/app/protected/webhooks/page.test.tsx` (4/4 PASSED).

#### Code Diff:
```diff
-      `n`n      <ConfirmDialog
+      <ConfirmDialog
         open={!!deleteWebhookId}
         title="Delete Webhook"
```
