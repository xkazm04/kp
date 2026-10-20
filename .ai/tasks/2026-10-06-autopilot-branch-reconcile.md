---
kind: task
status: done
opened: 2026-10-06
charter: accepted-idea-delivery
branch: autopilot/accepted-idea-delivery-22266a49
gate: npm run test:unit -- 'app/_lib/auth/**/*.test.ts' 'app/api/**/*.test.ts'
measurable: autopilot/* local branches with no recorded verdict. Before: 19 of 19. After: 0 of 19 (13 classified, 6 listed as already merged).
---

# Autopilot branch reconcile — 19 branches, one verdict each

A record, not an action. Nothing was merged, cherry-picked, deleted or pushed, and no
branch ref moved. Read at local `main` = `ea04bb4c9`. Every `autopilot/*` branch except this
run's own (`accepted-idea-delivery-22266a49`) is in the table below exactly once.

## How each verdict was reached

For each of the 13 branches that carry one commit main lacks: `git show --stat` and the diff
read, then main searched for the same behaviour by file, by `git log -S/-G/--grep`, and by
reading the touched files as they are on main today. A verdict rests on code or a commit,
never on the subject line. `Conflicts` is `git merge-tree --write-tree main <branch>` run
against `ea04bb4c9`.

Verdicts: **LANDED** (main carries the same change), **SUPERSEDED** (main does it a different
way, or the code it touched is gone), **STILL-WANTED** (absent from main and serves goal 1, 2
or 3, or a live correctness/security need), **OBSOLETE** (fails that test; reason given).

Goals: **1** one role runs end to end with no human step · **2** hire-from-need composes a
role from a stated need · **3** every automated step is explainable to the candidate.

## Table

Tip shas are the branch tips today. Branch names drop the `autopilot/` prefix.

| branch | tip | one-line change | verdict | evidence | files on main today | conflicts | effort | goal |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| accepted-idea-delivery-to-the-main-branch | `3935d5897` | fix(pipeline): close and reopen hold the write lock from BEGIN | **STILL-WANTED** | `app/_lib/db/pipeline.ts:880` `closeEntriesByJobId` and `:961` `reopenEntriesByJobId` both still end `return tx();` — a DEFERRED transaction. Both carry the `changes === 0` re-check (`02df73dd9`) but a commit on another connection between the SELECT and the first UPDATE is a `SQLITE_BUSY_SNAPSHOT` abort that `busy_timeout` never retries, so the close rolls back after the route has already darkened the role. Callers are live: `app/_lib/stage-hooks-role-fill.ts:120`, `app/api/jobs/[id]/close/route.ts:47`, `app/api/jobs/[id]/publish/route.ts:219`. | `app/_lib/db/pipeline.ts`, `app/_lib/db/pipeline-close-guard.test.ts` (its header at `:26` already says a move to `.immediate()` should update the test, not delete it), `docs/features/jobs/README.md`; the commit also edits `.claude/CLAUDE.md` and `context-constraints.json` (wording only) | none (`rc=0`) | S | 1 — role-fill closes the role's other candidates (`stage-hooks-role-fill.ts`); also a live lost-write correctness need |
| accepted-idea-delivery-to-the-main-branch-2 | `cb71f9128` | fix(ats): webhook event rows state whether they fire | **STILL-WANTED** | `app/_lib/screen-wave.ts:582` commits auto-rejects with `actOnPipelineEntry` and dispatches only `dispatchRejection` (`:610`); no `dispatchAtsEvent` anywhere in the file. The only `candidate.rejected` emit on main is `app/_lib/pipeline-entry-action.ts:573` (the human click). So a subscriber to `candidate.rejected` never hears the wave's rejections. `messages/en.json:9083` still reads "fires live on offer-accept today; the others are reserved", which is false since `offer.accepted`/`offer.declined` gained emit sites (`app/_lib/offer-finalize.ts:173,197`). `SUBSCRIBABLE_EVENT_ROWS` (`app/features/settings/integrations/integrationsWebhookIdentifiers.ts:37`) still has no `status` field. | `app/_lib/screen-wave.ts`, `app/_lib/ats-lifecycle-events.test.ts`, `app/features/settings/integrations/{IntegrationsWebhookFields.tsx,integrationsCatalog.test.ts,integrationsWebhookIdentifiers.ts}`, `messages/{en,cs,de,fr}.json`, `docs/features/integrations/README.md` | yes, one: `app/_lib/screen-wave.ts` — the import block moved (main imports `readLiveArchetypes` where the branch imports `isFairnessProtected`); the added `dispatchAtsEvent` import and the call are independent of it. Locale files and docs auto-merge. | S | 1 (the unattended screen stage never reaches the customer's system of record) and a live correctness need (a false statement on screen in four locales) |
| accepted-idea-delivery-to-the-main-branch-5 | `bf7ee4789` | feat(shell): scope the live-refresh bus by data topic | **OBSOLETE** | Absent from main: `app/features/shell/live-refresh.ts` has no topics, `git grep shouldRefresh\|REFRESH_TOPICS -- app` finds nothing. Fails the STILL-WANTED test: it is a re-fetch efficiency change with no goal behind it and no measured symptom. Its call-site map is also stale — `ChannelsCommsTable.tsx`, one of the call sites it scopes, was deleted in `1ca01fc68` when the Hiring > Channels surface was rebuilt, `JdsIntakeTab.tsx` and `JobsDraftsPanel.tsx` conflict, and 16 non-test files now reference the bus, including `channels/night/*` hooks the branch never saw. The design (symmetric `shouldRefresh`: no-topic signal is global, no-topic subscriber is a wildcard) is sound and survives in the commit message and in idea 4aa57abb in Personas. | — | (merge-tree: 4 files conflict, one of them modify/delete) | — | — |
| enforce-per-user-session-revocation-list-to-cove | `f6e59d87f` | feat(auth): revoke a single session | **LANDED** | `04b459639` (2026-09-21), same subject, same author timestamp, same patch apart from hunk offsets and small adaptations in `logout/route.ts` and `edge-verify.ts` to code main had since changed. `app/_lib/auth/session-revocation.ts` is on main; `proxy.ts`, `current-user.ts:50`, `require-operator.ts:43,109` consult it; `app/api/auth/logout/route.ts` writes it. Main then hardened it: `008fb8965` (issuer owns the renewal check), `5891e13d7`, `49bdcf65e`, `2ef749b3a`. `git cherry` shows `+` only because the rebase changed context lines. | — | (merge-tree: conflicts in `edge-verify.test.ts`; the work is already on main) | — | — |
| export-decision-log-to-csv-from-the-decisions-ta | `a2312c5ac` | feat(decisions): export the decision log | **LANDED** | `d6854b7f4` (2026-10-05), same subject. `app/features/hiring/decisions/DecisionsExportLog.tsx` exists and is mounted at `app/features/hiring/decisions/docket/DocketHead.tsx:131` (the header the branch edited, `DecisionsHeader.tsx`, was since deleted and the button moved with it). `app/features/insights/analytics/useDecisionLogExport.ts` and `decisionLogCsv.ts` are on main and `sections/DecisionLogTable.tsx:77` uses the shared hook, as the branch built it. | — | (merge-tree: add/add on `DecisionsExportLog.tsx`, `decisionLogCsv.test.ts`) | — | — |
| implement-hire-from-need-role-composition-and-un-2 | `fbf2fffe6` | feat(slate): one board, one frozen rubric for people and AI agents | **SUPERSEDED** | Reimplemented on main as `0c6993773` (2026-09-24, "put people and AI agents on one board under the frozen role rubric") under ADR-0012 (`docs/architecture/decisions/0012-need-role-slate-one-board.md`; the branch's "ADR-0009" was renumbered). Same two claims, different code: `pipeline_entries.population` and `rubric_version` (`app/_lib/db/core.ts:608,611`), `app/_lib/db/role-rubrics.ts` (`mintRoleRubric`, `freezeRoleRubric:231`), `app/_lib/db/role-slate.ts`, `app/_lib/role-rubric.ts`, `GET app/api/roles/[jobId]/slate/route.ts`. Rubric derivation is `1166893a1`, store `6a8856838`. Merging the branch would add a second, incompatible copy. | — | (merge-tree: conflicts in `core.ts`, `pipeline.ts`, `role-rubrics.ts`, `role-slate.ts`, …) | — | — |
| implement-the-jd-to-offer-pipeline-with-approval-3 | `c58d7d9d5` | feat(role-run): ledger, runner and three gates from ADR-0009 | **SUPERSEDED** | Reimplemented on main as `a660083b0` (2026-09-14, ledger + three gates) and `f6be0f24b` (resume via `nextStageFor`), under ADR-0011 (`docs/architecture/decisions/0011-one-role-runs-end-to-end.md`). Same shape, different files: `app/_lib/db/role-runs.ts`, `app/_lib/role-run-engine.ts`, `app/_lib/role-run-stages.ts` (`STAGE_GATE:69`, three gated stages), `app/_lib/role-run-gates.ts` (replaces the branch's `role-run-approval.ts`), doc `docs/features/hiring-pipeline/role-run-ledger.md`. The branch's `role-run-e2e.test.ts` has no counterpart by that name; `role-run-contract.test.ts` and `role-run-engine.test.ts` cover the contract. | — | (merge-tree: `core.ts` content conflict, add/add on the store test) | — | — |
| project-kpi-and-coverage-stewardship | `be2e8c93a` | feat(scheduling): booking-rate KPI probe | **OBSOLETE** | Not on main (`app/_lib/schedule-booking-rate.ts`, `scripts/kpi/self-scheduling-booking-rate.mjs` absent). A group-coverage KPI ("give the bare Interview Scheduling group a number") serving none of goals 1–3. Stewardship moved to goal-anchored probes on 2026-09-15 (`.ai/tasks/2026-09-15-goal-baselines-and-kpi-coverage.md`) and main now carries `scripts/kpi/{role-run-anchors,explainability-reason-coverage,reasons-coverage,analytics-error-hygiene}.mjs` plus `89b3bcd91` (NEED_TO_ROLE) and `e3eb8a36d` (readings on the buildable main). The 50% baseline (5 of 10) lives in the commit message. | — | (merge-tree: `package.json`, `context-map.json` — the latter since rebuilt by `5aeed564f`) | — | — |
| project-kpi-and-coverage-stewardship-12 | `06d683e27` | test(api): delete the channels/inbound leak-ceiling row | **STILL-WANTED** | `app/api/error-response-contract.test.ts:303` still carries `["channels/inbound/[token]/route.ts", 1]`, but the route answers `safeJsonError(error, "api:channels/inbound", "CHANNEL_INBOUND_FAILED")` (`app/api/channels/inbound/[token]/route.ts:234`). Running the file on main prints `leak-ceiling burnt down, delete the entry to lock the win: channels/inbound/[token]/route.ts` (5/5 pass). Until the row goes, one raw-message leak can be reintroduced into that public route and the ratchet stays green. Weakest of the three: it is a ratchet-tightening, not a behaviour change. | `app/api/error-response-contract.test.ts`; the branch also adds `.ai/tasks/2026-09-08-channels-error-hygiene-kpi.md` (record only) | none (`rc=0`) | S | none of 1–3; live correctness (a public, unauthenticated route's error-leak ratchet has one slack slot) |
| project-kpi-and-coverage-stewardship-2 | `40d93c6bf` | JD build failure-rate KPI probe | **OBSOLETE** | Not on main (`app/_lib/jd-build-failure-rate.ts`, `scripts/kpi/jd-build-failure-rate.mjs` absent) and the `jd_build` task it reads still exists (`app/_lib/jd-build-start.ts:70`), so it would still run. Same ground as the booking-rate branch: a group-coverage KPI with no goal behind it, superseded by the goal-anchored probes named above. Baseline 0.0% (0 of 5) is in the commit message. | — | (merge-tree: `package.json`) | — | — |
| project-kpi-and-coverage-stewardship-5 | `d31f6cf12` | docs(kpi): first four KPI measurements | **OBSOLETE** | One new file, `.ai/tasks/2026-09-07-kpi-measurements-and-scheduling-kpi.md`, a point-in-time record of four readings (automation fairness 100, EU AI Act enforced 25, JD build failure 0.0, booking rate 50.0) and a proposed scheduling KPI that depends on the branch above. Main's re-measurement is `.ai/tasks/2026-10-05-kpi-readings-on-buildable-main.md` (`e3eb8a36d`). The readings were also written to Personas `dev_kpi_measurements` per the commit message. | — | (merge-tree: clean — the file simply does not exist on main) | — | — |
| project-kpi-and-coverage-stewardship-6 | `a8df8ee83` | first reading for Candidate Matching & Ranking | **OBSOLETE** | One new file, `.ai/tasks/2026-09-07-matching-role-relevance-kpi.md`: `role_relevance_at5` 0.857 vs a 0.84 floor, plus a note that the live-refresh delivery (`bf7ee478`) could not be back-measured. The 0.857 is on main in `docs/development/testing-and-evaluation.md:436,452,511` and the floor is a `Bar` in `pipeline/jobfit/eval/thresholds.py`, so the number is enforced rather than merely recorded. The live-refresh half is moot (that branch is OBSOLETE above). | — | (merge-tree: clean) | — | — |
| the-compliance-regime-is-resolved-by-a-client-fe | `55c7ab846` | docs(compliance): client-fetch regime is not the candidate path | **LANDED** | `ff82ed7c5` (2026-09-21), same subject. `git cherry main <branch>` prints `-` (patch-equivalent). `docs/features/compliance/ai-act-conformity.md` and `docs/features/compliance/README.md` on main no longer cite a "public compliance endpoint"; the `getActiveRegimeId` JSDoc is corrected in `app/_lib/decision-config-store.ts`. | — | (merge-tree: README conflict only because main edited it further) | — | — |

### Already merged (0 commits ahead of main — not analysed further)

| branch | tip | verdict | evidence |
| --- | --- | --- | --- |
| accepted-idea-delivery-to-the-main-branch-11 | `a8040cf26` | ALREADY MERGED | `git merge-base --is-ancestor` true; `git rev-list --count main..` = 0 |
| accepted-idea-delivery-to-the-main-branch-8 | `add2fc24b` | ALREADY MERGED | same check; shares its tip with `implement-the-jd-to-offer-pipeline-with-approval` |
| implement-the-jd-to-offer-pipeline-with-approval | `add2fc24b` | ALREADY MERGED | same check |
| project-kpi-and-coverage-stewardship-14 | `5aeed564f` | ALREADY MERGED | same check |
| project-kpi-and-coverage-stewardship-3 | `0a7936c72` | ALREADY MERGED | same check |
| project-kpi-and-coverage-stewardship-8 | `66ee5f0de` | ALREADY MERGED | same check |

Count: 3 LANDED + 2 SUPERSEDED + 5 OBSOLETE (-5, KPI ×4) + 3 STILL-WANTED = 13, plus 6 already
merged = 19.

## PRUNE-READY

Every branch whose commit, or whose absence, has been accounted for above. Tip shas are in the
tables so a prune can be undone with `git branch <name> <sha>` while the objects survive.

LANDED
- `enforce-per-user-session-revocation-list-to-cove` (`f6e59d87f` → main `04b459639`)
- `export-decision-log-to-csv-from-the-decisions-ta` (`a2312c5ac` → main `d6854b7f4`)
- `the-compliance-regime-is-resolved-by-a-client-fe` (`55c7ab846` → main `ff82ed7c5`)

SUPERSEDED
- `implement-hire-from-need-role-composition-and-un-2` (`fbf2fffe6` → main `0c6993773`, ADR-0012)
- `implement-the-jd-to-offer-pipeline-with-approval-3` (`c58d7d9d5` → main `a660083b0`, `f6be0f24b`, ADR-0011)

OBSOLETE
- `accepted-idea-delivery-to-the-main-branch-5` (`bf7ee4789`)
- `project-kpi-and-coverage-stewardship` (`be2e8c93a`)
- `project-kpi-and-coverage-stewardship-2` (`40d93c6bf`)
- `project-kpi-and-coverage-stewardship-5` (`d31f6cf12`)
- `project-kpi-and-coverage-stewardship-6` (`a8df8ee83`)

ALREADY MERGED
- `accepted-idea-delivery-to-the-main-branch-11`, `accepted-idea-delivery-to-the-main-branch-8`,
  `implement-the-jd-to-offer-pipeline-with-approval`,
  `project-kpi-and-coverage-stewardship-14`, `project-kpi-and-coverage-stewardship-3`,
  `project-kpi-and-coverage-stewardship-8`

**Before pruning any of these, three facts about the checkout:**

1. Ten of the 19 branches are checked out in linked worktrees under
   `%APPDATA%\com.personas.desktop\worktrees\a9a1ef97*`. `git branch -d` refuses a checked-out
   branch, so each needs `git worktree remove` first.
2. Nine of those ten worktrees carry uncommitted changes that `git worktree remove` would
   discard (counts from `git status --porcelain`, read-only):
   `accepted-idea-delivery-to-the-main-branch` 2, `…-branch-11` 10, `…-branch-8` 12,
   `implement-the-jd-to-offer-pipeline-with-approval` 7 (including an untracked
   `app/_lib/approval-gate.ts`), `…-approval-3` 2, `project-kpi-and-coverage-stewardship-14` 19
   (staged), `…-3` 1, `…-8` 3 (including an untracked `scripts/kpi/`), and
   `the-compliance-regime-is-resolved-by-a-client-fe` 2. Many are `schemas.generated.ts` /
   `taxonomy.generated.ts` regeneration, which is noise; the rest are not, and only the first
   four paths of each were looked at. Look before removing. Only
   `enforce-per-user-session-revocation-list-to-cove` is clean.
3. `accepted-idea-delivery-to-the-main-branch` (`3935d5897`) has a worktree too, but it is on
   the RE-LAND list below, not here.

## RE-LAND

STILL-WANTED, ordered by goal priority (1 → 2 → 3 → correctness-only), then effort. All three
are S. None is a cherry-pick as-is: re-land each as a fresh commit on a branch cut from current
main, using the branch's commit as the spec.

1. **`accepted-idea-delivery-to-the-main-branch`** (`3935d5897`) — goal 1, S, merges clean.
   Change `return tx();` to `return tx.immediate();` in `closeEntriesByJobId` and
   `reopenEntriesByJobId` and add the two-connection test layer. Leave the `changes === 0`
   guards: a nested call gets a SAVEPOINT and the inner mode is ignored. Drop the
   `.claude/CLAUDE.md` hunk when re-landing — that file is dirty in the operator's checkout —
   and carry the `context-constraints.json` wording only if the owner wants the prose changed.
2. **`accepted-idea-delivery-to-the-main-branch-2`** (`cb71f9128`) — goal 1 (partial) + live
   correctness, S, one trivial import-block conflict in `app/_lib/screen-wave.ts`. Mirror the
   wave's auto-reject to `dispatchAtsEvent("candidate.rejected", …)`, give each webhook event
   row a `live|reserved` status pinned to the emit sites, and replace the false "others are
   reserved" footnote in four locales (4-locale parity applies; `npm run i18n:check`).
3. **`project-kpi-and-coverage-stewardship-12`** (`06d683e27`) — correctness only, S, merges
   clean. Delete the `channels/inbound/[token]/route.ts` row from `LEAK_CEILING`. The same
   test prints a second slack row, `billing/webhook/route.ts  1 -> 0`, which this branch does
   not cover; it can go in the same change.

No STILL-WANTED branch serves goal 2 or goal 3. Goal 2's code is on main (SUPERSEDED rows
above) and goal 3's open work is the `REASON_COVERAGE` widening already tracked in
`.ai/tasks/2026-10-05-kpi-readings-on-buildable-main.md`, not in any branch here.

## Judgement calls the owner may overturn

- **`…-main-branch-5` (live-refresh topics) is OBSOLETE, not STILL-WANTED**, because the
  STILL-WANTED test required a goal or a correctness need and this is a performance change with
  no measured symptom. If wanted, it is an M re-do from the idea, not a merge.
- **The two group-coverage KPI probes (booking rate, JD build failure rate) are OBSOLETE**
  because stewardship moved to goal-anchored KPIs. Both read tables that still exist, so
  reviving either is a small job (`app/_lib/*-rate.ts` plus a `scripts/kpi/` wrapper). Whether
  the matching Personas KPI rows are still active was not checked; that lives in `personas.db`,
  outside this repository.
- **`…-hire-from-need-…-2` is SUPERSEDED, not LANDED**: the same two claims shipped, in
  different code and under a renumbered ADR. Verified by file and commit, not by running both.

## Gates

Run in the worktree at `ea04bb4c9` with only this file added:

| gate | result |
| --- | --- |
| `npm run typecheck` | pass |
| `npm run lint` | pass — 0 errors, 49 warnings (existing `no-unused-expressions`) |
| `npm run test:unit -- 'app/_lib/auth/**/*.test.ts' 'app/api/**/*.test.ts'` | pass — 2111 of 2111 |

`typecheck` rewrites the three `app/_lib/*.generated.ts` files with CRLF line endings on this
machine; they were restored with a path checkout and are not part of the change.
