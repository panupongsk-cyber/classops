# ClassOps v2 server

This directory contains the PostgreSQL/Fastify shared core for ClassOps v2. It runs alongside the
legacy Firebase application during migration; it does not change the current production
deployment.

## Included in this increment

- Google and Microsoft OAuth authentication (no password storage of any kind, ever)
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

Both providers use the same authorization-code flow with state, nonce, PKCE, and an HTTP-only
browser-binding cookie to prevent login CSRF (`src/oauth-flow.ts` — one shared implementation, not
duplicated per provider). Google deliberately omits the `hd` restriction; Microsoft uses the
`common` endpoint; neither enforces a domain or tenant. A Google identity is keyed by the immutable
`sub` claim; a Microsoft identity by `oid` (Microsoft's own documented stable identifier — see
`phase1-5-product-spec.md`). **ClassOps never links accounts across providers**: if a sign-in's
email already belongs to a different provider's user, it's rejected, not merged.

No module UI (attendance, ITPE quiz-app, OmniQuizOps) ships from this directory yet — see
`ps-work:projects/personal/engineering/ClassOps/phase1-product-spec.md` for what is and isn't in
this increment, and its later-phase specs for what builds on top of this shared core.

### Phase 2a: Sessions, check-in, roster

Added on top of the shared core (see `phase2a-product-spec.md`):

- `Session` scheduling per `Course.type`: `semester` Sections use a recurring weekly-pattern
  generator (`session_schedule_patterns` + `Section.term_start_date`/`term_end_date`, idempotent
  re-runs); `short_course` Sections create Sessions manually, one at a time; `self_paced` Sections
  never have Sessions and reject the attempt with a clear error.
- QR check-in: a short code on the Session row rotates lazily (regenerated on read once expired,
  no background job) roughly every 15-30s, defending against screenshot sharing rather than code
  secrecy.
- Emoji check-in: one emoji, chosen unpredictably from a fixed palette, fixed for the whole open
  window (not rotated) — the anti-proxy property comes from not knowing it in advance.
- Roster: checked-in status per `student`/`ta` Section member for a Session.
- Authorization: `owner`/`teacher`/`ta` create/open/close Sessions and view the roster; any
  Section member may check themselves in only, while the Session is open.
- The domain table is named `class_sessions`, not `sessions` — migration 001 already used
  `sessions` for login sessions, a collision the product spec's naming didn't anticipate.

No new environment variable, container, or background worker (see `phase2a-deployment-spec.md`).

### Phase 2b-1: Exit Tickets, Random Picker

Added on top of Phase 2a's Session model (see `phase2b1-product-spec.md`):

- **Exit Ticket**: belongs to a Session, open/close is a separate switch from the Session's own
  check-in state. Multiple Exit Tickets allowed per Session over time, only one open at once
  (enforced with a partial unique index, not just an application check). Every response combines
  a 1-5 rating with an optional free-text comment; resubmitting **updates** the existing response
  (`ON CONFLICT ... DO UPDATE`) rather than being idempotent-no-op like check-in — a deliberate
  deviation, since feedback plausibly changes before the window closes while a check-in fact
  shouldn't.
- **Random Picker**: picks one student uniformly at random among those currently checked in to
  the open Session *and* at the current minimum pick count for that Session. This single query
  is the entire fairness mechanism — no explicit "reset the rotation" action or state exists.
  Round 1 spreads picks across everyone at 0; once everyone's been picked once the minimum
  becomes 1 and a new round starts on its own, and a student who checks in mid-Session starts at
  0 picks (same as everyone did at the round's start), so they're immediately eligible.
- Both features reuse `canManageSessions` (`owner`/`teacher`/`ta`) for management; any Section
  member may submit/revise their own Exit Ticket response.

No new environment variable, container, or background worker (see
`phase2b1-deployment-spec.md`).

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

## Microsoft OAuth

Create an Azure App Registration accepting accounts in any organizational directory **and**
personal Microsoft accounts ("Accounts in any organizational directory and personal Microsoft
accounts"), and add this local authorized redirect URI:

```text
http://localhost:3000/api/auth/microsoft/callback
```

Then set `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, and `MICROSOFT_REDIRECT_URI` together —
same all-or-nothing rule as Google's three variables. Microsoft's ID token has no `email_verified`
claim; ClassOps trusts the `email` claim as-is once it's present, rejecting sign-in if it's absent.
This is a real, deliberately-accepted trade-off — see `phase1-5-product-spec.md`'s "Read this
first" section for the reasoning.

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

The Course/Section/Membership, Sessions, and Exit Tickets/Random Picker integration tests run when
`TEST_DATABASE_URL` is present:

```bash
TEST_DATABASE_URL=postgresql://classops:classops_dev@127.0.0.1:5433/classops npm run v2:test
```
