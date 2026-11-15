import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  })

  const isProtectedRoute =
    request.nextUrl.pathname.startsWith('/protected') ||
    request.nextUrl.pathname.startsWith('/onboarding')

  // Safe, explicit public-route bypass: only protected/authenticated routes invoke the session validation check.
  // Public pages (/login, /signup, /invitations, /auth/callback) bypass this check to prevent repeated network hangs.
  if (!isProtectedRoute) {
    return supabaseResponse
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
      global: {
        fetch: (url, options) => {
          return fetch(url, {
            ...options,
            signal: options?.signal || AbortSignal.timeout(8000),
          })
        },
      },
    }
  )

  let user = null
  try {
    const {
      data: { user: authUser },
    } = await supabase.auth.getUser()
    user = authUser
  } catch {
    user = null
  }

  if (!user && isProtectedRoute) {
    const url = typeof request.nextUrl?.clone === 'function'
      ? request.nextUrl.clone()
      : new URL(request.nextUrl ? request.nextUrl.toString() : 'http://localhost:3000')
    const pathname = request.nextUrl ? request.nextUrl.pathname : ''
    const isInvitationRoute =
      pathname.startsWith('/protected/invitations') ||
      pathname.startsWith('/protected/accept-invitation')

    if (isInvitationRoute && request.nextUrl.searchParams?.has('token')) {
      const token = request.nextUrl.searchParams.get('token')
      url.pathname = '/invitations'
      url.search = `?token=${encodeURIComponent(token || '')}`
    } else {
      url.pathname = '/login'
    }
    const redirectResponse = NextResponse.redirect(url)
    const redirectCookies = typeof supabaseResponse?.cookies?.getAll === 'function' ? supabaseResponse.cookies.getAll() : null
    if (Array.isArray(redirectCookies) && typeof redirectResponse?.cookies?.set === 'function') {
      redirectCookies.forEach((c) => {
        redirectResponse.cookies.set(c.name, c.value, c)
      })
    }
    return redirectResponse
  }

  return supabaseResponse
}
