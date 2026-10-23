# Owner walkthrough — 2026-10-23

A non-technical company owner with only the README, from a fresh clone of the worktree
(`git clone` into a scratch directory outside the repo). Findings are numbered; each
names its fix commit or why it was not fixed.

## What this run could and could not do

The builder's tree has `node_modules` as a junction into the operator's checkout. Turbopack
refuses that layout (`Could not find the Next.js package`), so the server **started but could
not compile**. That made steps 2–6 a **code-and-copy read** of the shipped screens and routes
rather than a click-through. Step 1 was run for real. Step 2–6 findings below are marked
*read*, not *observed*. A true click-through needs a second, non-junctioned tree: see the
questions at the end.

## Step 1 — `npm run up`, `--check`, `--demo`

| Tried | What happened |
| --- | --- |
| `npm run up -- --check` in the fresh clone | Printed Node ok, Python ok, "App packages - not installed yet (npm ci will run)", then a long `Note: these Python packages differ…` line with a `pip` command, then "Check finished." |
| `npm run up -- --bogus` | `Unknown option: --bogus` plus the option list. Clear. |
| `npm run up` (own workspace, own DB path, `--no-open`) | Prerequisites passed, server started on a free port, then the app answered **HTTP 500** on `/api/health`. The launcher printed `KandiDate is running at …` and "click Sign in" anyway. |
| `npm run up -- --demo` | Same launcher path (differs only in environment, covered by the existing `serverEnv` fixtures); not separately started because the server could not compile in this tree. |

**F1 — a broken app was announced as "running".** Any HTTP answer counted as up, including the
500 Next serves when the app cannot compile or open its database. The owner would be sent to a
blank "Internal Server Error" page. Fixed: three consecutive error answers now stop with "the
app started but cannot serve pages… look for the first line that says Error… your saved data is
not affected". Commit `8b534dffb`, test `healthVerdict` in `scripts/__tests__/up.test.mjs`.

**F2 — `--check` ended without a verdict, and the version-drift note read as a fault.** It listed
facts, then a `pip install` command the owner does not need. Fixed: it now closes with "Ready…"
or exactly what the first run will do, and the drift note says the app still runs and no action
is needed. Same commit `8b534dffb`, test `checkVerdict`.

**F3 — not fixed: a Node `DEP0190` deprecation warning prints at start** (`Passing args to a
child process with shell option true…`). It is noise to an owner and implies a problem. It comes
from the dev-guard path, not `up.mjs`. Needs `scripts/dev-guard.mjs` (outside scope).

## Step 2 — first-run setup (`app/setup/`, the studio)

*Read.* After "Sign in" the owner gets the short wizard (company, team, board). The studio at
`/setup/studio` is a separate, optional installer face.

**F4 — the studio's empty state read as a requirement.** An owner who followed a link to
`/setup/studio` saw "No setup session attached" and a terminal command, with nothing saying
they can skip it. Fixed: the empty state now says it is optional and where the normal setup is.
Commit `a1fa4ec7b`, test `app/features/setup-studio/copy.test.ts`.

**F5 — not fixed: the studio is English-only** (`app/features/setup-studio/copy.ts` header says
this is deliberate for v1). The rest of the app is cs/de/fr. A localisation is ~150 strings × 4
catalogs, which is a project, not a finding fix. Listed for the operator.

## Step 3 — channels: SMTP email and calendar

*Read.*

- **Calendar** (`Settings → Integrations → Google Calendar`): a guided, numbered setup with a
  copyable redirect address, a write-only secret field, and per-reason failure copy. Good.
  **F6 — silent failure when the setup details could not load.** The status read's error was
  discarded; the redirect address (step 4) and scopes (step 3) rendered empty and the form still
  looked usable. Fixed: a visible alert with a retry button, using the existing `loadFailed`
  string plus a new `integrations.calendar.setup.retry` in all four catalogs. Commit
  `371976511`, test `calendarSetupLoad` in `integrationsLogic.test.ts`.
- **SMTP email is not under Settings → Integrations**; it lives in the Channels "night" setup
  (`app/features/hiring/channels/night/setup/SetupSmtp.tsx`). The README and the walkthrough
  brief both imply Integrations; an owner looking there will not find it.
  **F7 — not fixed: outside scope** (`app/features/hiring/`): add a pointer from the
  Integrations tab, or move the entry.
- **F8 — not fixed: outside scope.** Saving SMTP without a working encryption secret answers
  `COMMS_SMTP_SAVE_FAILED` — "Could not save the email sender. Please try again." Retrying
  cannot help if the cause is a missing `KP_SECRET`; the message has no next step. Needs
  `app/api/comms/smtp/route.ts` to answer a distinct code, `app/_lib/api-errors/` for the code
  and a catalog line telling the owner to set `KP_SECRET` (`.env.example:138`).
- Secrets: nothing in the paths read logs or prints a secret; the calendar secret field is
  write-only.

## Steps 4–6 — CV in and scored, send an assessment, reach a decision

*Not walked.* These screens live in `app/features/hiring/` and `app/api/`, both outside this
run's paths, and the server could not compile here. No findings were raised from them; this is
an absence of observation, not evidence the path is clean.

## Questions for the operator

1. F3 needs `scripts/dev-guard.mjs`; F7 needs `app/features/hiring/`; F8 needs `app/api/comms/`
   and `app/_lib/api-errors/`.
2. Steps 2–6 need a live click-through on a tree whose `node_modules` is a real install (not a
   junction). A builder may not create one; the operator can run
   `npm run up` in a scratch clone and replay this document.
3. F5 (studio localisation) is a scope decision.
