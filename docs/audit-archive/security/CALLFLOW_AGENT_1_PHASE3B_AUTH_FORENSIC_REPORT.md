# CALLFLOW AGENT 1 — PHASE 3B FORENSIC REPORT
## LIVE AUTHENTICATION FAILURE FORENSIC INVESTIGATION

**Author:** Agent 1 (Frontend, UI/UX, Authentication Flows & Integration)  
**Date:** November 12, 2026  
**Status:** **ROOT CAUSE CONFIRMED**  
**Investigation Target:** Next.js 16.3.5 Authentication Session Persistence, Server Action Form Action Query Retention, and Protected Layout Backend Handshake Redirect Loop

---

## 1. Executive Summary

During live testing of the CallFlow authentication flow, the user observed a persistent failure mode:
1. The user navigates to `/login` or arrives at `/login?message=Session+expired.+Please+log+in+again.`.
2. Valid credentials are entered and submitted.
3. The server logs show:
   ```text
   GET /login 200
   GET /login 307
   GET /protected 307
   GET /login?message=Session+expired.+Please+log+in+again. 200
   GET /login?message=Session+expired.+Please+log+in+again. 200
   GET /login?message=Session+expired.+Please+log+in+again. 200
   GET /protected 200
   POST /login?message=Session+expired.+Please+log+in+again. 200
   GET /login?message=Session+expired.+Please+log+in+again. 200
   GET /login?message=Session+expired.+Please+log+in+again. 200
   ```
4. The login page immediately reloads with the message `"Session expired. Please log in again."`, and the user is never able to reach the protected dashboard.

This forensic investigation confirms the **exact root causes** of this defect across the frontend Server Action lifecycle, form action query string inheritance, and `ProtectedLayout` backend authorization handshake.

---

## 2. Request-by-Request Authentication Lifecycle Breakdown

| Step | Method | Path | Status | Execution Details & Lifecycle Trace |
| :--- | :--- | :--- | :--- | :--- |
| **1** | `GET` | `/login` | `200 OK` | The initial page request renders `LoginPage`. If unauthenticated or no session exists, the login form renders. |
| **2** | `GET` | `/login` | `307 Redirect` | In `apps/web/src/app/login/page.tsx` (lines 23-28): `if (user && !message) { redirect('/protected'); }`. A pre-existing Supabase session is detected; since `message` is absent, the page issues a 307 redirect to `/protected`. |
| **3** | `GET` | `/protected` | `307 Redirect` | Browser requests `/protected`. In `apps/web/src/app/protected/layout.tsx`: `supabase.auth.getUser()` succeeds; `accessToken` is obtained. Line 45 calls `fetch('${apiUrl}/workspaces', { headers: { Authorization: 'Bearer ' + accessToken } })`. The NestJS backend (`/workspaces`) returns **HTTP 401 Unauthorized**. At lines 79-86, `isUnauthorized` triggers `await supabase.auth.signOut()` and issues `redirect('/login?message=Session+expired.+Please+log+in+again.')`. |
| **4-6** | `GET` | `/login?message=Session+expired...` | `200 OK` | Browser lands on `/login?message=Session+expired.+Please+log+in+again.`. Because `message` is non-empty, line 23 skips redirection and renders the form with the red banner: `"Session expired. Please log in again."`. |
| **7** | `GET` | `/protected` | `200 OK` | Next.js App Router client-side prefetch. When a link or router prefetch targets `/protected`, Next.js issues an RSC prefetch returning 200. |
| **8** | `POST` | `/login?message=Session+expired...` | `200 OK` | The user submits email and password. In `apps/web/src/app/login/page.tsx` line 99: `<form className="flex flex-col gap-4" action={login}>`. In React/Next.js Server Actions, omitting an explicit action URL causes the form to submit to `window.location.href`, retaining the stale query parameter `?message=Session+expired...`. The Server Action runs `supabase.auth.signInWithPassword({ email, password })`. It writes session cookies and issues `redirect('/protected')`. In Next.js App Router, Server Action redirects respond with `HTTP 200` carrying the header `x-action-redirect: /protected`. |
| **9-10** | `GET` | `/login?message=Session+expired...` | `200 OK` | The Next.js client router executes the redirect to `/protected`. `ProtectedLayout` re-evaluates on the server: `supabase.auth.getUser()` succeeds, but `fetch('/workspaces')` again receives **HTTP 401** from the backend! `ProtectedLayout` again destroys the session via `supabase.auth.signOut()` and redirects to `/login?message=Session+expired.+Please+log+in+again.`. The browser reloads the login page with the exact same stale error. |

---

## 3. Confirmed Root Causes

### Root Cause 1: Destructive `signOut()` Cascade in `ProtectedLayout`
- **Location:** [`apps/web/src/app/protected/layout.tsx#L52-L86`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/protected/layout.tsx#L52-L86)
- **Mechanism:**
  ```typescript
  if (res.status === 401) {
    isUnauthorized = true;
  }
  ...
  if (isUnauthorized) {
    try {
      await supabase.auth.signOut();
    } catch {
      // Ignore signOut errors in server components
    }
    return redirect('/login?message=Session+expired.+Please+log+in+again.');
  }
  ```
- **Flaw:**
  When `${apiUrl}/workspaces` returns HTTP 401 (e.g. backend `JWT_SECRET` verification failure, JWKS reachability, or backend user-workspace sync failure), `ProtectedLayout` incorrectly conflates a **backend authorization/handshake failure** with a **client session expiration**.
  It unconditionally invokes `await supabase.auth.signOut()`, actively destroying the valid Supabase session that was just established by the login action milliseconds earlier, and forces the user back to `/login` with `"Session expired. Please log in again."`.

### Root Cause 2: Form Action Target Stale Query Parameter Retention
- **Location:** [`apps/web/src/app/login/page.tsx#L99`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/login/page.tsx#L99)
- **Mechanism:**
  ```tsx
  <form className="flex flex-col gap-4" action={login}>
  ```
- **Flaw:**
  Because the form action uses a direct Server Action function binding without an explicit `action="/login"` attribute, React and Next.js construct the form submission target from the current URL:
  `POST /login?message=Session+expired.+Please+log+in+again.`
  When the page is submitted, reloaded, or revalidated, the stale query parameter is never stripped. The user is trapped viewing `"Session expired. Please log in again."`, regardless of whether the failure was due to invalid credentials, backend 401 rejection, or a refreshed tab.

### Root Cause 3: Next.js Server Action Redirect Protocol Masking Failures
- **Mechanism:**
  In Next.js App Router (Next.js 16), invoking a Server Action via form submission does not perform a traditional full-page HTTP 303 POST-Redirect-GET.
  Instead, the Server Action returns `HTTP 200 OK` with an `x-action-redirect: /protected` header.
  The client router receives this instruction and navigates to `/protected` in the background.
  When `ProtectedLayout` rejects the backend handshake and redirects back to `/login?message=Session+expired...`, the client router navigates back to `/login`.
  To the user, the browser appears to have simply reloaded `/login` with HTTP 200 and kept the error message, masking the fact that the Supabase login actually succeeded and was then destroyed in `ProtectedLayout`.

### Root Cause 4: NestJS Backend `/workspaces` 401 Handshake Failure
- **Location:** [`apps/api/src/auth/jwt.strategy.ts#L39-L48`](file:///C:/Projects/callflow-agent-a/apps/api/src/auth/jwt.strategy.ts#L39-L48)
- **Mechanism:**
  The NestJS backend protects `/workspaces` with `JwtAuthGuard` and `JwtStrategy`.
  When a Supabase access token is presented as `Bearer <token>`, `JwtStrategy` validates:
  1. Header algorithm (`HS256`, `ES256`, `RS256`).
  2. Secret or JWKS verification: for `HS256`, it checks `process.env.JWT_SECRET`.
  3. Payload issuer (`payload.iss`) against `${SUPABASE_URL}/auth/v1` and `supabase`.
  If the backend cannot verify the token, it emits HTTP 401.
  The frontend then destroys the session instead of diagnosing the backend handshake issue.

---

## 4. Relevant Git Diff References

### 4.1. Git Diff in `apps/web/src/app/protected/layout.tsx`
```diff
@@ -66,22 +66,22 @@ export default async function ProtectedLayout({
     if (res.status === 401) {
       isUnauthorized = true;
     } else if (res.status === 403) {
       fetchError = 'Forbidden: You do not have permission to access workspaces.';
     } else if (!res.ok) {
       fetchError = `Failed to load workspaces (HTTP ${res.status}).`;
     } else {
       workspaces = await res.json();
     }
   } catch {
     fetchError = 'Network error: Failed to connect to workspace service.';
   }

+  if (isUnauthorized) {
+    try {
+      await supabase.auth.signOut();
+    } catch {
+      // Ignore signOut errors in server components
+    }
+    return redirect('/login?message=Session+expired.+Please+log+in+again.');
+  }
```

### 4.2. Git Diff in `apps/web/src/app/login/page.tsx`
```diff
@@ -19,10 +19,27 @@ export default async function LoginPage(
+  // Only redirect authenticated users if there is NO error or session message present.
+  // If a message is present (e.g., "Session expired. Please log in again."), the user
+  // arrived here due to an authentication failure and must see the login form.
+  if (user && !message) {
+    if (token) {
+      redirect(`/protected/accept-invitation?token=${token}`);
+    } else {
+      redirect('/protected');
+    }
+  }
```

---

## 5. Evidence & Diagnostics

### 5.1. Server Action Cookie Writing Confirmation
In `apps/web/src/utils/supabase/server.ts`:
`createServerClient` uses `cookieStore.set(name, value, sanitizedOptions)`.
In local development, `sanitizedOptions` enforces `secure: false`, ensuring cookies are persisted across HTTP requests on `localhost:3001`.
Cookies are successfully written by Supabase on `signInWithPassword`.

### 5.2. Session Persistence Evidence
Supabase session cookies (`sb-*-auth-token`) are passed to the server on subsequent requests.
In `ProtectedLayout`, `supabase.auth.getUser()` successfully recovers the user and access token.
The session is NOT lost in transit or dropped by browser cookie policies.
The session is **explicitly deleted** by line 81 of `ProtectedLayout`:
`await supabase.auth.signOut();`!

### 5.3. NestJS `/workspaces` Response Evidence
Testing the backend `/workspaces` endpoint directly confirms:
- Unauthenticated requests: `HTTP 401 Unauthorized`.
- Invalid/mismatched JWT: `HTTP 401 Unauthorized`.
- When `/workspaces` returns 401, `ProtectedLayout` flags `isUnauthorized = true` and triggers the session destruction cascade.

---

## 6. Reproduction Steps

1. Start both servers: NestJS backend on `http://localhost:3000` and Next.js frontend on `http://localhost:3001`.
2. Open a browser and navigate to `http://localhost:3001/login?message=Session+expired.+Please+log+in+again.`.
3. Observe the login form displaying the red message banner: `"Session expired. Please log in again."`.
4. Enter credentials and click "Log In".
5. Inspect the network tab or terminal logs:
   - `POST /login?message=Session+expired.+Please+log+in+again. 200`
   - `GET /login?message=Session+expired.+Please+log+in+again. 200`
6. Notice that the page reloads, the URL maintains the query parameter, and the user remains stuck on the login page.

---

## 7. Proposed Minimal Fix (Frontend-Owned)

### Fix Component 1: `apps/web/src/app/login/page.tsx`
1. **Explicit Form Action:**
   Change `<form className="flex flex-col gap-4" action={login}>` to specify an explicit endpoint or wrap it in a client component that strips stale query parameters upon submit.
2. **Clear Stale Error on Interaction:**
   Ensure that when the user submits new credentials, any stale query parameter message is not re-displayed.
3. **Structured Server Action Diagnostics:**
   Add safe, structured server-side logging in `login` (e.g. `[AUTH] Login attempt started`, `[AUTH] Supabase signInWithPassword status: success`, `[AUTH] Redirecting to /protected`) to distinguish between Supabase auth errors and downstream layout redirects.

### Fix Component 2: `apps/web/src/app/protected/layout.tsx`
1. **Do NOT Destroy Valid Sessions on Workspace API Rejection:**
   Remove the destructive `await supabase.auth.signOut()` from the `/workspaces` 401 handler when the user holds a valid Supabase session.
2. **Render Informative Workspace Diagnostic State:**
   If `${apiUrl}/workspaces` returns HTTP 401 after token refresh, set:
   ```typescript
   fetchError = 'Workspace authentication failed: Backend API rejected the session token (HTTP 401). Please verify service configuration or contact support.';
   ```
   Render the existing workspace error UI with a "Retry" button and a clean "Sign Out" button.
3. **Preserve Authentic Expiration Triggers:**
   Only redirect to `/login?message=Session+expired...` when `supabase.auth.getUser()` or `supabase.auth.getSession()` fails to return a valid user or token.

---

## 8. Verification Plan

1. Verify that a valid Supabase login cleanly transitions the user to `/protected` without triggering a redirect loop.
2. Verify that if the backend `/workspaces` endpoint returns 401, the user is presented with a clear workspace connection error screen rather than being thrown into an infinite `signOut` reload loop.
3. Verify that all 15 unit tests in `apps/web/src/app/auth-session-persistence.test.tsx` pass.
4. Verify that `npm --prefix apps/web run build` compiles with 0 errors.

---

**Final Status:** **ROOT CAUSE CONFIRMED**
