# ClassOps v2 production deployment pack

## Current deployment status

As of 2026-09-25, this pack runs the live self-hosted ClassOps v2 at
[classops.pshomelab.dev](https://classops.pshomelab.dev/) on the Mac mini. The public origin is
routed through a Cloudflare Tunnel to the loopback-bound gateway on the host.

**Release history** (`/opt/classops/releases/<short-commit>`, with `current` pointing at the
active one):

| Release | Date | What changed |
|---|---|---|
| `239a893` | 2026-09-11 | First production pilot: Google sign-in, logout, and an account page |
| `065108f` | 2026-09-17 | v2 as the sole client (panupongsk-cyber/classops#10) |
| `aa53107` | 2026-09-25 | Admin Console, and learning activities with migration `011_learning_activities.sql`. The 14 learning-activity packages were imported. Evidence is on PersonalSchema Issue #693. |
| `76de503` | 2026-09-25 | Wave 1 (PS-TASK-20260925-727): real client addresses for rate limits, staff-only member emails, the Admin → Live sessions fix, and owner choice for admins. No migration. Evidence is on #727. |
| `e0f50a0` | 2026-09-25 | Wave 2 (PS-TASK-20260925-734): the `mean` evidence policy, teacher-triggered gradebook sync, and attempt verification, with migration `013_activity_gradebook_sync.sql`. Evidence is on #734. |
| `efe0f12` | 2026-09-25 | Roster import from any student-list CSV, TIS-620 aware, with column mapping and pre-enrollment claimed at sign-in (PS-TASK-20260925-744, -747), with migration `014_section_roster.sql`. Evidence is on #744. |
| `03e97a1` | 2026-09-25 | ITPE IP (IT Passport) exam practice, opt-in per Section (PS-TASK-20260925-751, -755), with migration `012_practice.sql`. The 9 sessions (900 questions) were imported. Evidence is on #751 and #755. |
| `8b4fd12` | 2026-09-25 | UI polish, frontend only (PS-TASK-20260925-762): phone tab-strip navigation, the Prompt font applied, a form-control baseline, 40px phone tap targets, and a localized file chooser. No migration. Evidence is on #762. |
| `e51da94` | 2026-09-25 | ITPE IP practice Phase 2 (PS-TASK-20260925-767, -770): the timed mock exam (a server-side deadline and a pass estimate against the official IP rule), and personal progress (bookmarks, a mistakes quiz, "My progress", and an anonymous most-missed ranking), with migrations `015_practice_exam.sql` and `016_practice_progress.sql`. No content re-import. Evidence is on #767 and #770. |
| `0802c52` | 2026-09-26 | ITPE IP practice Phase 3 (PS-TASK-20260926-785, -789): teacher-set practice assignments (a whole session or a set drawn once; dates, attempts, evidence and review policies; a key lock while open), a staff results view with CSV, and opt-in gradebook sync, with migrations `017_practice_assignments.sql` and `018_practice_assignment_gradebook_sync.sql`. No content re-import. Evidence is on #785 and #789. |
| `58bad7e` | 2026-09-26 | Learning-games Phase 4 (PS-TASK-20260926-805, -809, -813): activity engine 0.4.0 with the `diagram_pick`, `policy_builder`, and `recipe_pipeline` part types, the `accepted_sets` mode, and the `all_correct` flag. The player gains a data-flow diagram, a policy builder, a recipe builder with a local preview, and stage goals. No migration. Six packages were imported: `cia-triad-foundation`, `cia-triad-extension`, `stride-checkpoints`, `stride-dfd`, `least-privilege-lab`, and `cyberchef-puzzle-lab`, with hashes matching the item bank. Evidence is on #822. |
| `49d5d50` | 2026-09-26 | Practice-assignment auth order (PS-TASK-20260926-825): every `/api/practice-assignments/:assignmentId…` route authenticates before it looks the id up. A request without a session gets 401 whether or not the id exists, so assignment ids can no longer be probed. Signed-in responses are unchanged. No migration and no import. Evidence is on #834. |

`49d5d50` is the active release, and `58bad7e` is its rollback target. A code-only rollback
leaves migrations 012–018 and the imported content in place, and the older code ignores the
tables it doesn't know.
- If you roll back past `58bad7e`, the older engine doesn't know the `diagram_pick`,
  `policy_builder`, and `recipe_pipeline` part types. It can't show or score the six Phase 4
  activities, so set them to closed first. Their packages and finished attempts stay in the
  database.
- If you roll back past `0802c52`, an assignment attempt still in progress is handed to code
  with no assignment review policy or key lock, so its keys could show before the due date. Roll
  back when no assignment is open, or accept that risk. Synced gradebook cells stay as written.
- If you roll back past `e51da94`, a mock exam still in progress is handed to older code that
  knows no `exam` mode and treats it as a practice run, showing the key after each answer. Roll
  back when no exam is running, or accept that risk.
- If you roll back past `e0f50a0`, an activity set to `mean` behaves as `best` until its policy
  is set again.
- Importing practice content works like the activity packages:
  `node dist/scripts/import-practice.js /packages/<session>.json`, with packages from the item
  bank's `tools/export_practice.py`. For a session that learners have already used, where only
  its text changed (such as an added Thai translation), add `--update-text`. It keeps question
  ids, so attempts stay valid, and it refuses anything structural.

**What the browser UI offers.** Google sign-in, plus these features:

- sections, and creating courses and sections
- attendance check-in
- the gradebook
- the class feed
- stats
- learning activities:
  - play, and the learner's own results
  - the manager's evidence view with a CSV download
  - gradebook sync with a preview
  - attempt verification
  - Phase 4 games: a data-flow diagram (STRIDE), a policy builder (Least-Privilege Lab), and a
    recipe builder with a local preview (CyberChef)
- roster import from a student-list CSV, with pending pre-enrollment
- ITPE IP (IT Passport) exam practice, which a teacher enables per Section:
  - browse, practice, and quick quiz
  - a timed mock exam with a pass estimate
  - bookmarks, a mistakes quiz, and "My progress"
  - teacher-set practice assignments, with results, CSV, and gradebook sync
- the Admin Console

**Limits that still apply.** The three deferred items below were issues in the archived `ps-work`
tracker. They were not migrated to this repository, so a bare `#712`, `#721`, or `#732` in this
repository means something else.

- **Microsoft OAuth.** The code exists but is intentionally not configured. Its activation is
  deferred in `ps-work#712`. The 2026-09-25 deploy changed no OAuth configuration.
- **Rate-limit buckets (`ps-work#721`, fixed in PS-TASK-20260925-727).** This has been live since
  release `76de503`.
  - The gateway resolves each client's own address, and the API sets
    `TRUST_PROXY=172.16.0.0/12`.
  - Signed-in traffic is keyed per user.
  - Clients behind one NAT, such as a campus classroom, still share the anonymous buckets. The
    OAuth-start limit is 200 per 15 minutes for that reason.
- **Deferred operational evidence**, in `ps-work#732`:
  - a backup/restore rehearsal against production
  - reboot recovery. The host rebooted unattended on 2026-09-25 for a kernel update, and the
    stack came back healthy on its own; this is an observation, not a rehearsal.
  - public-IP alerting
  - wider security checks
  - documentation review
  - the full feature walkthrough on the live origin, which is still to be done

The legacy Firebase client remains a historical source code path. It is not the service currently
served at the public v2 hostname.

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
  unset until `ps-work#712` is deliberately resumed and an Azure App Registration is available.
- **Change the client-address chain only after re-verifying it at the deployed boundary.** It is
  Cloudflare edge → host `cloudflared` → `127.0.0.1:8080` → gateway → API.
  - The gateway's `set_real_ip_from 172.16.0.0/12` and the API's `TRUST_PROXY=172.16.0.0/12` both
    assume the Docker network stays inside `172.16.0.0/12`. It was `172.20.0.0/16` on
    2026-09-25.
  - If it moves, both fall back safely to the shared gateway address. Neither falls back to a
    spoofable client-supplied value.
- **Run as `classops`, without a login shell.** Releases and the secrets file belong to the
  `classops` user, whose shell is `/usr/sbin/nologin`, so `sudo -iu classops` fails.
  - Use `sudo -u classops -H bash <script>`.
  - Start from a directory `classops` can read, such as `/opt/classops`. If it can't stat the
    working directory, `docker compose` fails with `stat .: permission denied`.
- **Invoke the scripts through `/opt/classops/current`.** The compose file sets no `name:`, so the
  project name comes from the directory, and `current` holds the production volume
  (`current_classops_v2_postgres_prod`). Invoking a script through
  `/opt/classops/releases/<commit>/` would start a differently named project with an empty
  database.
  - Setting `COMPOSE_PROJECT_NAME=current` is a cheap extra safeguard.

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

### Importing learning-activity packages

Learning-activity packages carry answer keys, so they are **never** in this repository or its
image. They are supplied at run time from a host directory mounted read-only into the one-shot
`migrate` service. `migrate` has no entrypoint, so the command below replaces its default
`migrate.js`.

```bash
export CLASSOPS_ENV_FILE=/path/to/classops.env
dir=~/.personalschema/state/classops/activity-packages   # mode 755, files 644 (container user must read them)
docker compose -f compose.v2.prod.yml --env-file "$CLASSOPS_ENV_FILE" run --rm \
  -v "$dir":/packages:ro migrate node dist/scripts/import-activity.js /packages/<slug>.json
```

Re-importing identical content under the same `(slug, version)` does nothing, and changed
content under an existing version is refused. Delete the package files from the host once they
are imported.

The pack does not create OAuth clients or manage Cloudflare Tunnel/DNS configuration. Those are
separate operational controls; retain the current public-routing boundary unless a scoped change
is explicitly planned and verified.
