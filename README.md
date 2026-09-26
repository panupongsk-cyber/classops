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
- **Mirror status (2026-09-25):** the learning-activities module is exported to
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
