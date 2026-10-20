# KPI readings on the newly buildable main

Stewardship run, 2026-10-05, branch `autopilot/project-kpi-stewardship-cea8b12e`.
Every probe was run against `HEAD` = `84fa0c95e` (local `main`; `origin/main` is `541617fc3`,
behind and unpushed, and was not read). The worktree was clean when the probes ran. No probe
was changed: none errored, so nothing moved under them.

Baselines are from `.ai/tasks/2026-09-15-goal-baselines-and-kpi-coverage.md` (read at
`origin/main` = `a8040cf2`). Two probes have no figure in that file; their baseline is
quoted from the commit that introduced them and the source is named in the table.

## 1. Readings

| Probe (command) | Value | Read at | Baseline | Delta |
| --- | --- | --- | --- | --- |
| `node scripts/kpi/role-run-anchors.mjs --ref HEAD --json` | **ANCHORS = 6/7** | `84fa0c95e` | 0/7 at `a8040cf2` | **+6** |
| `node scripts/kpi/explainability-reason-coverage.mjs --ref HEAD --json` — `REASON_COVERAGE` | **2/14** | `84fa0c95e` | 1/14 at `a8040cf2` | **+1** |
| same probe — `UNLABELLED_KINDS` | **0** (`unlabelled_kinds: []`) | `84fa0c95e` | 0 | 0 |
| `npm run kpi:reasons -- --json` — `total` | **66/66, ratio 1** (`ranking` 66/66; `scorecard` 0/0 and `rejection` 0/0 are `measured: false`) | working tree = `84fa0c95e` (this probe takes no `--ref`; it reads the checkout and `data/seed_*`, `source.db` is `null`) | 66/66 on the seeded rankings per commit `a591fb074` (2026-09-15) | 0 |
| `node scripts/kpi/analytics-error-hygiene.mjs` | **4** across 4 route files | working tree = `84fa0c95e` (reads `app/api/error-response-contract.test.ts`) | 5 when wired, per commit `ca27da263` (2026-09-07) | **-1** |

Raw detail behind the rows:

- **Anchors present (6):** `ledger_ddl`, `stage_contract`, `gates`, `rubric_store`,
  `rubric_derivation`, `adr_0009`. **Absent (1):** `autonomy_read`
  (`app/_lib/thread-autonomy.ts`; the file does not exist at `HEAD`). This is the same seventh
  anchor the 09-15 note said neither open PR carried; both PRs' anchors have now landed on main
  (3 + 3 = 6, as that note predicted).
- **REASON_COVERAGE = 2:** `server_fact_kinds` = `auto_rejected`, `ai_scorecard`. Catalog and
  render both carry `reject`, `staleScore`, `rubric`. At the baseline only `auto_rejected`
  counted, so the one kind added is `ai_scorecard` — the widening idea `8480c01e` proposed.
  Target stays 5 (the AI-verdict subset). Still short: `auto_advanced`, `group_eval_lead`,
  `group_eval_advisory`.
- **`kpi:reasons`:** the seeded corpus holds 66 rankings and no scorecards or rejections, so
  two of the three arms have no denominator. The 66/66 is a statement about rankings only; it
  is not evidence that scorecards or rejections carry reasons.
- **Analytics debt:** `analytics/route.ts`, `analytics/calibration/route.ts`,
  `analytics/calibration/band/route.ts`, `analytics/calibration/threshold-history/route.ts`,
  one each. Target 0. The fifth row from the 09-07 wiring (`profile/draft`) is gone.

Raw outputs are reproducible with the commands above at `84fa0c95e`; nothing here was
estimated.

## 2. Key goal → instrument

| Goal | Instrument | How well it measures the goal |
| --- | --- | --- |
| 1. One role runs end to end without a human step | `role-run-anchors.mjs` (6/7) | **Delivery proxy, not autonomy.** It counts whether the pieces of the role-run exist in source (ledger tables, stage contract, gates, rubric store, rubric derivation, ADR, autonomy read). 6/7 says the scaffolding is on main; it says nothing about whether a run completes, or how many human steps it needed. The one anchor aimed at the goal itself, `autonomy_read`, is the one that is missing. Do not quote this number as autonomy. A further caveat: `app/_lib/role-run-engine.ts` exists on main but is not one of the seven anchors, so the probe does not register it. That is what the probe counts, and it was left alone. |
| 2. Hire-from-need composes a role from a stated need | **No instrument.** | No KPI probe exists. Adjacent, not a substitute: `npm run test:eval:intake` (`intake_eval --no-llm --strict`) is a pass/fail gate on the need → RoleBrief dialog only. I ran it at `84fa0c95e`: `12/12 personas PASS · 98 checks`. It stops at the brief; it does not cover the rubric, the JD or the pipeline entry, and it is not wired to a KPI. |
| 3. Every automated step is explainable to the candidate | `explainability-reason-coverage.mjs` (`REASON_COVERAGE` 2/14, target 5) with `UNLABELLED_KINDS` (0) as its guard; `kpi:reasons` (66/66, rankings only) as the second view | **Doors, not rows.** `REASON_COVERAGE` counts decision kinds that *can* show a reason on `/status/<token>`, not the share of real verdicts that did. `kpi:reasons` is the closest thing to a row count but has no denominator for scorecards or rejections on a clean checkout. |

## 3. Proposed probes for goals with no instrument

Text only; none of these has been built or run. All three would be keyless and network-free,
and would refuse to print a number when their inputs are missing rather than print 0 (the
house rule from the 09-15 note).

1. **`NEED_TO_ROLE` (goal 2).** Take the golden answers of the 12 scenarios in
   `intake_scenarios.json`, drive them through the existing offline intake agent to a
   RoleBrief, then through the deterministic `rolerubric.py` derivation and the keyless JD
   build fallback. Count scenarios that reach a *complete* role: brief core fields present,
   rubric derived, JD draft produced. Report `n/12` and name the stage where each failing
   scenario stops. This extends what `intake_eval` already does one stage further and uses
   only fixtures that are already in the repo.
2. **`HUMAN_STEPS_PER_RUN` (goal 1).** Replay one seeded role through the role-run stage
   contract (`role-run-stages.ts`, `nextStageFor()`) with every approval gate answered by a
   fixed scripted decision, and count the stage transitions that need input other than those
   gates. A run that reaches its terminal stage with only the declared gates is `0`
   unscripted steps. This scores the run, not its scaffolding, and would let `autonomy_read`
   (idea `42a4ecec`) be judged against something real. It depends on whether the engine can be
   driven without a live provider; if it cannot, the probe's first job is to say so.
3. **`REASON_ROWS` (goal 3).** Run the keyless automation eval (`automation_eval --no-llm`)
   and the screen wave over the seeded corpus so that scorecard and rejection verdicts
   actually exist, then feed them to the same pure counter in
   `app/_lib/reasons-coverage.ts` that `kpi:reasons` uses. That gives the two arms that are
   `measured: false` today a denominator, turning the door count into a row count. It must
   keep `measured: false` for any arm that still has nothing to count.
