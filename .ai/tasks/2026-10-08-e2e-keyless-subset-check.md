# E2E keyless subset check

Goal 7cb22f7a (CI e2e deterministic green): run the 14 keyless specs from ci.yml against today's main, fix only spec drift in e2e/.

**Result (second attempt, measured):** 14 specs / 77 tests run against a production standalone build. After 3 DRIFT fixes all 14 pass (77/77, 88 s). One PRODUCT defect was found that is NOT fixed: `npm run build` fails on main as committed (see below), so the measurement used a one-line patch in the throwaway tree only.

## First attempt (blocked, run 84290abe, commit 704545b53)

Nothing ran. The worktree's `node_modules` is a junction, so Turbopack refused to build (`Symlink node_modules is invalid, it points out of the filesystem root`) and `next dev --webpack` answered 500 (`better-sqlite3`: Can't resolve 'fs'). Class: ENVIRONMENT.

## Method

- Measurement tree T = `%TEMP%\kp-e2e-<timestamp>`, filled with `git archive HEAD | tar -x` (tracked files only; no enclosing repo, `git rev-parse --git-dir` fails there).
- `npm ci` in T: 44 s. `T/node_modules` confirmed a real directory (`lstat.isSymbolicLink() === false`).
- `npm run build` in T, unpatched: **fails in 21 s** (PRODUCT, below). Patched: **3 min 1 s**. `schemas:gen` worked (Python present).
- Standalone assembled with `fs.cpSync` of `.next/static`, `public`, `pipeline`, `data` (as ci.yml 547-551).
- Server: `node .next/standalone/server.js`, `HOSTNAME=127.0.0.1`, a free port, `KP_ALLOW_OPEN=1 KP_OFFLINE=1 NEXT_TELEMETRY_DISABLED=1`, fresh temp `KP_DB_PATH`, no provider key. `GET /` answered 200. Stopped by its own PID.
- Specs: `KP_E2E_BASE_URL=... npx playwright test <the 14 names> --project=chromium` from T. The DB was NOT reset between the first run and the later runs (the one-thread spec leaves an entry behind; the later specs tolerated it).
- T, its node_modules (not a link at deletion) and the temp DB were deleted; the operator's `node_modules` is intact.

## PRODUCT: the build is broken on main

- `npm run build` stops with `Module not found: Can't resolve 'fs'` — `better-sqlite3` reached a Client Component Browser bundle.
- Chain: `app/features/settings/integrations/IntegrationsWebhookPanel.tsx:12` (`"use client"`) imports `ATS_SCHEMA_VERSION` from `app/_lib/ats-record.ts:28`, and `ats-record.ts:24` imports `./db/core.ts` (-> better-sqlite3).
- Introduced by `b9f45b1aa fix(ats): the ATS record refuses an AI agent instead of exporting it as a person` (2026-10-07), which added the `db/core` import.
- Feature: **ats-candidate-egress**. The release gate's `npm run build` (and e2e-deterministic, which builds) cannot be green until the constant lives in a client-safe module or the panel stops importing `ats-record`.
- Not fixed here (no product code). To measure, only T's copy of the panel was patched (`const ATS_SCHEMA_VERSION = "kp.ats.v1"`); the committed tree is untouched.

## Before / after

| Spec | Before | After | Class of the failure |
| --- | --- | --- | --- |
| modal-escape | pass (3) | pass (3) | |
| profile-builder | pass (2) | pass (2) | |
| profile-roster | pass (4) | pass (4) | |
| landing | FAIL (8 of 9) | pass (9) | DRIFT |
| public-pages | pass (10) | pass (10) | |
| shell.spec | pass (11) | pass (11) | |
| journey-role-to-schedule | pass (6) | pass (6) | |
| journey-one-thread | FAIL (4 of 5) | pass (5) | DRIFT |
| activity-detail | pass (2) | pass (2) | |
| analytics-sections | pass (6) | pass (6) | |
| quality-tables | pass (5) | pass (5) | |
| shell-tab-state | pass (4) | pass (4) | |
| locale-smoke | pass (4) | pass (4) | |
| journey-board | FAIL (5 of 6) | pass (6) | DRIFT |

Before: 74 passed, 3 failed (94 s). After: 77 passed (88 s), with `T/e2e` identical to the committed `e2e/` (`diff -r` printed nothing).

## DRIFT fixes

1. `landing.spec.ts:292` "the demo CTA's refusal lands on the landing": `getByRole("status")` resolved to 5 elements (strict mode) because the fused landing (`app/landing/site/land/` — HumanGate, GatesPanel, OfferPanel, HeroClient) added live regions. The notice is now picked out by its sentence. Commit e1e9525cf "test(e2e): the landing demo-refusal notice is picked out by its sentence, not by role=status alone".
2. `journey-board.spec.ts:133` "an absent phase states its reason": the overlay now opens on the cohort layer (`1e52a019f feat(journeys): the cohort layer - the whole process above the journey board`); the per-role board is behind "Open the journey board". The spec clicks it, and the absence count is a poll (the board fetches client-side) rather than an immediate read, 15 s like its sibling polls. Commit 1cb3c159a "test(e2e): the journey board's absence check opens the per-role board and waits for it".
3. `journey-one-thread.spec.ts:461` "a human seals the decision": the Decisions tab is The Docket (`fd59b3b35 feat(decisions): the Decisions tab is The Docket, a role board with a role level beneath it`), a list item per candidate, not a table row; the row also has two "Decide on" buttons (name and icon), so the name button is clicked. Commit 5d04361ea "test(e2e): the one-thread spec finds the candidate in The Docket's list, not a table row".

No assertion was weakened, nothing skipped, no timeout raised past 2x, KEYLESS_SPECS and ci.yml untouched. (Ids may change if the merge rebases; the subjects above identify them.)

## Gates (worktree)

typecheck, lint, test:docs (keyless-e2e pin), test:unit (13008 pass) and the scripts/kpi set all pass. typecheck does not catch the build break above: it is a bundling-boundary error, not a type error.
