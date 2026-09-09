# ClassOps v2 server

This directory contains the PostgreSQL/Fastify shared core for ClassOps v2. It runs alongside the
legacy Firebase application during migration; it does not change the current production
deployment.

## Included in this increment

- Google OAuth-only authentication (no password storage of any kind)
- Opaque server-side sessions in secure HTTP-only cookies
- PostgreSQL migration runner and audit log
- Course / Section / Membership shared primitive: `Course` (reusable catalog entry, `type` of
  `semester`/`self_paced`/`short_course`), `Section` (one term's offering, carries a regenerable
  join code), `Membership` (per-`(user, section)` role set over `owner`/`teacher`/`student`/`ta`)
- Membership authorization: `owner`/`teacher` manage `student`/`ta`; only an existing `owner` may
  grant or revoke the `owner` role
- Join-code self-enrollment, always granting `student` only
- `ADMIN_GOOGLE_EMAIL` bootstrap: the matching account is flagged `is_platform_admin` on sign-in
- Per-route rate limits, production origin checks for state-changing requests
- `/health` reports `503` when the database is unreachable

Google OAuth uses the authorization-code flow with state, nonce, PKCE, and an HTTP-only
browser-binding cookie to prevent login CSRF. It deliberately omits Google's `hd` restriction, so
any verified Google account can authenticate. A Google identity is keyed by the immutable `sub`
claim, not email.

No module UI (attendance, ITPE quiz-app, OmniQuizOps) ships from this directory yet — see
`ps-work:projects/personal/engineering/ClassOps/phase1-product-spec.md` for what is and isn't in
this increment, and its later-phase specs for what builds on top of this shared core.

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
export SEALED_PAYLOAD_ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")
export ADMIN_GOOGLE_EMAIL=you@example.com
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

Then set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI` together. For
production, replace the redirect URI with the exact HTTPS callback served from the same origin as
the frontend. The implementation does not send an `hd` parameter and does not enforce an email
suffix; access to classrooms is controlled by Course/Section membership instead.

Production deployments must set `APP_BASE_URL` and `TRUSTED_ORIGINS` to their exact HTTPS origin.
State-changing API calls without a matching `Origin` header are rejected in production.

## `SEALED_PAYLOAD_ENCRYPTION_KEY`

A base64-encoded 32-byte random key, required to seal the short-lived OAuth transaction context
(nonce, PKCE verifier, browser-binding hash) stored in `oauth_transactions` between the
authorization redirect and its callback. Must be backed up with the other production secrets like
any other credential; there is no outbox or worker depending on it in this increment.

## Tests

Unit tests do not require PostgreSQL:

```bash
npm run v2:test
```

The Course/Section/Membership integration test runs when `TEST_DATABASE_URL` is present:

```bash
TEST_DATABASE_URL=postgresql://classops:classops_dev@127.0.0.1:5433/classops npm run v2:test
```
