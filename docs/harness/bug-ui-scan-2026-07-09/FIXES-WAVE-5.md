# Fix Wave 5 — Hiring correctness & fairness (COMPLETE: 11 of 11)

> 9 commits, **11 Highs closed**. Finished across two sessions — the first four inline, the last
> seven via a re-dispatched agent trio the day after (the original five were killed by a session
> limit; see "Interrupted").
> Baseline preserved: tsc 0 · node unit 1404 → **1424** · python 797 → **855** OK · i18n 3234×4 parity · `next build` ✓.
> (The +26 python beyond this wave's own tests are a user voice-harness WIP that landed between sessions and was left untouched.)

These findings change **who gets hired**. They are not cosmetic and they are not theoretical.

## Commits

| Commit | Finding | Severity |
|---|---|---|
| `d141d08` | candidate-profile-job-matching #1 | High |
| `f8656ab` | analysis-result-panels #1 | High |
| `3b1a601` | analytics-calibration-dashboards #2 | High |
| `d08d089` | analytics-calibration-dashboards #1 | High |
| `3b61477` | matching-transformation-engine #1, #2, #3 | 3×High |
| `dee0a23` | github-evidence-cv-utilities #1, #2 | 2×High |
| `bbaadfc` | cv-extraction-pipeline-services #1, #2, #3 | 3×High |

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

### Resumed the next day (the remaining 7 Highs — all now closed)

The session limit reset overnight. Three fresh agents (matching / CV / GitHub, disjoint files)
were re-dispatched. One dropped again mid-work — this time on a transient connection error, not a
limit — and was **resumed from its own transcript** via SendMessage rather than restarted cold,
so its half-built approach was finished coherently instead of inherited by a stranger.

| Finding | Fix |
|---|---|
| matching-transformation-engine #1 | `ko_filter` now gates work-mode only when it is **not** in `job.defaulted_fields` — a phantom onsite no longer KOs remote candidates; a *stated* onsite still gates. |
| matching-transformation-engine #2 | `hits / max(5, must_have_count)` de-saturates overlap; the empty-language blend gives a **neutral** 0.5, not full credit (zeroing it would break `test_winnability`'s pinned 55-bar). |
| matching-transformation-engine #3 | `missing` now requires `best <= 0.0`; a claimed-but-discounted exact skill is neither matched nor missing. |
| cv-extraction-pipeline-services #1 | Deterministic injection heuristic + a grounding check on near-max-over-empty scores both raise `(manual review)`; a "treat the CV as data" preamble in the prompt. Residual stated honestly. |
| cv-extraction-pipeline-services #2 | `_looks_like_role_headline` (matched against taxonomy vocab) rejects a headline as the name. |
| cv-extraction-pipeline-services #3 | Split standalone pronouns from a case-sensitive `_HONORIFIC`; bare "MS" survives. |
| github-evidence-cv-utilities #1, #2 | Account-type check rejects org handles before any repo fetch; a three-state (found / no-evidence / could-not-determine) model suppresses `potentialGaps` when coverage is incomplete. |

**Safety gate honored:** the matching change was validated with
`python -m pipeline.jobfit.eval.matching_eval --strict` — **8/8 PASS, Fairness 4/4, zero
top-score delta**, before and after. The wrong exclusions are corrected without perturbing the
calibrated rankings. (Independently re-run by the orchestrator, not taken on the agent's word.)

## Verification

| Gate | Before | After |
|---|---|---|
| `tsc --noEmit` | 0 | 0 |
| node unit | 1404 | **1424** |
| python | 797 OK | **855 OK** (incl. +26 user voice-harness WIP, untouched) |
| `matching_eval --strict` | 8/8 PASS | **8/8 PASS, zero delta** |
| `i18n:check` | 3233 × 4 | **3234 × 4** |
| `next build` | ✓ | ✓ |

Every fix confirmed **non-vacuous** by neutering it in-source and watching exactly its own tests go
red: the pre-fix reference picks `tiny` and reports adverse impact; the old `toCsv` emits
`=cmd|'/c calc'!A1`; the old defaults returned `software_engineering`/`medior`; restoring the broad
`\bms\b` re-redacted "MS SQL"; disabling the injection screens dropped all six of their notes.

## Patterns (catalogue items 17–21)

17. **A codebase that states an invariant in prose will violate it in code.**
    `role-families.ts` says "Never assume software" three lines above a call site that assumed
    software. Grep for the *stated* rule, then grep for its violations — the comment is a lead.
18. **A binary readout cannot express "we don't know."** Green/red forced `insufficient sample`
    into `no adverse impact`. Any verdict surface computed from data that may be absent needs a
    third state, or it will lie in the safest-looking direction.
19. **Triage a dead agent's edits; never inherit them.** A partial fix that typechecks is the most
    dangerous artifact in the tree. One of three here was dead code shaped like a fix; one was a
    library change whose UI consumer would have rendered a false clean.
20. **Resume a dropped agent from its transcript; don't restart it cold.** When an agent dies on a
    *transient* error (a closed connection, not a usage limit) with partial edits and a note about
    what's left, `SendMessage` to its id finishes its own approach coherently. Starting fresh makes
    a stranger inherit half-built work — the exact hazard of pattern 19. (Distinguish the cause: a
    usage limit won't resume until it resets; a connection drop resumes immediately.)
21. **When a fix respects an out-of-scope pinned test, that's a feature.** The GitHub agent found
    `apply-intake.test.ts` deliberately pins deeper-URL→owner-handle resolution, so it closed the
    org-attribution hole with an account-*type* check instead of tightening the handle parser. The
    narrower fix that leaves a pinned contract intact beats the broad one that breaks it.

## Known flake (observed once, NOT fixed — evidence recorded)

During final verification the full unit suite reported **7 failures on one run** with a clean,
unchanged working tree, then passed **7 consecutive runs** afterwards.

The distinguishing condition: at the time of the failing run, `os.tmpdir()` held **1111 leftover
`kp-*` entries** — mostly `kp-unit-db/run-*` directories. The suite runs with
`--test-isolation=process`, so every test file spawns a process, and `unit-db.ts` sweeps that root
at module load (`readdirSync` + `statSync` + `rmSync` per entry). After deleting the 1111
leftovers, 7/7 runs were clean.

This is almost certainly `data-store-persistence.md` **finding #4**, which the scan raised
independently and which remains **OPEN**: *"the unit-db stale-sweep can delete a live
long-running test's DB dir."* Leftovers accumulate by design — `cleanupUnitDb()` cannot remove a
directory while an isolated store still holds the SQLite file on Windows, so the sweep is the only
reclaim path, and it is racing hundreds of sibling processes.

Deliberately **not** patched here: the fix belongs with finding #4, and a speculative change to
shared test infrastructure — on evidence from a single unreproduced failure — is exactly the kind
of thing that produces a worse bug. What is recorded instead:

- the trigger (a large backlog of stale `kp-*` dirs in tmpdir),
- the mitigation until #4 is fixed (`rm -rf $TMPDIR/kp-*` before a full run),
- and the fact that the suite is **not** deterministic under that condition.

The gate numbers reported for waves 4 and 5 were all taken on clean, reproduced runs.

## Status after this wave

**Criticals 9/9 · Highs 29/66 · Wave 5 complete (11/11).** 34 commits on the branch.
tsc 0 · node unit 1424 · python 855 OK · i18n 3234×4 · `next build` ✓ · `matching_eval --strict` 8/8.

Remaining: **37 Highs**, 125 Medium, 30 Low, per the INDEX. Next themes: W6 races/TOCTOU
(close-case double-reject, preview→confirm recompute, auto-advance CAS, offer re-extend),
W7 data integrity (`seedAnalyses` boot-wipe, sim leak, benchmark contamination), W8+ UI/a11y (33).
