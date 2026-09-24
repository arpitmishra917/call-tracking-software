# Auth Security
Asymmetric JWT validation using `passport-jwt` and `jwks-rsa`. Keys are fetched from the Supabase `.well-known/jwks.json` endpoint. Enforces exact issuer and audience validation.
