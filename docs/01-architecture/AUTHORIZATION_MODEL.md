# Authorization Model
Authentication occurs via Supabase Auth (yielding an JWKS (RS256/ES256) signed JWT).
Authorization occurs inside the API via the `WorkspaceMember` table. 

Levels: OWNER, ADMIN, MEMBER, VIEWER.
Guards automatically extract `workspace_id` from route parameters or bodies and block access if the user's role is insufficient.
