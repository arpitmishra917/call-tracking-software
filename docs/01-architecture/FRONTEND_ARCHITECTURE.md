# Frontend Architecture
Implemented in `apps/web/` using Next.js App Router and React. 
- **State/Auth:** Uses `@supabase/ssr` to manage cookies securely. Server components check `getSession()`.
- **Protected Layout:** Validates auth before rendering child routes.
- **Data Fetching:** Standard Next.js server and client fetch patterns communicating with the NestJS API.
