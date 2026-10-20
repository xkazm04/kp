---
kind: task
status: done
opened: 2026-10-06
charter: accepted-idea-delivery
branch: autopilot/accepted-idea-delivery-23bb7230
gate: npm run test:unit -- 'app/_lib/auth/**/*.test.ts' 'app/api/**/*.test.ts'
measurable: autopilot/* branches with a verified full tip sha, a set and a worktree verdict. Before 0 of 19. After 19 of 19 (16 PRUNE-16, 3 RE-LANDED-3). Worktrees under com.personas.desktop with every uncommitted path listed and compared with main. Before 0 of 9. After 9 of 9.
---

# Autopilot prune inventory — 19 branches, 9 worktrees, a plan the Director runs

A record, not an action. This run removed nothing, deleted nothing and moved no ref. Against
the other worktrees it used only `git -C <path> status --porcelain --untracked-files=all`,
`git -C <path> diff HEAD --numstat`, `git -C <path> rev-parse HEAD`, `git hash-object`, and
file reads. Read at local `main` = `f73cac452a210dbaa8a4dd81f2cd342cf3ed8d6d`. Input:
`.ai/tasks/2026-10-06-autopilot-branch-reconcile.md` (main commit
`b798fbcec7a705d530e022d0c445f670fbd5d645`).

## What changed since the reconcile record, and what it means for the prune

1. **Every one of the nine worktrees has `node_modules` as a link to the main checkout's
   `node_modules`** (`readlink` → `/c/Users/kazda/kiro/kp/node_modules`). `git worktree remove
   --force` follows such a link and deletes the target's contents; this is the confirmed cause
   of the emptied packages recorded on 2026-09-23. **The removal plan therefore unlinks
   `node_modules` first, with `rmdir` (which removes the link and nothing behind it).** Do not
   skip that line.
2. The reconcile counted ten branches in worktrees. Today there are nine: the worktree for
   `enforce-per-user-session-revocation-list-to-cove` is gone from `git worktree list`, so that
   branch is now checked out nowhere.
3. Of the nine worktrees, **three are SAFE-TO-REMOVE** (only GENERATED paths) and **six are
   KEEP-AND-FLAG** (they hold NON-GENERATED paths that are ABSENT on or DIFFERENT from main).
4. A plain `git worktree remove` refuses a dirty worktree. The three safe ones are dirty with
   two generated files each, so the plan uses `--force`, and what `--force` discards is exactly
   those two generated files.

## Conventions used below

- `base` = `C:/Users/kazda/AppData/Roaming/com.personas.desktop/worktrees/a9a1ef97-c684-4c32-b622-44cd4ea1ea05`.
  Every worktree below is `base/<name>` except `02b57904`, which is
  `C:/Users/kazda/AppData/Roaming/com.personas.desktop/worktrees/a9a1ef97/02b57904`.
- Worktree verdicts: **SAFE-TO-REMOVE** (clean, or only GENERATED or IDENTICAL paths) and
  **KEEP-AND-FLAG** (any NON-GENERATED path that is ABSENT or DIFFERENT).
- `vs main: +A −D` is `git diff --no-index --numstat` from `git show main:<path>` to the working
  file: A lines the worktree has that main lacks, D lines main has that the worktree lacks. Where
  a worktree was cut long ago, most of that is main's own drift. `own: +a −d` is the worktree's
  uncommitted change against its own HEAD (`git diff HEAD --numstat`), which is the actual work
  at stake.
- No NON-GENERATED path anywhere is IDENTICAL to main. Each one is ABSENT or DIFFERENT.
- Tips were checked with `git rev-parse refs/heads/<branch>`; all 19 match the expected short
  shas.

## Branch table

Branch names drop the `autopilot/` prefix. Sets: PRUNE-16 (16 branches) and RE-LANDED-3 (3).
`ahead` is `git rev-list --count main..<branch>`.

| branch | full tip sha | reconcile verdict | set | worktree (under `base/` unless noted) | worktree verdict |
| --- | --- | --- | --- | --- | --- |
| accepted-idea-delivery-to-the-main-branch | `3935d5897d4eaabad718d66ff41f73943ce83e7a` | STILL-WANTED | RE-LANDED-3 | `accepted-idea-delivery-to-the-main-branch` | SAFE-TO-REMOVE |
| accepted-idea-delivery-to-the-main-branch-11 | `a8040cf2600453238add24d00898d2d4891a06f2` | ALREADY MERGED (ahead 0) | PRUNE-16 | `accepted-idea-delivery-to-the-main-branch-11` | KEEP-AND-FLAG |
| accepted-idea-delivery-to-the-main-branch-2 | `cb71f9128e23ac757a6e9ef17460bd9457a82d95` | STILL-WANTED | RE-LANDED-3 | none | n/a |
| accepted-idea-delivery-to-the-main-branch-5 | `bf7ee478922b96626d62548475081b96a535b4e6` | OBSOLETE | PRUNE-16 | none | n/a |
| accepted-idea-delivery-to-the-main-branch-8 | `add2fc24b9509bb2de53edffa9ae84588779cbf1` | ALREADY MERGED (ahead 0) | PRUNE-16 | `accepted-idea-delivery-to-the-main-branch-8` | KEEP-AND-FLAG |
| enforce-per-user-session-revocation-list-to-cove | `f6e59d87f783fdcf73769913dd7b1a150e2419b0` | LANDED (main `04b459639`) | PRUNE-16 | none | n/a |
| export-decision-log-to-csv-from-the-decisions-ta | `a2312c5acb698874ed2a67f1067bde178128f990` | LANDED (main `d6854b7f4`) | PRUNE-16 | none | n/a |
| implement-hire-from-need-role-composition-and-un-2 | `fbf2fffe649881ef41863e8fdd6e81e4742a02fc` | SUPERSEDED (main `0c6993773`, ADR-0012) | PRUNE-16 | none | n/a |
| implement-the-jd-to-offer-pipeline-with-approval | `add2fc24b9509bb2de53edffa9ae84588779cbf1` | ALREADY MERGED (ahead 0) | PRUNE-16 | `implement-the-jd-to-offer-pipeline-with-approval` | KEEP-AND-FLAG |
| implement-the-jd-to-offer-pipeline-with-approval-3 | `c58d7d9d56a05a1e70c538b42cdff35ed75bf07e` | SUPERSEDED (main `a660083b0`, `f6be0f24b`, ADR-0011) | PRUNE-16 | `implement-the-jd-to-offer-pipeline-with-approval-3` | SAFE-TO-REMOVE |
| project-kpi-and-coverage-stewardship | `be2e8c93a09df0bbcb43bac8f0530d8af08e6102` | OBSOLETE | PRUNE-16 | none | n/a |
| project-kpi-and-coverage-stewardship-12 | `06d683e275ab055e5a1b4b8477d2e9a50568c3ba` | STILL-WANTED | RE-LANDED-3 | none | n/a |
| project-kpi-and-coverage-stewardship-14 | `5aeed564fbdddddb3613dcbf4385b4b83ee655e0` | ALREADY MERGED (ahead 0) | PRUNE-16 | `project-kpi-and-coverage-stewardship-14` | KEEP-AND-FLAG |
| project-kpi-and-coverage-stewardship-2 | `40d93c6bf5126ecbd86bdbcde0b46f92174972c4` | OBSOLETE | PRUNE-16 | none | n/a |
| project-kpi-and-coverage-stewardship-3 | `0a7936c7284bdfb0638c0dfe2ec578329dc446df` | ALREADY MERGED (ahead 0) | PRUNE-16 | `project-kpi-and-coverage-stewardship-3` | KEEP-AND-FLAG |
| project-kpi-and-coverage-stewardship-5 | `d31f6cf12007ffe07ee59823c364108beb5daf9c` | OBSOLETE | PRUNE-16 | none | n/a |
| project-kpi-and-coverage-stewardship-6 | `a8df8ee834a572b74553040b513c2693c31757f9` | OBSOLETE | PRUNE-16 | none | n/a |
| project-kpi-and-coverage-stewardship-8 | `66ee5f0de367d4e871a440bd15d45c4ce1486d39` | ALREADY MERGED (ahead 0) | PRUNE-16 | `project-kpi-and-coverage-stewardship-8` | KEEP-AND-FLAG |
| the-compliance-regime-is-resolved-by-a-client-fe | `55c7ab84665e4a995d0e99204a8b2fd95c1ff324` | LANDED (main `ff82ed7c5`) | PRUNE-16 | `C:/Users/kazda/AppData/Roaming/com.personas.desktop/worktrees/a9a1ef97/02b57904` | SAFE-TO-REMOVE |

Count: 19 rows, each branch once. 16 PRUNE-16 + 3 RE-LANDED-3. Not in the table: this run's own
branch `autopilot/accepted-idea-delivery-23bb7230`.

Two branches share the tip `add2fc24b…`: `accepted-idea-delivery-to-the-main-branch-8` and
`implement-the-jd-to-offer-pipeline-with-approval`. Each has its own worktree, and both are
KEEP-AND-FLAG, so the shared tip is no reason to treat them as one.

Verified for the merged and landed claims: the six ALREADY MERGED tips are ancestors of main
(`git merge-base --is-ancestor` true, ahead 0). The main commits named for LANDED and SUPERSEDED
(`04b459639`, `d6854b7f4`, `ff82ed7c5`, `0c6993773`, `a660083b0`, `f6be0f24b`) are all ancestors
of main today.

## Worktree table

Every entry in `git worktree list` under `C:/Users/kazda/AppData/Roaming/com.personas.desktop/worktrees/`.
All nine are listed. Status code is `git status --porcelain` (`M ` staged, ` M` unstaged, `A `
staged add, `D ` staged delete, `??` untracked), and the full list was read with
`--untracked-files=all`, so a directory shows every file in it.

GENERATED evidence used below:

- `app/_lib/schemas.generated.ts`, `app/_lib/taxonomy.generated.ts`: both open with
  `// AUTO-GENERATED — DO NOT EDIT.`; `pipeline/jobfit/codegen.py` writes them (`OUTPUT`,
  `TAXONOMY_OUTPUT`, lines 50–51); `scripts/schemas-gen.mjs` runs that codegen, and `npm run
  typecheck` and `npm run build` both run `schemas:gen` first. The reconcile record already
  found these regenerated on this machine.
- `._kpiresp.json`: a Personas API response body (`id`, `project_id`, `context_group_id`,
  `name`, …), 2626 bytes, a scratch capture of a KPI write, the class the brief names.
- `.ai/tmp-kpi3/kpis.json`: a 32449-byte single-line JSON dump of Personas `dev_kpis` rows,
  an export with no authored source.
- `.ai/tmp-kpi3/writeback-1.json`: written by `.ai/tmp-kpi3/writeback.mjs` itself
  (`fs.writeFileSync(".ai/tmp-kpi3/writeback-1.json", …)`), so it is that script's output.

| worktree | branch | uncommitted path | class | comparison with main |
| --- | --- | --- | --- | --- |
| `accepted-idea-delivery-to-the-main-branch` | accepted-idea-delivery-to-the-main-branch | ` M app/_lib/schemas.generated.ts` | GENERATED | codegen output (see above) |
| | | ` M app/_lib/taxonomy.generated.ts` | GENERATED | codegen output |
| `accepted-idea-delivery-to-the-main-branch-11` | …-main-branch-11 | ` M app/_lib/schemas.generated.ts` | GENERATED | codegen output |
| | | ` M app/_lib/taxonomy.generated.ts` | GENERATED | codegen output |
| | | ` M app/_lib/interview-scorecard.ts` | NON-GENERATED | DIFFERENT. vs main +34 −60; own +33 −0. Adds `sealableScorecardRatings`, which main does not have. |
| | | ` M app/_lib/status-decisions.ts` | NON-GENERATED | DIFFERENT. vs main +136 −145; own +161 −10. Adds `autoAdvanceFacts`, `decisionFacts`, `FACT_BEARING_DECISION_KINDS`, none on main. `autoRejectFacts` and `aiScorecardFacts` are on main. |
| | | ` M app/api/interview/complete/route.ts` | NON-GENERATED | DIFFERENT. vs main +71 −112; own +10 −1 (seals per-competency `ratings` into the verdict inputs). |
| | | ` M app/status/[token]/StatusClient.tsx` | NON-GENERATED | DIFFERENT. vs main +46 −140; own +49 −4. |
| | | ` M messages/cs.json` | NON-GENERATED | DIFFERENT. vs main +632 −7062; own +9 −1. |
| | | ` M messages/de.json` | NON-GENERATED | DIFFERENT. vs main +634 −7064; own +9 −1. |
| | | ` M messages/en.json` | NON-GENERATED | DIFFERENT. vs main +630 −7060; own +9 −1 (`threshold` / `verdict` / `verdictConfidence` / `rubric` fact strings and a `recommendations` block). |
| | | ` M messages/fr.json` | NON-GENERATED | DIFFERENT. vs main +634 −7064; own +9 −1. |
| `accepted-idea-delivery-to-the-main-branch-8` | …-main-branch-8 | ` M app/_lib/schemas.generated.ts` | GENERATED | codegen output; its content differs from the other worktrees' regenerated copy, consistent with this worktree's uncommitted `codegen.py` change below |
| | | ` M app/_lib/taxonomy.generated.ts` | GENERATED | codegen output |
| | | ` M app/_lib/db/pipeline.ts` | NON-GENERATED | DIFFERENT. vs main +195 −827; own +1 −0. |
| | | ` M app/_lib/tenancy.ts` | NON-GENERATED | DIFFERENT. vs main +1 −150; own +6 −0. |
| | | `A  docs/architecture/decisions/0009-one-role-runs-end-to-end.md` | NON-GENERATED | ABSENT ON MAIN (214 lines). Main's `0009` is a different ADR; this one became `0011-one-role-runs-end-to-end.md`. |
| | | `A  docs/architecture/decisions/0010-need-role-slate-one-board.md` | NON-GENERATED | ABSENT ON MAIN (206 lines). It became `0012-need-role-slate-one-board.md`. |
| | | ` M docs/architecture/decisions/README.md` | NON-GENERATED | DIFFERENT. vs main +4 −8; own +4 −0. |
| | | `A  docs/concepts/autonomous-role-run.md` | NON-GENERATED | DIFFERENT. vs main +5 −5 (246 lines; near-identical to main's). |
| | | `A  docs/concepts/need-to-role-to-slate.md` | NON-GENERATED | DIFFERENT. vs main +2 −15 (153 lines). |
| | | ` M pipeline/jobfit/codegen.py` | NON-GENERATED | DIFFERENT. vs main +7 −103; own +4 −0. This is the codegen script itself, so it is source, not output. |
| | | `?? pipeline/jobfit/rolerubric.py` | NON-GENERATED | DIFFERENT. vs main +79 −114. Main has a `rolerubric.py` (`5d9f52d758…`); this one is another version. |
| | | `?? pipeline/jobfit/tests/fixtures/role_rubric_cases.json` | NON-GENERATED | DIFFERENT. vs main +19 −191. |
| `implement-the-jd-to-offer-pipeline-with-approval` | implement-the-jd-to-offer-pipeline-with-approval | ` M app/_lib/db/core.ts` | NON-GENERATED | DIFFERENT. vs main +76 −1025; own +49 −0 (the `role_runs` and `role_run_stages` DDL, with `budget_ceiling_usd`). |
| | | ` M app/_lib/db/pipeline.ts` | NON-GENERATED | DIFFERENT. vs main +199 −827; own +5 −0 (two `ERASURE_EXEMPT` rows). |
| | | ` M app/_lib/tenancy.ts` | NON-GENERATED | DIFFERENT. vs main +10 −155; own +10 −0 (the two tables added to `TENANCY_SCOPED_TABLES`). |
| | | `?? app/_lib/approval-gate.ts` | NON-GENERATED | ABSENT ON MAIN (221 lines). |
| | | `?? app/_lib/db/role-runs.ts` | NON-GENERATED | DIFFERENT. vs main +221 −263. |
| | | `?? app/_lib/role-run-stages.ts` | NON-GENERATED | DIFFERENT. vs main +257 −459. |
| | | `?? app/_lib/role-run/ports.ts` | NON-GENERATED | ABSENT ON MAIN (116 lines). The `role-run/` directory holds this one file and nothing else. |
| `implement-the-jd-to-offer-pipeline-with-approval-3` | …-approval-3 | ` M app/_lib/schemas.generated.ts` | GENERATED | codegen output |
| | | ` M app/_lib/taxonomy.generated.ts` | GENERATED | codegen output |
| `project-kpi-and-coverage-stewardship-14` | …-stewardship-14 | ` M app/_lib/schemas.generated.ts` | GENERATED | codegen output |
| | | ` M app/_lib/taxonomy.generated.ts` | GENERATED | codegen output |
| | | `M  app/_components/ChainEmptyState.tsx` | NON-GENERATED | DIFFERENT. vs main +26 −19; own +19 −6. |
| | | `M  app/_components/CompletionCta.tsx` | NON-GENERATED | DIFFERENT. vs main +4 −5; own +4 −5. |
| | | `M  app/_components/ui/recipe-debt.json` | NON-GENERATED | DIFFERENT. vs main +84 −1; own +3 −0. |
| | | `M  app/_components/ui/recipes-literals.test.ts` | NON-GENERATED | DIFFERENT. vs main +12 −0; own +12 −0. |
| | | `M  app/_components/ui/recipes.ts` | NON-GENERATED | DIFFERENT. vs main +14 −8; own +14 −0. Adds `ARROW_LINK`, which main does not have. |
| | | `M  app/features/hiring/pipeline/empty/PipelineEmptyState.tsx` | NON-GENERATED | DIFFERENT. vs main +18 −23; own +10 −3. |
| | | `M  app/features/insights/analytics/AnalyticsEmptyShared.tsx` | NON-GENERATED | DIFFERENT. vs main +2 −1; own +2 −1. |
| | | `M  app/features/insights/matrix/MatrixEmptyState.tsx` | NON-GENERATED | DIFFERENT. vs main +6 −4; own +2 −2. |
| | | `M  app/features/library/jds/JdsEmptyShelf.tsx` | NON-GENERATED | DIFFERENT. vs main +17 −4; own +14 −3. |
| | | `D  app/features/library/jds/JdsEmptyStates.tsx` | NON-GENERATED | DIFFERENT (deleted here; main still has the file, 20 lines; own +0 −20). |
| | | `M  app/features/library/jds/JdsLedgerTable.tsx` | NON-GENERATED | DIFFERENT. vs main +14 −10; own +4 −4. |
| | | `M  app/features/library/jobs/JobsCampaignTab.tsx` | NON-GENERATED | ABSENT ON MAIN (145 lines; the file is gone from main's tree). own +2 −2. |
| | | `M  app/features/shell/tabs.test.ts` | NON-GENERATED | DIFFERENT. vs main +33 −1; own +32 −0. |
| | | `M  app/features/shell/tabs.ts` | NON-GENERATED | DIFFERENT. vs main +18 −44; own +17 −2. Adds a `carry` argument to `buildTabSwitchUrl`, which main's version lacks. |
| | | `M  app/features/tools/profile/ProfileEmptyStates.tsx` | NON-GENERATED | DIFFERENT. vs main +9 −4; own +2 −1. |
| | | `M  app/interview/[token]/page.tsx` | NON-GENERATED | DIFFERENT. vs main +55 −112; own +2 −2. |
| | | `M  docs/design/README.md` | NON-GENERATED | DIFFERENT. vs main +57 −370; own +28 −2. |
| `project-kpi-and-coverage-stewardship-3` | …-stewardship-3 | `?? .ai/tmp-kpi3/kpis.json` | GENERATED | Personas `dev_kpis` export (see above). Not on main. |
| | | `?? .ai/tmp-kpi3/writeback-1.json` | GENERATED | output of `writeback.mjs`. Not on main. |
| | | `?? .ai/tmp-kpi3/writeback.mjs` | NON-GENERATED | ABSENT ON MAIN (34 lines, 5103 bytes). A hand-written one-off that posts KPI measurements to the local Personas bridge. **It hard-codes a Personas local-token string** (not repeated here). Do not commit or copy this file anywhere. |
| `project-kpi-and-coverage-stewardship-8` | …-stewardship-8 | ` M package.json` | NON-GENERATED | DIFFERENT. vs main +23 −40; own +1 −0 (adds the `kpi:tenancy-proof` script). Main's `package.json` has no such script. |
| | | `?? ._kpiresp.json` | GENERATED | Personas API response capture (see above). Not on main. |
| | | `?? scripts/kpi/tenancy-proof-coverage.mjs` | NON-GENERATED | ABSENT ON MAIN (95 lines). File by file against main's `scripts/kpi/`: main holds `analytics-error-hygiene.mjs`, `explainability-reason-coverage.mjs`, `reasons-coverage.mjs`, `role-run-anchors.mjs` and `__tests__/`. None shares a name with it, and nothing on main mentions `tenancy-proof-coverage` or `kpi:tenancy-proof`. The branch tip itself tracks no `scripts/kpi/` file. |
| `02b57904` | the-compliance-regime-is-resolved-by-a-client-fe | ` M app/_lib/schemas.generated.ts` | GENERATED | codegen output |
| | | ` M app/_lib/taxonomy.generated.ts` | GENERATED | codegen output |

Worktree verdicts:

| worktree | verdict | why |
| --- | --- | --- |
| `accepted-idea-delivery-to-the-main-branch` | SAFE-TO-REMOVE | two GENERATED paths only (but its branch is RE-LANDED-3, so not in this prune) |
| `accepted-idea-delivery-to-the-main-branch-11` | KEEP-AND-FLAG | 8 NON-GENERATED paths, all DIFFERENT |
| `accepted-idea-delivery-to-the-main-branch-8` | KEEP-AND-FLAG | 10 NON-GENERATED paths: 2 ABSENT, 8 DIFFERENT |
| `implement-the-jd-to-offer-pipeline-with-approval` | KEEP-AND-FLAG | 7 NON-GENERATED paths: 2 ABSENT, 5 DIFFERENT |
| `implement-the-jd-to-offer-pipeline-with-approval-3` | SAFE-TO-REMOVE | two GENERATED paths only |
| `project-kpi-and-coverage-stewardship-14` | KEEP-AND-FLAG | 17 NON-GENERATED paths: 1 ABSENT, 16 DIFFERENT |
| `project-kpi-and-coverage-stewardship-3` | KEEP-AND-FLAG | `writeback.mjs` is NON-GENERATED and ABSENT ON MAIN, and carries a token |
| `project-kpi-and-coverage-stewardship-8` | KEEP-AND-FLAG | `package.json` DIFFERENT, `tenancy-proof-coverage.mjs` ABSENT ON MAIN |
| `02b57904` | SAFE-TO-REMOVE | two GENERATED paths only |

### Case 1 — `implement-the-jd-to-offer-pipeline-with-approval`: does main's role-run code cover these files?

Mostly yes, by a different design under ADR-0011. The exceptions are the third and fifth bullets.

- **`approval-gate.ts` (ABSENT ON MAIN) is covered by `app/_lib/role-run-gates.ts`.** Both
  generalise the screen-wave approval token to three gates over the same 15-minute window,
  single-spend ledger and five refusal reasons. Main's version delegates to
  `screen-wave-approval.ts` (`SCREEN_WAVE_APPROVAL_MAX_AGE_MS`, `ScreenWaveApprovalError`, the
  verify and consume functions), scopes the token `<runId>#<gate>`, and exposes
  `roleRunGateToken`, `verifyRoleRunGateToken`, `commitRoleRunGate`. The names and the gate
  vocabulary differ (`rejection|interview_invite|offer` against the worktree's
  `rejection_review|calendar|offer_review`).
- **`db/role-runs.ts` and `role-run-stages.ts` (DIFFERENT) are covered by main's files of the
  same name.** Main's ledger has `role_runs` and an append-only `role_run_stages` with the
  transition table, `nextStageFor` resume, and a PII write guard (`assertStagePayloadPiiFree`,
  the counterpart of the worktree's `assertLedgerSafePayload`). Both tables are in main's
  `TENANCY_SCOPED_TABLES` (`app/_lib/tenancy.ts:264-265`) and in the erasure-exempt map
  (`app/_lib/db/pipeline.ts:2365`), so the worktree's `tenancy.ts` and `pipeline.ts` hunks have
  main equivalents. Main's schema differs: it has `cycle`, `seq` and `branch_ref` and creates
  the tables in `db/role-runs.ts`, not `core.ts`.
- **Not covered: a per-run USD ceiling.** The worktree's `role_runs.budget_ceiling_usd` and the
  `spentUsd` port have no counterpart in main's `db/role-runs.ts` or `role-run-engine.ts`. Main
  bounds a run with `SLATE_CAP = 20` and a per-pass ceiling (`ceilingHit`), not a spend limit.
- **`role-run/ports.ts` (ABSENT ON MAIN) is covered in intent, not in shape.** Main injects
  `StageRunners` into `advanceRoleRun(…, { runners })` rather than a `RoleRunPorts` object, so
  stages test without a key. The worktree's `mintInvite` / `mintOffer` "gate-only" split is
  mirrored by main's runners drafting and parking (`createOffer` is "never called by the run").
- **Not found on main: the `sealGateDecision` port.** `role-run-engine.ts` and
  `role-run-gates.ts` contain no hook that seals a gate decision into the decision-record
  chain. I did not search the whole tree for another place that does it, so treat this as
  "not in the role-run modules", not "nowhere".

So only the spend ceiling is a clear gap. Nothing here is a reason to keep the *branch*: the
tip `add2fc24b…` is an ancestor of main. It is a reason to keep this *worktree*, because the
uncommitted files are the only copy of that design.

### Case 2 — `project-kpi-and-coverage-stewardship-8`

- `package.json`: one added line, `"kpi:tenancy-proof": "node scripts/kpi/tenancy-proof-coverage.mjs"`.
  Main has no such line. DIFFERENT (+23 −40 against main is main's drift).
- `scripts/kpi/tenancy-proof-coverage.mjs` (the only file in the worktree's `scripts/kpi/`): a
  KPI meter that counts tables in `TENANCY_SCOPED_TABLES` with no colocated `*-tenancy.test.ts`.
  ABSENT ON MAIN, with no same-named or equivalent file there (comparison above).
- `._kpiresp.json`: GENERATED scratch (the KPI row the Personas bridge returned).

## KEEP list — PRUNE-16 branches held back by a KEEP-AND-FLAG worktree

A branch checked out in a worktree cannot be deleted while that worktree stays. Six of the
sixteen are held back. Their branch *tips* are already on main; what is at risk is the
uncommitted work beside them.

| branch | held by | reason |
| --- | --- | --- |
| accepted-idea-delivery-to-the-main-branch-11 | `…-main-branch-11` | 8 DIFFERENT paths. Fact-extraction work for the status door (`sealableScorecardRatings`, `autoAdvanceFacts`, `decisionFacts`) is not on main, and its four locale files carry new strings. |
| accepted-idea-delivery-to-the-main-branch-8 | `…-main-branch-8` | Staged ADRs `0009`/`0010` are ABSENT ON MAIN (their content now lives as `0011`/`0012`, which is a different file); `rolerubric.py`, its fixture and the `codegen.py` hunk are DIFFERENT. |
| implement-the-jd-to-offer-pipeline-with-approval | `implement-the-jd-to-offer-pipeline-with-approval` | `approval-gate.ts` and `role-run/ports.ts` ABSENT ON MAIN; the per-run USD ceiling has no main equivalent (Case 1). |
| project-kpi-and-coverage-stewardship-14 | `…-stewardship-14` | 17 NON-GENERATED paths staged: the empty-state refactor (`ARROW_LINK`, `buildTabSwitchUrl` `carry`) is not on main. |
| project-kpi-and-coverage-stewardship-3 | `…-stewardship-3` | `.ai/tmp-kpi3/writeback.mjs` ABSENT ON MAIN and holds a token. The KPI writes it made already happened in Personas, so what is at stake is the script, not data. |
| project-kpi-and-coverage-stewardship-8 | `…-stewardship-8` | `scripts/kpi/tenancy-proof-coverage.mjs` ABSENT ON MAIN; `package.json` DIFFERENT (Case 2). |

Releasing a KEEP branch needs a decision about the worktree first (rescue the file onto a
branch, or accept the loss). That is the owner's call, not this inventory's.

## REMOVAL PLAN — PRUNE-16 only

**Text for the Director to run. This run did not run any of it.** Paths are given in both
forms: `git` takes the forward-slash one, `cmd` the backslash one. Run from any checkout of the
repository.

Rules for the plan:

1. A worktree's `node_modules` is a link to the main checkout's. Remove the **link** first with
   `rmdir` (no `/s`), which cannot reach the target. Only then `git worktree remove --force`.
   Afterwards confirm `C:\Users\kazda\kiro\kp\node_modules\.bin` still exists.
2. `--force` is needed only because the worktree is dirty; for the two SAFE-TO-REMOVE worktrees
   below, the dirt is exactly the two generated files.
3. `git branch -D` is needed because squashed or re-landed branches are not ancestors of main.
4. The undo line restores the branch ref only. It works while the commit object still exists
   (before `git gc` prunes it), and it cannot bring back a worktree's uncommitted files.

### Branches with a SAFE-TO-REMOVE worktree (2)

```
# implement-the-jd-to-offer-pipeline-with-approval-3
cmd //c "rmdir C:\Users\kazda\AppData\Roaming\com.personas.desktop\worktrees\a9a1ef97-c684-4c32-b622-44cd4ea1ea05\implement-the-jd-to-offer-pipeline-with-approval-3\node_modules"
git worktree remove --force "C:/Users/kazda/AppData/Roaming/com.personas.desktop/worktrees/a9a1ef97-c684-4c32-b622-44cd4ea1ea05/implement-the-jd-to-offer-pipeline-with-approval-3"
git branch -D autopilot/implement-the-jd-to-offer-pipeline-with-approval-3
# undo: git branch autopilot/implement-the-jd-to-offer-pipeline-with-approval-3 c58d7d9d56a05a1e70c538b42cdff35ed75bf07e

# the-compliance-regime-is-resolved-by-a-client-fe
cmd //c "rmdir C:\Users\kazda\AppData\Roaming\com.personas.desktop\worktrees\a9a1ef97\02b57904\node_modules"
git worktree remove --force "C:/Users/kazda/AppData/Roaming/com.personas.desktop/worktrees/a9a1ef97/02b57904"
git branch -D autopilot/the-compliance-regime-is-resolved-by-a-client-fe
# undo: git branch autopilot/the-compliance-regime-is-resolved-by-a-client-fe 55c7ab84665e4a995d0e99204a8b2fd95c1ff324
```

### Branches checked out nowhere (8)

```
git branch -D autopilot/accepted-idea-delivery-to-the-main-branch-5
# undo: git branch autopilot/accepted-idea-delivery-to-the-main-branch-5 bf7ee478922b96626d62548475081b96a535b4e6

git branch -D autopilot/enforce-per-user-session-revocation-list-to-cove
# undo: git branch autopilot/enforce-per-user-session-revocation-list-to-cove f6e59d87f783fdcf73769913dd7b1a150e2419b0

git branch -D autopilot/export-decision-log-to-csv-from-the-decisions-ta
# undo: git branch autopilot/export-decision-log-to-csv-from-the-decisions-ta a2312c5acb698874ed2a67f1067bde178128f990

git branch -D autopilot/implement-hire-from-need-role-composition-and-un-2
# undo: git branch autopilot/implement-hire-from-need-role-composition-and-un-2 fbf2fffe649881ef41863e8fdd6e81e4742a02fc

git branch -D autopilot/project-kpi-and-coverage-stewardship
# undo: git branch autopilot/project-kpi-and-coverage-stewardship be2e8c93a09df0bbcb43bac8f0530d8af08e6102

git branch -D autopilot/project-kpi-and-coverage-stewardship-2
# undo: git branch autopilot/project-kpi-and-coverage-stewardship-2 40d93c6bf5126ecbd86bdbcde0b46f92174972c4

git branch -D autopilot/project-kpi-and-coverage-stewardship-5
# undo: git branch autopilot/project-kpi-and-coverage-stewardship-5 d31f6cf12007ffe07ee59823c364108beb5daf9c

git branch -D autopilot/project-kpi-and-coverage-stewardship-6
# undo: git branch autopilot/project-kpi-and-coverage-stewardship-6 a8df8ee834a572b74553040b513c2693c31757f9
```

Total in this plan: 2 + 8 = 10 branches deleted. The other 6 PRUNE-16 branches are in the KEEP
list above. 10 + 6 = 16.

Five of the eight were judged OBSOLETE on judgement, not on a landed commit
(`accepted-idea-delivery-to-the-main-branch-5` and the four `project-kpi-and-coverage-stewardship`
branches). Deleting the ref leaves the commit unreachable, so `git gc` will eventually drop it,
and `bf7ee4789` is the only full copy of the live-refresh topics design apart from Personas idea
`4aa57abb`. If that matters, tag it first: `git tag archive/live-refresh-topics bf7ee478922b96626d62548475081b96a535b4e6`.

## RE-LANDED-3 — not in this prune; for a later pass

Each branch's tip is **not** an ancestor of main (it was re-landed as a fresh commit), so the
proof is the re-landing commit plus the behaviour in today's code. `git merge-base --is-ancestor
<sha> main` was run for all three re-landing commits: true.

| branch | tip | re-landed by (full sha, ancestor of main) | code evidence on main today |
| --- | --- | --- | --- |
| accepted-idea-delivery-to-the-main-branch | `3935d5897d4eaabad718d66ff41f73943ce83e7a` | `708456dad79a6d9675da59af6e56d3753fdad2e3` fix(pipeline): close and reopen hold the write lock from BEGIN | `app/_lib/db/pipeline.ts:883` `closeEntriesByJobId` ends `return tx.immediate();` (`:952`); `:982` `reopenEntriesByJobId` ends `return tx.immediate();` (`:1012`). The reconcile found both ended `return tx();`. The commit also grew `pipeline-close-guard.test.ts`. |
| accepted-idea-delivery-to-the-main-branch-2 | `cb71f9128e23ac757a6e9ef17460bd9457a82d95` | `e00ada3cb9b50a4682eec4c6c56a75c53e43f0b6` fix(ats): the screening wave's auto-rejects reach the ATS, and the webhook note stops denying events fire | `app/_lib/screen-wave.ts:7` imports `dispatchAtsEvent` and `:631` calls `void dispatchAtsEvent("candidate.rejected", updated.id, workspaceId)`. `integrationsWebhookIdentifiers.ts` rows now carry a `status` (`SubscribableEventRow`, `:47`) pinned by `integrationsCatalog.test.ts`. The false "others are reserved" sentence no longer matches in `messages/en.json`. The commit touches all four locales. |
| project-kpi-and-coverage-stewardship-12 | `06d683e275ab055e5a1b4b8477d2e9a50568c3ba` | `b399237e10a066f58ca1c1e2c0b004d91b936be9` test: lock two burnt-down leak-ceiling rows … | `app/api/error-response-contract.test.ts:303` is now a comment ("channels/inbound's single leak was FIXED … The row is deleted so the win is locked"), and `:276` says the same for `billing/webhook`. The commit also changes that file (4 lines) and adds `.ai/tasks/2026-10-06-leak-ceiling-and-tenancy-pins.md`. |

Only the first branch has a worktree (SAFE-TO-REMOVE: two GENERATED paths). Same commands as
above; run them in a later pass, not this one.

```
# accepted-idea-delivery-to-the-main-branch
cmd //c "rmdir C:\Users\kazda\AppData\Roaming\com.personas.desktop\worktrees\a9a1ef97-c684-4c32-b622-44cd4ea1ea05\accepted-idea-delivery-to-the-main-branch\node_modules"
git worktree remove --force "C:/Users/kazda/AppData/Roaming/com.personas.desktop/worktrees/a9a1ef97-c684-4c32-b622-44cd4ea1ea05/accepted-idea-delivery-to-the-main-branch"
git branch -D autopilot/accepted-idea-delivery-to-the-main-branch
# undo: git branch autopilot/accepted-idea-delivery-to-the-main-branch 3935d5897d4eaabad718d66ff41f73943ce83e7a

# accepted-idea-delivery-to-the-main-branch-2  (no worktree)
git branch -D autopilot/accepted-idea-delivery-to-the-main-branch-2
# undo: git branch autopilot/accepted-idea-delivery-to-the-main-branch-2 cb71f9128e23ac757a6e9ef17460bd9457a82d95

# project-kpi-and-coverage-stewardship-12  (no worktree)
git branch -D autopilot/project-kpi-and-coverage-stewardship-12
# undo: git branch autopilot/project-kpi-and-coverage-stewardship-12 06d683e275ab055e5a1b4b8477d2e9a50568c3ba
```

## OUT OF SCOPE — listed, not analysed

| path | HEAD |
| --- | --- |
| `C:/t/kp-cbm` | `f39924f812e05541dc4126f011593e3ce176ec04` (detached) |
| `C:/t/kp-psm` | `7340988e2925943a0b6ae800b78a549f9df7cb24` (detached) |
| `C:/t/kpb` | `427cdc3d0a953dbcc5801f2c2b42e0c1fc98fb07` (detached) |
| `C:/Users/kazda/kiro/kp/.claude/worktrees/goal-engine-matrix` | `eec605ba1b495b098162e37da57f8f69c971f53b` (branch `goals/engine-matrix-leftover`) |

## Gates

Run in this worktree with only this file added; see the commit and result record for the
outcome.
