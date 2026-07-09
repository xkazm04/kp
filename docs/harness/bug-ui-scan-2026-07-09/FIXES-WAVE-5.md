# Fix Wave 5 — Hiring correctness & fairness (PARTIAL: 4 of 11)

> 4 commits, **4 Highs closed**. **7 Highs remain open in this wave** — see "Interrupted" below.
> Baseline preserved: tsc 0 · node unit 1404 → **1421** (+17) · python 797 OK · i18n 3234×4 parity · `next build` ✓.

These findings change **who gets hired**. They are not cosmetic and they are not theoretical.

## Commits

| Commit | Finding | Severity |
|---|---|---|
| `d141d08` | candidate-profile-job-matching #1 | High |
| `f8656ab` | analysis-result-panels #1 | High |
| `3b1a601` | analytics-calibration-dashboards #2 | High |
| `d08d089` | analytics-calibration-dashboards #1 | High |

## What was fixed

### The engine assumed everyone was a software engineer

`resolveCandidate` hard-defaulted `roleFamily` to `software_engineering` and seniority to
`medior`. `role-families.ts` states the opposite invariant *in as many words* —
`DEFAULT_ROLE_FAMILY = "general_professional"`, documented **"Never assume software"**. A nurse,
an electrician, or any degraded extraction was silently scored as a mid-level SWE.

Both defaults are now honest sentinels. The fail-closed `"unknown"` **archetype** path from a
prior run is untouched and now pinned by a regression test.

### The score-breakdown chart flattered weak candidates

`FactorChart` plotted raw values on an auto-scaled y-axis. The five components have different
ceilings (25/30/23/12/10), so the axis snapped to the largest bar *value*: a uniformly weak
candidate (8/25, 7/30, 6/23, 3/12, 2/10) had their tallest bar drawn **at full height**. A
recruiter reads "maxed out" where the truth is 8/25. The domain floated per candidate, so two
charts could not be compared by eye either.

Bars now encode `value / max` on a pinned `[0,1]` domain; the tooltip still shows the true raw
`N/max`. The normalization contract moved to a pure `app/_lib/factor-points.ts` — it lived in a
component that imports recharts, so it had been untestable where it sat.

### The four-fifths rule had no floor

A single applicant, selected 1-of-1, became the 100% reference. Replaying the pre-fix logic on
`[tiny 1/1, a 60/100, b 60/100]`: **two identical, perfectly healthy groups both report adverse
impact.** The mirror-image false negative was equally reachable. Its own siblings already gate on
cohort size (`MIN_CALIBRATION_OUTCOMES = 20`, `SALARY_BENCHMARK_MIN_COHORT = 3`), so the omission
was an inconsistency, not a design choice.

`ADVERSE_IMPACT_MIN_COHORT = 30` (EEOC 29 CFR 1607.4D cautions against findings "based on small
numbers" but codifies no floor; 30 is the standard rule-of-thumb for a defensible proportion).

**"Insufficient sample" is a third state.** The compute forces `anyAdverseImpact = false` when
unreliable, so a binary green/red readout would have rendered a *false clean bill of health* —
exactly the trap the fix exists to close. `ComplianceSection` renders it as its own neutral state,
with real translations in all four locales.

### CSV exports executed candidate-supplied formulas

`toCsv` escaped RFC-4180 delimiters but not `= + - @` (nor a leading tab/CR). A candidate-controlled
name flowing into the decision-log or roles export ran on open — DDE, or `=WEBSERVICE()`
exfiltration of the sheet. RFC-4180 quoting is no defense; the parser strips quotes before
evaluating. Fixed once inside `toCsv`, since every export carries candidate text and a call-site
fix protects only the call sites someone remembered.

## Interrupted

Five subagents were dispatched for this wave. **All five were terminated mid-flight by a session
usage limit.** Three had written partial edits; those were triaged rather than trusted:

- `pipeline/jobfit/matching.py` — **reverted.** The agent had added a `defaulted` variable and
  died before using it. Dead code that reads like a fix is worse than no fix.
- `app/_components/FactorChart.tsx` — **completed.** The design was sound; only the next-intl
  literal-key typing was broken (`t()` rejects a widened `string`). Finished and tested.
- `app/_lib/adverse-impact.ts` — **completed.** The library change was correct but the UI consumer
  had not been updated, so a sub-floor sample would have rendered green "no adverse impact". That
  false clean was the whole point of the finding; the third state was added.

**Still open in this wave (7 Highs):**

| Finding | Why it matters |
|---|---|
| matching-transformation-engine #1 | A phantom `work_mode` default hard-KOs remote-only candidates out of every ad that never stated a work mode. `campaign.py` and the salary coach honor `defaulted_fields`; `ko_filter` does not. |
| matching-transformation-engine #2 | `score_personal` saturates skill overlap at 5 hits and gifts 0.5 to an empty-language blend. |
| matching-transformation-engine #3 | `score_skills` files a self-declared **exact** must-have into `missing` (match weight 0.4 < 0.5 threshold), hitting the protected early-career cohort hardest. |
| cv-extraction-pipeline-services #1 | CV-embedded prompt injection drives the numeric score and plants recruiter-facing narrative. |
| cv-extraction-pipeline-services #2 | `_guess_name_line` accepts a role headline as the name, so blind mode masks "Machine Learning Engineer" as `[NAME]` throughout. |
| cv-extraction-pipeline-services #3 | `\bms\b` in `_PRONOUN` redacts every "MS" — Master of Science, MS SQL, MS Office — as a gendered term. |
| github-evidence-cv-utilities #1, #2 | An **organization** handle attributes the org's whole portfolio to one candidate; partial throttling yields an empty-but-successful evidence blob. |

Anything touching `matching.py` **must** be validated with
`python -m pipeline.jobfit.eval.matching_eval --strict` and the delta reported. A regression there
is a real signal, not an eval to be adjusted.

## Verification

| Gate | Before | After |
|---|---|---|
| `tsc --noEmit` | 0 | 0 |
| node unit | 1404 | **1421** |
| python | 797 OK | 797 OK |
| `i18n:check` | 3233 × 4 | **3234 × 4** |
| `next build` | ✓ | ✓ |

All four fixes confirmed **non-vacuous**: the pre-fix reference selection picks `tiny` and reports
adverse impact where the new tests demand otherwise; the old `toCsv` emits `=cmd|'/c calc'!A1`
verbatim; the old defaults returned `software_engineering`/`medior`.

## Patterns (catalogue items 17–19)

17. **A codebase that states an invariant in prose will violate it in code.**
    `role-families.ts` says "Never assume software" three lines above a call site that assumed
    software. Grep for the *stated* rule, then grep for its violations — the comment is a lead.
18. **A binary readout cannot express "we don't know."** Green/red forced `insufficient sample`
    into `no adverse impact`. Any verdict surface computed from data that may be absent needs a
    third state, or it will lie in the safest-looking direction.
19. **Triage a dead agent's edits; never inherit them.** A partial fix that typechecks is the most
    dangerous artifact in the tree. One of three here was dead code shaped like a fix; one was a
    library change whose UI consumer would have rendered a false clean.
