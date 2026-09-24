# Auth Flow
User signs in -> Supabase issues session cookie -> `@supabase/ssr` creates server client -> `layout.tsx` checks auth -> fetches API data.
