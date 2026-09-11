# ClassOps

## Live ClassOps v2 pilot

As of 2026-09-11, ClassOps v2 is a live, self-hosted pilot at
[classops.pshomelab.dev](https://classops.pshomelab.dev/).

- **Live authentication:** Google OAuth only. ClassOps does not store passwords. The source (and
  login shell) includes an optional Microsoft OAuth implementation, but it is intentionally not
  configured or usable in the live pilot; its activation is deferred in PersonalSchema
  work-tracker issue **#712**.
- **Live browser UI:** authentication only — Google sign-in, logout, and a minimal account page.
  There is currently no browser UI for course or section setup, membership, attendance,
  check-in, exit tickets, random picker, gradebook, class feed, or statistics.
- **API versus feature availability:** the Fastify/PostgreSQL server contains and tests APIs for
  the classroom modules listed below. Those APIs are implementation foundations, **not** a claim
  that the corresponding feature is usable in a browser yet.
- **Legacy distinction:** the Firebase client remains in the repository as the historical
  `LegacyRoot` code path and can still be built for reference. The live hostname serves the v2
  pilot, not the legacy Firebase application, and no Firebase data has been migrated into v2.

The pilot's remaining operational and product follow-ups are deliberately tracked separately:

- **#712 — Microsoft OAuth:** deferred until an Azure application and a user need it.
- **#721 — proxy-aware rate limiting:** `TRUST_PROXY=false` is an accepted pilot limitation, so
  traffic behind the public proxy can share a rate-limit bucket. Do not enable proxy trust without
  first verifying the exact forwarding chain.
- **#732 — remaining QA and hardening:** production backup/restore evidence, reboot recovery,
  public-IP alerting, broader security checks, documentation review, and the eventual full
  feature walkthrough are deferred. A full feature walkthrough cannot be completed until the
  applicable v2 browser UI exists.

## v2 server capabilities (API only)

The v2 server lives in [`server/`](server/README.md). Its APIs and integration tests currently
cover the following modules:

| Module | Backend/API status | Browser-feature status |
| --- | --- | --- |
| Authentication and sessions | Google OAuth live; optional Microsoft implementation deferred | Sign-in, logout, and account page only |
| Course, Section, Membership | Implemented | No UI |
| Sessions, QR/Emoji check-in, roster | Implemented | No UI |
| Exit Tickets and Random Picker | Implemented | No UI |
| Gradebook and CSV export | Implemented | No UI |
| Class Feed | Implemented | No UI |
| Stats aggregation | Implemented | No UI |

## Local development

Install the repository dependencies:

```bash
npm install
```

For v2 development, start the local database, configure the server variables described in the
[server README](server/README.md), then start the v2 browser shell:

```bash
npm run v2:db:up
VITE_AUTH_MODE=v2 npm run dev
```

Vite proxies `/api` to `http://127.0.0.1:3000`, keeping the browser session same-origin during
development. `VITE_API_BASE_URL` can point to a separate API origin when required.

The legacy Firebase client is a separate historical code path. To inspect it locally, configure
its Firebase environment variables from `.env.example` and run `npm run dev` without
`VITE_AUTH_MODE=v2`. That build does not describe the live v2 pilot.

## Historical v1 feature history

The following records the Firebase-era v1 product history. It is retained for provenance and is
not a statement of functionality available in the current v2 pilot.

### v1.1.0 (2026-04-15)

- **Class Feed:** a unified timeline intended to replace Teams/Moodle for announcements,
  resources, and assignments; text announcements, PDF/image attachments, interactive links,
  real-time updates, likes, and comments for contextual Q&A.
- **Attendance:** dynamic roster management plus QR Code, emoji challenge, and GPS-verified
  check-ins.
- **Classroom activities:** exit tickets for real-time feedback and an interactive random picker.
- **Grading and analytics:** assignment workflow with feedback, a gradebook with CSV export, and
  a statistics dashboard for attendance and engagement.
- **Branding and UI:** rebranded from “Attendance” to “ClassOps” and added Feed/Attendance tabs
  for teachers and students.
- **Security:** Firebase configuration moved to environment variables.
