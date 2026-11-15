import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            const isProduction = process.env.NODE_ENV === 'production';
            cookiesToSet.forEach(({ name, value, options }) => {
              const sanitizedOptions = isProduction
                ? options
                : { ...options, secure: false };
              cookieStore.set(name, value, sanitizedOptions);
            });
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing
            // user sessions.
          }
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
}
