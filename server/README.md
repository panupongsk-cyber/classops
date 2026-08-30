# ClassOps v2 server

This directory contains the PostgreSQL/Fastify authentication foundation for ClassOps v2. It runs alongside the legacy Firebase application during migration; it does not change the current production deployment.

## Included in this increment

- Email/password registration with Argon2id password hashing
- Single-use, expiring email verification and password-reset tokens
- Opaque server-side sessions in secure HTTP-only cookies
- PostgreSQL migration runner and audit log
- Transactional email outbox with retry/backoff
- Automatic recovery of outbox jobs left in `sending` after a worker crash
- AES-256-GCM encryption for sensitive outbox payloads; raw verification/reset tokens are not stored in plaintext
- Brevo SMTP worker and connection-only health check
- Per-route rate limits and generic anti-enumeration responses
- Production origin checks for state-changing requests

Google OAuth uses the authorization-code flow with state, nonce, PKCE, and an HTTP-only browser-binding cookie to prevent login CSRF. It deliberately omits Google's `hd` restriction, so any verified Google account can authenticate. A Google identity is keyed by the immutable `sub` claim, not email. If the verified Google email already belongs to a password account, automatic linking is refused until an authenticated account-linking flow is completed.

Classroom-data migration will be added on top of the same `users`, `auth_identities`, and `sessions` tables.

## Local development

Start PostgreSQL from the repository root:

```bash
npm run v2:db:up
```

Load non-secret development settings and run migrations:

```bash
export DATABASE_URL=postgresql://classops:classops_dev@127.0.0.1:5433/classops
export APP_BASE_URL=http://localhost:5173
export TRUSTED_ORIGINS=http://localhost:5173
npm run v2:migrate
```

Start the API:

```bash
npm run v2:dev
```

The health endpoint is `http://127.0.0.1:3000/health`.

In a second terminal, start the v2 frontend from the repository root:

```bash
VITE_AUTH_MODE=v2 npm run dev
```

The legacy Firebase UI remains the default whenever `VITE_AUTH_MODE` is absent or is not `v2`.

## Google OAuth

Create a Web application OAuth client in Google Cloud and add this local authorized redirect URI:

```text
http://localhost:3000/api/auth/google/callback
```

Then set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI` together. For production, replace the redirect URI with the exact HTTPS callback served from the same origin as the frontend. The implementation does not send an `hd` parameter and does not enforce an email suffix; access to classrooms will be controlled by ClassOps invitations and memberships instead.

Production deployments must set `APP_BASE_URL` and `TRUSTED_ORIGINS` to their exact HTTPS origin. State-changing API calls without a matching `Origin` header are rejected in production.

## Brevo secrets

Real mail credentials must remain outside Git at `~/.life-os/secrets/classops-mail.env`. Load them into the environment only for the command that needs them:

```bash
set -a
. ~/.life-os/secrets/classops-mail.env
set +a
npm --prefix server run mail:verify
npm --prefix server run mail:worker
```

`mail:verify` performs SMTP connection, TLS, and authentication checks without sending an email. The worker claims pending rows from `email_outbox`, sends them, and records the provider message ID. Failed deliveries are retried with exponential backoff and stop after eight attempts.

The same external secret file must include `OUTBOX_ENCRYPTION_KEY`, a base64-encoded 32-byte random key. It is required by both the API and worker and must be backed up with the other production secrets. Rotating it requires draining the outbox first.

## Tests

Unit tests do not require PostgreSQL:

```bash
npm run v2:test
```

The full authentication flow runs when `TEST_DATABASE_URL` is present:

```bash
TEST_DATABASE_URL=postgresql://classops:classops_dev@127.0.0.1:5433/classops npm run v2:test
```

No test sends email externally.
