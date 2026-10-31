# ClassOps v2 — application source

This is the v2 application source (Vite/React frontend, Fastify/PostgreSQL server) for ClassOps,
migrated here so ongoing development happens under the PersonalSchema task/PR workflow. See
[`../README.md`](../README.md) for the project's status, milestones, and deferred follow-ups, and
[`../PUBLISHING.md`](../PUBLISHING.md) for the release/publication contract.

## Scope of this import

Only the v2 application is here — the legacy Firebase-based attendance app (`LegacyRoot`, `App.jsx`,
`src/context/`, `src/components/`, `src/pages/`, `src/firebase/`, `firebase.json`,
`firestore.rules`) was intentionally left out. It remains paused (see
`../../../../teaching/classops/README.md`, `PS-PROJECT-classops`) and still lives only in the
external repository below. `src/v2/` is fully self-contained and never imported anything from the
dropped legacy tree, so nothing here depends on it.

`package.json` and `package-lock.json` were trimmed to match: the `firebase`, `html5-qrcode`, and
`uuid` dependencies (legacy-only) and the `emulators`/`start` scripts (Firebase emulator) were
removed; `qrcode.react` was kept because `src/v2/attendance/SessionLivePage.jsx` uses it too.

## Tests

- **Server:** `npm --prefix server test`. Its integration tests need `TEST_DATABASE_URL`, pointing
  at a throwaway PostgreSQL database. To run them against a disposable PostgreSQL 16 container:

  ```bash
  docker run -d --rm --name classops-test-pg -e POSTGRES_PASSWORD=test \
    -e POSTGRES_DB=classops_test -p 55432:5432 postgres:16
  cd server && npm ci
  set -a; . ./.env.example; set +a
  unset GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET GOOGLE_REDIRECT_URI \
    MICROSOFT_CLIENT_ID MICROSOFT_CLIENT_SECRET MICROSOFT_REDIRECT_URI
  export NODE_ENV=test ADMIN_GOOGLE_EMAIL=admin@example.test \
    SEALED_PAYLOAD_ENCRYPTION_KEY="$(openssl rand -base64 32)" \
    DATABASE_URL=postgres://postgres:test@localhost:55432/classops_test
  export TEST_DATABASE_URL="$DATABASE_URL"
  npm run db:migrate && npm test
  docker stop classops-test-pg
  ```

  `db:migrate` loads the full app config, so `.env.example` alone is not enough. It needs a
  non-empty `SEALED_PAYLOAD_ENCRYPTION_KEY` and a valid `ADMIN_GOOGLE_EMAIL`. Each OAuth provider's
  three `*_CLIENT_ID`/`*_CLIENT_SECRET`/`*_REDIRECT_URI` values must be all set or all unset.
- **Frontend:** `npm test`, which runs Vitest with React Testing Library in jsdom
  (`vitest.config.js`, `src/**/*.test.{js,jsx}`).
  - i18n key parity, and every literal and template-built `t()` key is defined
  - each activity part's empty and complete answers
  - the diagram, policy, and recipe parts
  - the mock exam's in-order saves, and Submit waiting for them
  - bookmark saves

  This tree is published, so tests use synthetic data only.

## Source and deployment relationship

- **Origin:** [panupongsk-cyber/classops](https://github.com/panupongsk-cyber/classops), public
  repo, commit `cc40bf3538a3dbf08183d32eb9e7c2eb1608188c` at import time (squashed, not a full
  history import — see `PS-TASK-20260917-249`).
- **Development:** happens here from now on, through the normal PersonalSchema task/PR flow.
- **Deployment:** production on `ps-homelab-macmini` still `git clone`s
  `panupongsk-cyber/classops` directly (see `../pilot-activation-deployment-spec.md`) — that stays
  unchanged, deliberately, so the deployment credential never needs access to this private
  monorepo (see `../PUBLISHING.md`'s source boundary). After each merge here that touches this
  folder, its current state is exported back out to `panupongsk-cyber/classops`'s `main` so the
  external repo keeps serving as the sole deploy target. That export is a manual step run locally
  (never a PersonalSchema CI secret — this repo never adds privileged CI credentials).
- **Mirror status (2026-10-22):** `panupongsk-cyber/classops` `main` is at `4e73991`, deployed on
  production as `releases/4e73991` with `720fb95` as the rollback target. The exports since the
  2026-09-25 record:
  - `804ac17` — practice explanations end to end, migration `019_practice_explanations.sql`
    (PersonalSchema PS-TASK-20261013-1777, PR #1781)
  - `76b4858` — the private question library, migrations `020_question_library.sql` and
    `021_library_releases.sql`, published revision `7ec29a76…` with 33 papers / 1,869 questions /
    904 figures (PS-TASK-20261017-1954/-1955/-1956, PR #2049)
  - `3aef248` — guarded Course and Section deletion, no migration (PS-TASK-20261020-2264,
    panupongsk-cyber/classops#32); acceptance is on Issue #2275
  - `cfa1981` — Question Library/QuestionCard redesign and the theme overhaul, frontend only
    (PS-TASK-20261021-2318/-2322, panupongsk-cyber/classops#33, #34)
  - `3f6517c` — Python code exercises through Piston, migration `022_code_exercises.sql`
    (PS-TASK-20261022-2374, PR #2375, panupongsk-cyber/classops#35)
  - `720fb95` — "My grades" with a per-Assignment release switch, gradebook CSV import, and the
    self-entered student ID warning, migrations `023_assignment_release.sql` and
    `024_membership_roster_student_id.sql` (PS-TASK-20261022-2436/-2437/-2447, PRs #2441, #2443,
    #2448, panupongsk-cyber/classops#36)
  - `4e73991` — Class Feed attachments (migration `025_post_attachments.sql`, gateway rebuilt),
    feed polling, the Section-page practice switch, and the early error handler
    (PS-TASK-20261022-1995/-2438/-2439, PRs #2453, #2458, #2459, panupongsk-cyber/classops#37)
  - Release history, rollback consequences, and the browser-UI inventory live in
    `ops/deploy/README.md` inside this folder.
- **Previous mirror status (2026-09-25):** the learning-activities module is exported to
  `panupongsk-cyber/classops` `main` `aa531079` (panupongsk-cyber/classops#14). The export
  includes:
  - the server from PS-TASK-20260925-687
  - the UI and session-keyed rate limit from -693
  - the OAuth-start limit from -696
  - the Phase 3 part types and player components from -701, -705, and -708
  - migration `011_learning_activities.sql`
  - **Production is deployed.** On 2026-09-25, `PS-NODE-macmini` moved to release `aa53107`
    through the hand-off in
    `work/handoffs/2026-09-25-macmini-classops-learning-activities-deploy.md`.
    - Migration 011 is applied, and all 14 learning-activity packages are imported.
    - The previous release, `065108f`, is kept as the rollback target.
    - The deploy evidence is on PersonalSchema Issue #693.
  - Migration 011 is now applied in production, so it can no longer be edited. Any later schema
    change needs a new migration. `012` is reserved for the ITPE IP practice plan.
