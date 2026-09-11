# ClassOps v2 production deployment pack

## Current deployment status

As of 2026-09-11, this pack has been built, exercised on the Mac mini, and used to deploy the
live self-hosted ClassOps v2 pilot at
[classops.pshomelab.dev](https://classops.pshomelab.dev/). The public origin is routed through a
Cloudflare Tunnel to the loopback-bound gateway on the host.

This is a **Google-only, auth-only browser pilot**:

- Google OAuth sign-in has been verified against the live origin. Microsoft OAuth code exists but
  is intentionally not configured; its activation is deferred in PersonalSchema work-tracker
  issue **#712**.
- The browser UI currently offers sign-in, logout, and a minimal account page only. The server's
  Course/Section/Membership, attendance, Exit Ticket, Random Picker, Gradebook, Class Feed, and
  Stats APIs are not browser features yet.
- The live compose configuration deliberately uses `TRUST_PROXY=false`. This means public clients
  can share a rate-limit bucket behind the proxy; the verified proxy-chain configuration is
  deferred in **#721**.
- Further operational evidence — production backup/restore rehearsal, reboot recovery,
  public-IP alerting, wider security checks, documentation review, and the eventual full feature
  walkthrough — is deferred in **#732**. The walkthrough cannot be claimed until the relevant v2
  UI has been built.

The legacy Firebase client remains a historical source code path. It is not the service currently
served at the public v2 pilot hostname.

## What this pack provides

| File | Role |
|---|---|
| `server/Dockerfile` | Multi-stage build for the API image; also used by the one-shot `migrate` service with an overridden command |
| `ops/gateway/Dockerfile`, `ops/gateway/nginx.conf` | Builds the v2 frontend (`VITE_AUTH_MODE=v2`) and serves it same-origin with an nginx reverse proxy to `/api/*` |
| `compose.v2.prod.yml` | Orchestrates `postgres` → `migrate` → `api` → `gateway`, with health checks, restart policies, resource limits, and a private network. Only `gateway` publishes a host port, bound to `127.0.0.1:8080` |
| `ops/deploy/deploy.sh` | Deploys a selected release: build, migrate, start, and wait for health |
| `ops/deploy/health.sh` | Reports container health and hits `/health` through the gateway |
| `ops/deploy/backup.sh` | Creates a PostgreSQL custom-format dump and SHA-256 checksum, retaining the newest seven dumps when invoked. Scheduling is external to this script. |
| `ops/deploy/restore.sh` | Restores a dump into a disposable database, reports row counts, then drops it; it never targets the real database |
| `ops/deploy/rollback.sh` | Stops the stack, repoints `/opt/classops/current` at a previous release, and restarts it |
| `ops/deploy/classops.env.example` | Template for the out-of-Git production secrets file |

## Operating requirements

- Docker Engine and the Compose plugin must remain available on the target host.
- Pass the existing production secrets file through `CLASSOPS_ENV_FILE`; never put its values in
  Git or shell history. The example file documents the required names.
- `APP_BASE_URL` and `TRUSTED_ORIGINS` must remain the exact public HTTPS origin:
  `https://classops.pshomelab.dev`.
- Google OAuth's three settings must stay configured together. Leave all three Microsoft settings
  unset until #712 is deliberately resumed and an Azure App Registration is available.
- Do not change `TRUST_PROXY` merely to address #721. First verify the exact proxy hop and
  forwarded-header behaviour at the deployed boundary.

## Operational commands

These commands affect the live deployment. Run them only from the selected release with the
correct secrets file and an understood rollback target.

```bash
export CLASSOPS_ENV_FILE=/path/to/classops.env
npm run v2:prod:deploy    # build, migrate, start, wait for health
npm run v2:prod:health    # check container + /health status
npm run v2:prod:backup    # create a dump + checksum; external scheduling decides when it runs
npm run v2:prod:restore   # disposable-database restore rehearsal
npm run v2:prod:down      # stop the stack (volumes preserved)
```

`ops/deploy/rollback.sh <previous-commit>` assumes the release layout
`/opt/classops/releases/<source-commit>/` with `/opt/classops/current` as a symlink. It changes
the active release and must be followed by the appropriate health verification.

The pack does not create OAuth clients or manage Cloudflare Tunnel/DNS configuration. Those are
separate operational controls; retain the current public-routing boundary unless a scoped change
is explicitly planned and verified.
