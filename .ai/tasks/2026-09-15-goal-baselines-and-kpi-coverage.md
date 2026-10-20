# Pre-merge baselines for goals 14b80beb and a82c273d, and KPI coverage for the contexts that serve them

Stewardship wake 15, 2026-09-15, branch `autopilot/project-kpi-and-coverage-stewardship-15`.
Measured against `origin/main` = `a8040cf2` (unchanged since wake 13; local `main` is 9 ahead
and unpushed, PRs #57 and #58 are still open).

## Why now

Two project goals were in `in-progress` with `kpi_id` null and no instrument behind them, so
their state could only be *described*. The delivery that would move them is sitting in two
unmerged PRs. The moment those merge, the back-measure should be a subtraction — not a fresh
investigation of what the words in a `measure_config` meant.

## 1. Failure accounting — the 6 failed task rows, by cause

All six are this project's rows in the 26 h window ending 2026-09-15T08:40Z. Cause read from
`dev_tasks.error` plus the matching `fleet_sessions` row, not inferred from the titles.

| Task | Title | Session state | Cause |
| --- | --- | --- | --- |
| `f7941588` | Add the role_rubrics store | `95d80207` **stale** — "No log growth for 6 min" | **Worktree/host.** Not the brief. |
| `fe08417a` | Derive a role rubric from a RoleBrief | same session | **Worktree/host.** |
| `94443d5b` | Role-run stage contract + resume read (R2) | same session | **Worktree/host.** |
| `c0e0531c` | Role-run stage contract + resume read (R2), re-dispatch | `fbf6fe15` **finished** | **Brief.** The worker refused on the record: R2 was dispatched with R1 not on main, and two competing unmerged R1+R2 implementations already existed. A correct refusal. |
| `44bbb1bd` | Candidate-visible decisions: only 1 of 15 kinds carries a decisive fact | `b96c0116` **exited**, `0xC000013A` (interrupted / console closed) | **Host.** |
| `438e65f1` | Count the goal's own measure: a reasons-coverage gate | same session | **Host.** |

Verdict on the standing hypothesis: **confirmed, with one correction.** The newest failures
really are host-killed runs — `b96c0116` is titled "Explainability Charter Delivery" and its
recorded exit code is the Windows control-C/console-closed status, with Claude mid-`● Edit`.
They are *not* this charter's own runs, though: they belong to the delivery lane in worktree
`accepted-idea-delivery-to-the-main-branch-11`. Five of six are infrastructure, one is a brief.
**Nothing here is a pipeline defect**, and nothing is a reason to re-file the underlying ideas —
`8480c01e` and `43bcd466` are still `accepted` and still correct.

The two host-killed tasks were the delivery for goal a82c273d. That is exactly why its baseline
is recorded here instead of waiting for them.

## 2. The baselines

Both are committed as runnable probes, keyless and network-free, reading any ref through
`git show` so a pre-merge number stays reproducible after the merge.

### `npm run kpi:role-run-anchors` → goal 14b80beb, KPI `df4812da`

`scripts/kpi/role-run-anchors.mjs`. Replaces the English description the KPI's `measure_config`
used to carry with the seven checks themselves.

```
ANCHORS=0/7 at origin/main=a8040cf2
```

The two open PRs are **disjoint** on this meter, which is what makes the back-measure arithmetic:

| Ref | Reads | Anchors |
| --- | --- | --- |
| `origin/main` a8040cf2 | **0/7** | — |
| PR #57 head `98e5dfee` | 3/7 | rubric_store, rubric_derivation, adr_0009 |
| PR #58 head `c02dbdc0` | 3/7 | ledger_ddl, stage_contract, gates |

So: 0 → 3 on either merge → **6 on both**. The 7th (`autonomy_read`,
`app/_lib/thread-autonomy.ts`, idea `42a4ecec`) is in neither, and it is the one anchor that
would let the **goal** be scored rather than its delivery. This KPI is a delivery proxy and
says so in its own output — do not quote it as autonomy.

### `npm run kpi:explainability` → goal a82c273d, KPIs `61f05ac7` and `dbab46f1`

`scripts/kpi/explainability-reason-coverage.mjs`. Two numbers from one read.

```
REASON_COVERAGE=1/14 at origin/main=a8040cf2
UNLABELLED_KINDS=0
```

A candidate on `/status/<token>` reads a **label** for all 14 visible decision kinds and a
**reason** for exactly one. A kind counts toward `REASON_COVERAGE` only when all three layers
agree — `redactDecisionForCandidate` can emit non-null `facts`, `messages/en.json` carries a
`status.decisions.reasons.<code>` string, and `StatusClient.tsx` renders that key. Counting the
intersection is what keeps it from becoming the vacuous counter ADR-0008 was written against:
server facts with no copy render nothing, and copy with no facts render nothing. The render gate
on main is literally `d.reasonCode === "reject" && d.facts`.

Target 5 = the AI-verdict subset, the kinds a machine writer seals today (`auto_rejected`,
`auto_advanced`, `ai_scorecard`, `group_eval_lead`, `group_eval_advisory`). The other nine are
human or scheduling events no candidate is owed a machine reason for.

**Limit, stated so nobody over-trusts it:** this counts *doors* ("this kind CAN show a reason"),
not corpus rows ("N% of real verdicts DID"). The corpus counter is idea `43bcd466` — accepted,
unshipped, and one of the two tasks the host interrupt killed.

### Non-vacuity — verified by control, not asserted

Both probes were run against deliberately broken inputs:

- `facts:` branch widened with `ai_scorecard` (the exact shape idea `8480c01e` proposes) → **2**.
- `facts:` branch removed (`facts: null`) → **0**.
- `ai_scorecard` line deleted from `decisionKindLabels` → `UNLABELLED_KINDS=1 (ai_scorecard)`.
- Unresolvable ref, and `3f49c4ca^` (before `status-decisions.ts` existed) → **exit 2, no number
  printed.** That refusal is the point: this probe reads source text, so a refactor must surface
  as "re-teach me", never as a silent 0 that reads like a regression.

### One near-miss, recorded so it is not re-found

`decisionKindLabels` maps **14** kinds onto **13** catalog strings, which looks like a gap.
It is not: `group_eval_lead` and `group_eval_advisory` are mapped to the shared `group_eval`
copy on purpose. Read the map before filing. (Same discipline as wake 7's auth recount.)
Separately, idea `8480c01e`'s title says "1 of 15" — the allowlist literal holds **14** entries.
The idea's finding is right; its denominator is off by one. A mechanical meter is why that shows.

## 3. KPI coverage

Before: **191 contexts, 1 with an active context-bound KPI.** After: **4.** Three groups, three
contexts, each chosen because the role-run or explainability code actually lives there — not by
sweeping the map.

| KPI | Context (group) | Reading | Target |
| --- | --- | --- | --- |
| `df4812da` Role-run delivery anchors | `task-automation-engine` (Hiring Pipeline) | 0/7 | 7 |
| `61f05ac7` Candidate-readable reason coverage | `hiring-decisions-offers` (Hiring Decisions) | 1/14 | 5 |
| `dbab46f1` Kinds with no candidate-facing label | `candidate-status-api` (Candidate Engagement) | 0 | 0 (ratchet) |

`dbab46f1` is a guard, not a goal. The server allowlist and the label map are two lists in two
files and **no gate compares them**; `StatusClient.tsx` names the failure mode in its own comment
(a kind exposed without copy "degrades to a de-snaked raw value"), which means English
snake_case shown to a candidate in every locale, silently. `i18n:check` cannot catch it — no key
is missing — and next-intl's typing cannot, because the degraded path is a fallback. Both the
explainability delivery and the role-run delivery widen that allowlist, so the ratchet earns its
place now rather than after.

## Revert

Repo side: delete `scripts/kpi/role-run-anchors.mjs`,
`scripts/kpi/explainability-reason-coverage.mjs`, this file, and the two `kpi:*` lines in
`package.json`. Nothing else imports them and no gate runs them.

Personas side, pre-state for the record:

- `df4812da` was `context_id` null / `context_group_id` null, `measure_config` = the English
  seven-anchor description, `current_value` 0.0, `last_measured_at` 2026-09-14 21:47:45.
- `61f05ac7` and `dbab46f1` did not exist. Readings `c3485d9a` (value 1) and `90e64bad` (value 0),
  plus `3a357329` (value 0) on `df4812da`, are the rows to drop.

No backlog item was filed this cycle — deliberately. The project stands at roughly 8.4 filed per
delivered; the two ideas that would move `61f05ac7` are already accepted and waiting.
