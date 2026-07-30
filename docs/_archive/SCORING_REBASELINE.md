# Scoring rebaseline — unevidenced claims are no longer credited as professional

> **Archived 2026-07-30.** Dated change record (2026-07-20). The shipped
> behavior it describes (default provenance = `self_declared`, not
> `professional`) is folded into `docs/features/matching/README.md` §2. Kept
> here for the full UAT-driven investigation and the re-tuning checklist for
> production deploys.

**Date:** 2026-07-20 · **Driver:** UAT run `uat/runs/2026-07-20-cases-scoring`
(RECON-02/03, `cs-jana-02`, `CS-L1-06`, `LUC-GEF-L1-05`)

## What changed

Two lines, three routes closed:

| File | Before | After |
|---|---|---|
| `pipeline/jobfit/taxonomy.py` | `DEFAULT_PROVENANCE = "professional"` | `= "self_declared"` |
| `pipeline/jobfit/transform.py` | `"self_declared" if is_early else "professional"` | `"self_declared"` |

The third route — `app/_lib/candidate-pool.ts` emitting no provenance at all —
inherits `DEFAULT_PROVENANCE`, so it is closed by the same change. That is why no
single call-site edit would have worked.

## Why

A skill with **nothing recorded** about how it was acquired was credited at
`professional` (weight 1.0) — the joint-highest trust tier, level with a skill
demonstrated for five years in production. Absence of evidence was read as the
strongest possible evidence.

Worse, the discount that did exist fell **only on early-career candidates**
(`transform.py`), so the same unevidenced claim was penalised for the person least
able to evidence it and waived for the person the market already advantages.

The UAT's headline question was whether the product selects the best candidate or
the best-presenting one. This was the single largest mechanical contributor to the
latter: it is what let a well-written CV outrank a plainly-written one carrying
real artifacts.

## Mechanics — what actually moves

`skill_match_score()` multiplies the taxonomy match by the provenance weight.
`professional` = 1.0, `self_declared` = 0.4. `_MATCH_THRESHOLD` = 0.5.

So for a skill with no recorded provenance:

- A bare exact claim scores **0.4, not 1.0**.
- 0.4 < 0.5, so it lands in **`unproven_skills`**, not `matched_skills`.
- It still contributes `0.4 × weight` to the skills sub-score — it is discounted,
  not discarded.
- It **never** becomes `missing`. That stays reserved for a claim the candidate
  never made, so **knockout filtering is unaffected** (`ko_filter` gates on
  seniority and languages, not on skill match).

Skills carry 0.50 of the BAU total, so a candidate whose skills are *entirely*
unevidenced loses up to ~30 points. A candidate with real recorded provenance
(`professional`, `observed`, `open_source`, …) is **completely unaffected** —
recorded provenance always overrides the default, per skill.

## Measured impact

Against the eval corpus, **no degradation and no re-baselining were required**:

| Gate | Before | After |
|---|---|---|
| `matching_eval` checks | 8/8 PASS | 8/8 PASS |
| Fairness probes | 4/4 PASS | 4/4 PASS |
| archetype accuracy | 100% | 100% |
| role@5 | 100% | 100% |
| scenario tops | 65 · 52 · 57 · 52 | **65 · 52 · 57 · 52** (identical) |
| python suite | 1159 OK | 1159 OK |

Scenario scores are byte-identical because eval-corpus profiles carry **real
recorded provenance** — the default barely applies to them. That is the change
behaving exactly as designed: it bites only where nothing was ever evidenced.

### The one apparent regression, and why it was not one

`language_neutrality` failed on the first run. It was not a language regression:
the probe asserted `skill_match_score("strojové učení", "machine learning") == 1.0`
using the **default** provenance parameter, so it was implicitly measuring the
evidence discount rather than taxonomy resolution. Czech and English are still
scored identically (both 0.4). The probe now passes provenance explicitly.

The same coupling explained 22 of the 27 initially-failing unit tests: they were
about taxonomy/sibling/graph credit and merely relied on the default to reach full
credit. All were fixed by making provenance **explicit**, never by weakening an
assertion.

## What still needs tuning — read this before deploying

The eval corpus is curated and well-provenanced. **Production data is not.**

`gemini.py` emits a `skill_claims` array carrying per-skill provenance, but when
the model **omits** it, every skill falls to the default (finding `CS-L1-06`).
Before this change those skills were silently promoted to `professional`; now they
are honestly discounted. On a corpus where `skill_claims` is frequently missing,
**totals will drop materially and broadly.**

Consequences to check against real data:

1. **`maxMatchToReject` / family floors.** Calibrated against inflated numbers. A
   floor of 45 against pre-change scores is a much harsher filter against
   post-change ones. **Re-tune before the next screening wave**, or the wave will
   auto-reject far more people than intended.
2. **Fit tiers** (`strong` / `promising` / `partial`) shift down.
3. **`advance-top-N`** and any saved score-based filters.
4. **Mixed-vintage cohorts.** `pipeline_entries.match_score` is a *snapshot*.
   Entries scored before this change and after it are **not comparable**, and the
   screening wave ranks them against each other. Consider a re-score sweep
   (`automation-pass.ts::scoreUnscoredEntries` is fill-only, so it will **not**
   refresh existing snapshots) before running a wave over a mixed cohort.
5. **Calibration history.** Pre- and post-change scores sit in the same
   `analyses.score` column; any trend across the boundary is an artefact.

## The better fix this makes visible

The honest end state is not "discount everything unrecorded" — it is **record
provenance properly**, so real evidence earns real credit:

- Make `skill_claims` mandatory in the extraction contract, or infer provenance
  from the CV's own work history rather than defaulting.
- Wire the GitHub deep-dive into the scorer (UAT backlog #6) so `open_source`
  (0.85) is minted from actual repository evidence.
- Ungate `observed` (backlog #5) so a live case or interview can mint the
  highest-trust tier for experienced candidates, not just juniors.

Until those land, this default is the fail-safe direction: understate an
unevidenced claim rather than flatter it.
