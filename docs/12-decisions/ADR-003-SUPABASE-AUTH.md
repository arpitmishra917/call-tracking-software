# Decision: Supabase Auth
# Context
Historical rationale not explicitly recorded. Initial versions incorrectly assumed JWKS (RS256/ES256) symmetric validation.
# Chosen approach
Supabase chosen for user identity. Asymmetric JWKS validation (RS256/ES256) used on the API via `jwks-rsa`.
# Current status
IMPLEMENTED
