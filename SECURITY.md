# Security

Keep all credentials in environment variables. Never commit `.env` files, Gemini keys, researcher PINs, cookie-signing secrets, Supabase secret or service-role keys, participant records, or exported research data.

`SUPABASE_SECRET_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are server-only credentials. They must never be prefixed with `NEXT_PUBLIC_`, returned by an API route, or included in client bundles. The publishable Supabase key is the only Supabase credential intended for browser configuration.

Use synthetic data for development and screenshots. Review JSON and CSV exports before sharing them outside an approved research environment.

Security reports should describe the affected code path and reproduction steps without attaching participant data, access tokens, or production credentials.
