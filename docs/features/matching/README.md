# Matching & scoring

How a candidate profile turns into a match score against a job: skill/taxonomy
matching, provenance weighting, the early-career dimension swap, bounded
dynamic weights, and the cross-candidate fairness matrix. Candidate intake and
archetype detection are `docs/features/candidates/README.md`.

## Entry points

- **Fit matrix** (`?tab=matrix`) — `app/features/insights/matrix/MatrixTab.tsx`. One
  surface, two modes behind a segmented control:
  - **Grid** (pool-first: every candidate × every open role) — `MatrixGrid.tsx`,
    `MatrixReasoningPopover.tsx`.
  - **Candidate focus** (candidate-first: one candidate ranked against every role) —
    `focus/MatrixCandidateFocus.tsx`, results in `focus/MatchResults.tsx` /
    `focus/MatchCard.tsx`, per-skill provenance chips in `focus/MatchCardSkillChips.tsx`.
    This was the standalone **Match tab** until it was folded in; `?tab=match`
    still resolves (`LEGACY_TAB_ALIASES` in `app/features/shell/tabs.ts`) and the
    `?profile=<id>` / `?analysis=<slug>` params it always carried are what tell
    MatrixTab to open focus mode.
- **Weights panel** (per-role weight tuning) — `app/features/insights/matrix/focus/MatchWeightsPanel.tsx`.
- **Group evaluation** (fairness matrix, weight rationale) —
  `app/features/hiring/decisions/GroupEvalModal.tsx`, `GroupEvalComparisonCells.tsx`.
- **Recruiter candidate list** (experienced vs. early-career columns) —
  `app/features/library/jobs/JobsRecruiterCandidatesCard.tsx`.
- **Interview compare** (per-cohort rubric) —
  `app/features/library/jobs/JobsCompareInterviews.tsx`.
- **About → Archetypes chapter** (how a candidate is routed, and why the three
  scoring slots change meaning) —
  `app/features/insights/about/scenes/archetypes/ArchetypeRouter.tsx`.
  The former "About → Students" worked example
  (`AboutStudents*.tsx`) was removed when the About tab was rebuilt as a
  six-chapter explainer; the early-career scoring model it illustrated is
  unchanged and still lives in `pipeline/jobfit/transform.py`.

## Flows

### 1. Skill matching over a shared taxonomy
`pipeline/jobfit/taxonomy.py` resolves both CV skill claims and JD requirements
to shared taxonomy terms with hierarchy credit: exact = 1.0, specialization =
0.9, generalization = 0.55. This is what lets a thesis on "convolutional
networks" match a JD asking for "machine learning" without text-similarity
noise. Coverage is tracked per role family in `data/taxonomy.json` (16
families, 676 terms total) — see below.

#### Language knock-out: alias buckets, matched on word boundaries
The KO filter's language gate (`matching.py::_has_language`) resolves a required
language to a curated alias bucket in `data/taxonomy.json::language_aliases` (12
buckets today) and tests each alias as a substring of the candidate's lowercased
language list. Some aliases carry a trailing space as a **word boundary** — `"en "`
exists so the ISO code cannot match inside `german` / `french` / `slovenian`. The
candidate blob is therefore PADDED on both ends before the test; without the pad
that boundary is unsatisfiable at the end of the list, so a candidate whose
languages ended with the code (`["Czech", "EN"]`, or just `["EN"]`) failed an
English requirement and was hard-KO'd out of the pool before ever being scored —
while the same two entries in the other order passed. Position must never decide a
knock-out. Pinned by
`test_whole_token_classification.DataDrivenLanguageAliasesTest`.

A required language with no bucket falls back to a literal substring match on its
bare English name — deliberate and documented, not an oversight; modelling a new
language means adding a bucket (config), not changing the fallback.

### 2. Provenance weighting (evidence-gated, not presence-gated)
Every matched skill is discounted by where the claim came from
(`skill_match_score()` in `taxonomy.py`, multiplies taxonomy match × weight):

| provenance | weight | | provenance | weight |
|---|---|---|---|---|
| observed | 1.00 | | personal_project | 0.70 |
| professional | 1.00 | | extracurricular | 0.60 |
| open_source / internship | 0.85 | | certification | 0.60 |
| thesis | 0.75 | | coursework | 0.50 |
| academic_project | 0.70 | | self_declared | 0.40 |

`observed` (a skill demonstrated live in a case or case-grounded interview,
minted by `pipeline/jobfit/live_case.py`) outranks even `professional` — the
one path by which a candidate with no history can out-rank tenure on a specific
skill.

**Default provenance is `self_declared` (0.4), not `professional` (1.0).**
This changed 2026-07-20 (`SCORING_REBASELINE`, driver: UAT run
`uat/runs/2026-07-20-cases-scoring`): previously, a skill with **no recorded
provenance at all** was silently credited as `professional` — level with five
years in production — and the discount that did exist applied only to
early-career candidates (`pipeline/jobfit/transform.py`), so the same
unevidenced claim was penalised for the person least able to evidence it and
waived for everyone else. Three call sites converged on one fix because they
all inherit the shared default: `taxonomy.py:DEFAULT_PROVENANCE`,
`transform.py`'s per-archetype default, and `app/_lib/candidate-pool.ts` (which
emits no provenance and inherits the Python default). A skill at the default
scores 0.4 → below `_MATCH_THRESHOLD` (0.5) → lands in `unproven_skills`, not
`matched_skills`, but still contributes a discounted amount to the skills
sub-score — it is never zeroed and never becomes a knockout `missing` (KO
filtering runs on seniority/languages only, unaffected).

Verified against the eval corpus at the time of the change: `matching_eval`
8/8, fairness probes 4/4, archetype accuracy 100%, scenario scores
byte-identical (curated fixtures already carry real provenance, so the default
barely applied to them — confirming the change only bites unevidenced
production data). **Operational consequence, not yet re-tuned as of this
writing:** production CVs where `gemini.py`'s `skill_claims` extraction omits
provenance will now score materially lower than before the change.
`maxMatchToReject`/family-floor filters calibrated against the old (inflated)
numbers, saved score-based filters, and any cross-boundary score trend need
re-tuning; `pipeline_entries.match_score` is a snapshot, so cohorts scored
before/after this change are not comparable in the same screening wave
(`automation-pass.ts::scoreUnscoredEntries` only fills unscored rows — it will
not refresh old snapshots). Re-score a mixed-vintage cohort before running a
wave over it.

### 3. Early-career dimension swap
For `student`/`career_switcher` archetypes, `pipeline/jobfit/matching.py`
(`_DIM_SLUG_EARLY`) replaces the `career` dimension (seniority/family fit —
undefined for someone with no track record) with **`potential_score`**, and
`personal` (JD keyword overlap) with **motivation** (aspirations coherence +
role-family hit + language). `potential_score` is a deterministic rubric over
the evidence structure — 35% depth + 25% learning velocity + 25% foundation +
15% initiative — validated to `[0,1]` at the Pydantic boundary
(`MatchCandidate.potential_score`), clamped so out-of-range values can't
corrupt the 0–100 dial. It is a candidate-supplied score dimension, not derived
from years of experience.

The KO gate also swaps: instead of a seniority-gap check, early-career profiles
get an **entry-eligibility** check (§4) — a student vs. a senior-only role is a
clean KO with a reason, not a depressed score.

### 4. Graduate-friendliness gate (the JD side of comparability)
`compute_entry_profile` in `pipeline/jobfit/jobs.py` computes a deterministic,
LLM-free `graduate_friendliness ∈ [0,1]` per job and an `is_entry_eligible`
gate, pinned by golden tests (`pipeline/jobfit/tests/test_jobs.py`):

```
is_entry = seniority == "junior"  OR  years <= 1.0  OR  entry_signal
```

Score is additive then clamped: junior title +0.5, medior +0.2, years ≤1 +0.2
(1–2y +0.1), learnable-must-have fraction × 0.2, explicit early-career language
(`entry_signal`) +0.2. A role that fails the eligibility gate is capped at 0.15
regardless of sub-scores, so it can never read as graduate-friendly even if a
few signals fire. This directly orders which jobs an early-career candidate is
shown — students are only matched against roles they can realistically land.

### 5. Bounded dynamic weights + fairness matrix
`pipeline/jobfit/weight_proposal.py` lets an LLM propose per-candidate weight
adjustments (calibrated pool-wide in one call, with rationale), but each weight
may move at most ±0.15 from the archetype baseline and is clamped to
`[0.10, 0.60]` — no dimension can be zeroed. At compare time,
`fairness_matrix()` (`matching.py`) re-scores every candidate under every
candidate's own weight scheme and ranks by cross-scheme mean; if that robust
order diverges from the headline order, the recruiter sees a divergence flag
(surfaced in `GroupEvalModal.tsx` / `GroupEvalComparisonCells.tsx` alongside the
per-candidate weight rationale and an "AI-tuned vs rule-based" pill). This is
opt-in at group evaluation (`app/_lib/group-eval-run.ts`); the plain candidate
list stays deterministic.

### 6. Interview & reasoning per cohort
`interview-rubrics.json` scores experienced candidates on the original 5
competencies and early-career candidates on 6 BARS-anchored constructs
(problem decomposition, learning agility, coachability, conceptual depth,
motivation & direction, communication & collaboration); every rating requires a
verbatim transcript quote, and "not assessed" is a legal answer. Match
reasoning (`pipeline/jobfit/match_reasoning.py`, prompt `match-reasoning-v3`)
is archetype-conditional:
experienced candidates get track-record verification, students get a
"judge on potential" frame, career-switchers get a bridge narrative (prior-domain
maturity de-risks the switch; new-domain hard skills read "learnable but
unproven"). Since the 2026-08-11 bench round: `aspirations` feed the context
for every archetype (not early-career only), the verdict must state the match
total + tier in words, probes must verify rather than embed unstated premises,
the grounding post-check accepts highlight/summary-grounded strengths, and a
core-backfilled result reports `source=deterministic`. The `jd_ingest`
extraction prompt (`jobs.py`) gained fidelity rules in the same round: duties
never filed as requirements, `min_education` consistent with the stated
requirements, company/location/work-mode never guessed.

## Surface

| Concern | Files |
|---|---|
| Skill/taxonomy matching | `pipeline/jobfit/taxonomy.py`, `data/taxonomy.json` |
| Core scoring | `pipeline/jobfit/matching.py`, `pipeline/jobfit/transform.py`, `pipeline/jobfit/models.py` |
| Weight proposal (LLM, bounded) | `pipeline/jobfit/weight_proposal.py` |
| Reasoning generation | `pipeline/jobfit/match_reasoning.py` |
| Graduate-friendliness / entry gate | `pipeline/jobfit/jobs.py` |
| Observed-evidence minting | `pipeline/jobfit/live_case.py` |
| Candidate pool (TS, no-provenance path) | `app/_lib/candidate-pool.ts` |
| Group evaluation + fairness matrix wiring | `app/_lib/group-eval.ts`, `group-eval-run.ts`, `group-eval-cohort.ts`, `group-eval-differentiators.ts`, `group-eval-governance.ts`, `group-eval-separation.ts` |
| Fit matrix UI (grid + candidate focus) | `app/features/insights/matrix/*`, `app/features/insights/matrix/focus/*` |
| Match reasoning hook | `app/features/insights/matrix/focus/useMatchCardReasoning.ts` |
| Comparison / distribution / adverse-impact | `app/_lib/comparison.ts`, `app/_lib/distribution.ts`, `app/_lib/adverse-impact.ts`, `app/_lib/fit-thresholds.ts`, `app/_lib/factor-points.ts` |
| Role taxonomy schemas (TS) | `app/_lib/role-families.ts`, `app/_lib/taxonomy.generated.ts` |

### The fit band is one scale, single-sourced on BOTH sides
`fit_tier_for` (`matching.py`) bands a total into strong / promising / partial at
`FIT_STRONG_THRESHOLD` 70 and `FIT_PROMISING_THRESHOLD` 55, and the tier rides on
`MatchResult` so the UI bands exactly the way the server did. On the TS side
`app/_lib/fit-thresholds.ts` carries the same two numbers — `FIT_STRONG_FLOOR` and
`FIT_PROMISING_FLOOR` — and every consumer derives from it: the rediscovery
admission gate (`rediscover.ts::SCORE_FLOOR`), the Candidates "Pool fit" filter,
the group-eval `low_fit` risk, and `Badge.tsx::scoreToFitTier`, the fallback that
bands a bare numeric score on surfaces with no server-emitted `fitTier`. That last
one used to re-hardcode both literals, so tuning the shared floor would have moved
every gate and left the badge the recruiter reads on the old scale. Pinned by
`app/_lib/fit-thresholds.test.ts`. The TS↔Python pairing itself stays hand-kept —
one number on each side of the boundary, and both sides say so.

## Data model

- `pipeline_entries.match_score` — a **snapshot** at score time, not
  recomputed live; a scoring-model change (like the rebaseline above) makes
  cross-boundary cohorts non-comparable until re-scored.
- `analyses.score` — same snapshot caveat applies to any trend line drawn
  across a scoring-model change.
- `data/taxonomy.json` — 12 top-level role families' worth of skill/seniority
  vocabulary (see coverage table below); regenerated report, not hand-edited.

## Taxonomy coverage (generated, verified current)

`data/taxonomy.json` covers 16 role families / 676 total terms. The
authoritative, machine-regenerated coverage table stays at
**`docs/TAXONOMY_COVERAGE.md`** (root, not moved) — `pipeline/jobfit/taxonomy_check.py`
hardcodes that path and `test_taxonomy_coverage_gate.py` fails CI if the file
drifts from a fresh regen, so it cannot be relocated without touching the
generator. Regenerate with `python -m pipeline.jobfit.taxonomy_check
--write-report` (also `npm run taxonomy:report`) — running it while writing
this doc reproduced the table below byte-for-byte, confirming both copies are
current:

| Role family | Skill terms (floor) | Bilingual parity |
|---|---:|---:|
| `software_engineering` | 83 | 100% (36 exempt) |
| `data_ai` | 38 | 100% (17 exempt) |
| `product_project` | 28 | 100% (4 exempt) |
| `healthcare_clinical` | 44 | 100% |
| `life_sciences_research` | 38 | 100% |
| `skilled_trades` | 40 | 100% |
| `operations_logistics` | 40 | 100% |
| `frontline_service` | 33 | 100% |
| `sales_marketing` | 39 | 100% |
| `finance_accounting` | 54 | 100% |
| `legal_compliance` | 46 | 100% (1 exempt) |
| `hr_people` | 48 | 100% |
| `education_academic` | 37 | 100% |
| `creative_design` | 41 | 100% (5 exempt) |
| `customer_support` | 37 | 100% |
| `general_professional` | 29 | 100% |

"Bilingual parity" credits terms with ≥2 surface forms plus terms explicitly
flagged `bilingual_exempt` (proper nouns/tools identical in Czech and English —
python, docker, kubernetes — flagged per-term, never inferred). Regression
floors are enforced by `pipeline/jobfit/tests/test_taxonomy_coverage_gate.py`.
Note the family list itself is broad (healthcare, legal, trades, education,
etc.) — the taxonomy vocabulary is not narrowly tech-only — but compensation
figures elsewhere in the pipeline are CZK-denominated by default
(`pipeline/jobfit/market_config.py`); multi-currency support exists at the
market-config layer (`automation.py` stamps offers in the *active* market's
currency) but is not exercised by a second seeded market today.

### Anchor bands: what `role_band` actually serves

`taxonomy.role_band(family, seniority, market=…)` reads
`data/salary_benchmarks.json::markets[<market_id>].roles`, **not** a live feed.
The `cz` block is hand-authored, re-levelled toward the MPSV/ISPV *rok 2025*
earnings survey by `npm run market:build && npm run market:apply`, and carries
its provenance per role (`source`, `factor`, `ispv_median`, `sample_k`) plus a
block-level `generated_at` copied from the pulse snapshot it was calibrated
against. It is a periodically-regenerated snapshot: treat it as a calibrated
anchor, never as today's live market. The `de-berlin` block is an explicitly
labelled non-production sample (each band = the CZ band ÷ 25) that exists to
prove the market seam.

Consumers must ask the SAME market for the numbers and for the label. The band
is a bare `(low, high)` with no currency of its own, so a lookup against one
market's block stamped with another market's currency is a ~25× error, not a
rounding one — `market_salary_cli._fallback` threads its `market` through to
`role_band` for exactly this reason (pinned by
`tests/test_market_config.py::MarketSeamStragglersTest`). The CLI's deterministic
fallback is labelled honestly (`confidence: "low"`, `source: "deterministic"`,
and a summary naming the internal table) and localizes its summary for `en`/`cs`,
degrading to English for the other app locales rather than failing.

## Known gaps

- Salary anchoring for CV analysis still uses the matched job's band rather
  than a candidate-seniority band when the two diverge — tracked in
  `docs/features/candidates/README.md`.
- The scoring-model rebaseline (self_declared default) has not yet been
  re-tuned against production `maxMatchToReject`/fit-tier thresholds — do this
  before the next screening wave over real (not eval-corpus) data.
- `potential_score`'s 35/25/25/15 weighting is deterministic and explainable
  but unvalidated against outcomes; per-scorecard telemetry
  (`interview-telemetry.ts`) and per-submission process traces are captured
  precisely so this can be validated once outcomes accumulate — it is not
  validated yet, and does not gate anything alone in the meantime.
- Student/switcher end-to-end mechanics (observed-evidence minting from a
  live case or case-grounded interview, the dev-case module itself) are only
  summarized here; the devcase/interview build is owned by other feature docs
  (developer assessment / voice interview).

## doc-map

```json
{ "doc": "docs/features/matching/README.md",
  "sourceGlobs": [
    "pipeline/jobfit/taxonomy.py", "pipeline/jobfit/matching.py",
    "pipeline/jobfit/transform.py", "pipeline/jobfit/weight_proposal.py",
    "pipeline/jobfit/match_reasoning.py", "pipeline/jobfit/jobs.py",
    "pipeline/jobfit/live_case.py", "pipeline/jobfit/models.py",
    "data/taxonomy.json", "pipeline/jobfit/taxonomy_check.py",
    "app/_lib/candidate-pool.ts", "app/_lib/group-eval*.ts",
    "app/features/insights/matrix/**",
    "app/features/library/jobs/JobsRecruiterCandidatesCard.tsx",
    "app/features/library/jobs/JobsCompareInterviews*.tsx",
    "app/features/insights/about/scenes/archetypes/**"
  ] }
```
