# ClassOps v2 production deployment pack

Implements the deployment pack required by
`ps-work:projects/personal/engineering/ClassOps/pilot-plan-macmini.md` and
`phase1-deployment-spec.md`. **Everything here has been built and typechecked/tested locally
only** — Docker was not available in the environment that wrote it, so the images have not
actually been built or run, and none of it has touched the Mac mini. Exercise it end-to-end
(`docker compose build`, `docker compose up`, all four scripts below, the full acceptance
checklist) before treating it as pilot-ready.

## What this is

| File | Role |
|---|---|
| `server/Dockerfile` | Multi-stage build for the API image; also used by the one-shot `migrate` service with an overridden command |
| `ops/gateway/Dockerfile`, `ops/gateway/nginx.conf` | Builds the v2 frontend (`VITE_AUTH_MODE=v2`) and serves it same-origin with an nginx reverse proxy to `/api/*` |
| `compose.v2.prod.yml` | Orchestrates `postgres` → `migrate` → `api` → `gateway`, with health checks, restart policies, resource limits, and a private network. Only `gateway` publishes a host port, bound to `127.0.0.1:8080` |
| `ops/deploy/deploy.sh` | Idempotent deploy: build, migrate, start, wait for health |
| `ops/deploy/health.sh` | Reports container health and hits `/health` through the gateway |
| `ops/deploy/backup.sh` | Nightly `pg_dump --format=custom` inside the postgres container (no host DB port needed), SHA-256 checksum, keeps the newest 7 |
| `ops/deploy/restore.sh` | Restores a dump into a disposable database, reports row counts, drops it — never touches the real database |
| `ops/deploy/rollback.sh` | Mechanical rollback: stop the stack, repoint `/opt/classops/current` at a previous release, restart |
| `ops/deploy/classops.env.example` | Template for the out-of-Git production secrets file |

## Prerequisites (not yet satisfied)

- Docker Engine and the Compose plugin on the target host.
- The Phase 0 read-only host inventory from `pilot-plan-macmini.md`.
- A real `~/.life-os/secrets/classops.env` filled from `classops.env.example` — `POSTGRES_PASSWORD`
  and `SEALED_PAYLOAD_ENCRYPTION_KEY` (`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`)
  can be generated now; `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`GOOGLE_REDIRECT_URI` require the
  separately gated OAuth approval.
- `APP_BASE_URL` set to the exact Tailscale MagicDNS HTTPS name once known.

## Usage (once the above are satisfied)

```bash
export CLASSOPS_ENV_FILE=~/.life-os/secrets/classops.env
npm run v2:prod:deploy    # build, migrate, start, wait for health
npm run v2:prod:health    # check container + /health status
npm run v2:prod:backup    # nightly pg_dump + checksum, keeps newest 7
npm run v2:prod:restore   # disposable-database restore rehearsal
npm run v2:prod:down      # stop the stack (volumes preserved)
```

`ops/deploy/rollback.sh <previous-commit>` assumes the proposed host layout
(`/opt/classops/releases/<source-commit>/`, `/opt/classops/current` symlink) from
`pilot-plan-macmini.md` — set it up on first deploy, not by this pack.

None of these scripts create an OAuth client, start Tailscale Serve, or touch DNS. Those stay
gated by the approval-gate table in `pilot-plan-macmini.md`.
