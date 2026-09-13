# Hostinger + Supabase deployment

The managed-hosting entry point is `server.mjs` (`npm run start:hostinger`). It starts one HTTP listener on `PORT`, routes `/api/v1` to the existing Nest application, and delegates other requests to Next. The original separate-process development commands remain available. This follows the installed Next custom-server guide; do not combine this entry point with standalone output.

Build with `npm ci` and `npm run build`, then start `server.mjs` from the repository root. Runtime files must include `.next`, `backend/dist`, `backend/certs`, the server entry point, configuration, and production dependencies. Choose Node 24.

Supabase uses the IPv4 session pooler on port 5432. The application connects with a restricted `sales_runtime` role; migration credentials remain outside the hosting runtime. Disable Supabase Data API and automatic public grants: authorization is enforced by the existing backend. Use `sslmode=verify-full`. The database adapter resolves the bundled public CA relative to its own module for Supabase pooler connections; no global TLS override is required.

The public CA certificate was obtained from the database dashboard's official download link:
https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt

Runtime environment: `NODE_ENV=production`, `COOKIE_SECURE=true`, `ALLOWED_ORIGINS=https://system.trofico.net`, `NEXT_PUBLIC_DATA_MODE=api`, `DB_POOL_MAX=5`, `TRUST_PROXY=none`, plus private `DATABASE_URL` and `CSRF_SECRET`. Trust proxy remains disabled until the provider's forwarding guarantees are verified; login limits may consequently share a proxy address.

Do not run seeds or migrations automatically at startup. Local `.runtime` contains private deployment handoff files and is ignored by Git. The public certificate is not a credential.

Validation of the managed entry point: eight role-specific browser login/workspace checks passed locally. Type checks and all 16 backend integration tests passed after adding the in-process Nest initialization option. External deployment verification must additionally check HTTPS, login, authenticated API requests, and runtime database connectivity.

Hostinger dependency installation initially failed because its Python 3.6 cannot build node-argon2. The backend now uses the prebuilt @node-rs/argon2 implementation with identical Argon2id memory/time/parallelism parameters. Existing password hashes remained compatible in the integration suite.
