# Matching & Transformation Engine — Bug Hunter scan

> Context: The deterministic scoring core — taxonomy, archetypes, skill transformation/transferability, candidate↔job matching, reasoning prep, recruiter scoring, insights and winnability.
> Files reviewed: 13 of 20
> Total: 7 findings — Critical: 1, High: 3, Medium: 2, Low: 1

## 1. Archetype weight vectors are trusted to sum to 1.0 but never validated — a bad edit silently rescales every score

- **Severity**: Critical
- **Category**: silent-failure / scoring-math
- **File**: `pipeline/jobfit/matching.py:608` (consumer), `pipeline/jobfit/registry.py:66-67` (`weights_map`), `pipeline/jobfit/archetypes.json:12,28,45` (source)
- **Scenario**: Someone adds or edits an archetype in `archetypes.json` (the documented "add an archetype is a data change" path) and the three weights sum to, say, 0.9 or 1.1 — a one-digit typo. `weights_map()` loads them verbatim; `score_job` computes `total = 100 * (w["skills"]*skills + w["career"]*career + w["personal"]*personal)`.
- **Root cause**: The headline-score formula is a weighted average that is only an average if the weights sum to 1. Nothing — not `weights_map`, not `weights_for`, not `score_job`, not `build_score_breakdown` — asserts `sum(weights.values()) == 1.0`. The comment at line 49 ("must sum to 1.0") states the invariant but it is enforced nowhere. `resolve_weights` renormalizes *proposals* but returns the baseline `dict(base)` untouched when no proposal is passed (line 488), which is the default path.
- **Impact**: Every match score, fit-tier band, confidence band, matrix cell and winnability count for that archetype silently shifts (e.g. weights summing to 0.9 deflate every total by ~10%, pushing "promising" candidates below the 55 cutoff and dropping them from shortlists). No error, no warning — the corruption is invisible because each individual score still looks plausible (0-100). `total` clamps to [0,100] so an over-1.0 sum just saturates the dial. Tests pin specific golden scores but won't catch a *new* archetype's bad weights.
- **Fix sketch**: At import in `registry.weights_map()` (or a startup check in `matching.py`), assert `abs(sum(w.values()) - 1.0) < 1e-6` for every archetype and that keys are exactly `{skills,career,personal}`; raise a `RuntimeError` naming the offending archetype — the same fail-fast pattern `taxonomy.py` already uses for malformed terms/roles.

## 2. `potential_score` rides the early-career `career` slot but is clamped only at the Pydantic boundary, not in `score_job`

- **Severity**: High
- **Category**: edge-case / trust-boundary
- **File**: `pipeline/jobfit/matching.py:596` (`career = candidate.potential_score …`), `:115-131` (validator)
- **Scenario**: A `MatchCandidate` is constructed by any path that mutates `potential_score` after validation, or by `build_match_candidate` whose `compute_potential` is trusted to return [0,1] but is not itself clamped (`transform.py:102` rounds a weighted sum but if any input term exceeds 1 the result can too). The validator only fires on construction/assignment of that one field via Pydantic; a direct attribute set (`cand.potential_score = 1.4`) bypasses it.
- **Root cause**: The 0-1 contract for the early-career `career` dimension is enforced at one boundary (the field validator) but the *consumer* (`score_job`) re-reads the raw value and feeds it straight into the weighted sum, trusting upstream. The headline `total` has a `max(0,min(100,…))` clamp (line 608) that masks the overflow, but the per-dimension `career_score` returned on `MatchResult` and charted by `build_score_breakdown` (`percent=round(100*scores["career"])`) is NOT clamped — a 1.4 potential renders a 140% career bar.
- **Impact**: `score_breakdown` contributions no longer sum to `total`, the career bar overflows its track, and the "contributions sum to total" invariant documented at line 429 breaks. Misleads recruiters comparing dimension bars.
- **Fix sketch**: Clamp at the point of use: `career = min(1.0, max(0.0, candidate.potential_score)) if candidate.potential_score is not None else score_career(...)`. Equivalently clamp the return of `compute_potential`. Defense-in-depth, matching the headline clamp's stated intent.

## 3. `score_personal` saturates skill-overlap at 5 hits with no language data, making a 5-keyword CV indistinguishable from a 50-keyword one

- **Severity**: High
- **Category**: scoring-math / normalization
- **File**: `pipeline/jobfit/matching.py:378` (`overlap = min(1.0, hits / 5.0)`), `:379`
- **Scenario**: Two candidates apply to a remote/no-language-requirement role. Candidate A's CV shares 5 skill tokens with the ad; Candidate B shares 25. With `job.languages` empty, `_language_coverage` returns 1.0 (line 383), so `personal = 0.5*1.0 + 0.5*min(1.0, hits/5)` — both A and B hit `overlap = 1.0` and get identical `personal = 1.0`.
- **Root cause**: The `/5.0` saturation denominator is a hard-coded coarse constant (acknowledged in the comment at lines 374-377 as a "known coarse heuristic" deferred from a prior fix). It is tied to neither the ad's keyword surface nor the must-have count, so it both saturates trivially (any focused ad with ≥5 shared tokens maxes out) and is non-comparable across ads of different keyword density. Combined with the empty-languages `lang_cov=1.0` shortcut, `personal` collapses to a near-constant for whole classes of roles.
- **Impact**: The `personal` dimension (15-25% of the headline depending on archetype) loses discriminating power exactly where it should separate candidates, flattening rankings and inflating weak candidates toward the strong tier. Deterministic-but-wrong: reproducible, plausible, and silently mis-ranks.
- **Fix sketch**: Normalize against the ad's actual keyword surface (e.g. `hits / max(k, len(jd_skill_tokens_capped))`) or against must-have count, and treat empty `job.languages` as "not a signal" (weight overlap fully) rather than awarding a free 0.5 from `lang_cov=1.0`. Re-pin the sanity suite after.

## 4. `score_motivation` silently drops aspiration tokens of ≤3 chars, zeroing a real dimension for short stated targets

- **Severity**: Medium
- **Category**: edge-case / silent-failure
- **File**: `pipeline/jobfit/matching.py:409-410`
- **Scenario**: An early-career candidate states aspirations like "AI", "BI", "QA", "UX", "ML", "Go dev" or "PM". `asp_tokens = [t for t in asp… if len(t) > 3]` discards every token ≤3 chars, so `aspiration_hit` falls to `0.0` even when the role title is literally "AI Engineer".
- **Root cause**: A blanket length>3 guard (the same blunt anti-substring heuristic that `score_personal` and `taxonomy._text_contains` already abandoned in favor of word-boundary matching) is still applied here. Because `aspiration_hit` is a binary 0/1 contributing 0.35 of `personal`, dropping it isn't a partial discount — it's a hard zero on a third of the early-career personal score.
- **Root cause (deeper)**: The matching here is `t in title` (substring), so the length guard was a workaround for substring false-positives; switching to word-boundary containment (already implemented as `_term_in_words`) would let short tokens match safely without the guard.
- **Impact**: Early-career candidates with short, accurate, in-demand aspirations are under-scored on motivation/fit vs peers who happen to use longer words — an unfair, archetype-specific penalty on exactly the protected (`fairnessProtected: true`) cohort.
- **Fix sketch**: Reuse `_term_in_words(token, _description_words(title))` for aspiration matching and drop the `len(t) > 3` filter, mirroring the fix already applied to `score_personal`.

## 5. `_has_language` alias bucket selection uses bidirectional substring match — a short required token can grab the wrong language bucket

- **Severity**: Medium
- **Category**: edge-case / matching-correctness
- **File**: `pipeline/jobfit/matching.py:234`
- **Scenario**: `bucket = next((aliases for key, aliases in _LANG_ALIASES.items() if key in req or req in key), …)`. The `req in key` direction means a short required value like `"en"` matches the `"english"` key (`"en" in "english"`), and the dict's iteration order decides ties. A required language abbreviation, or a noisy token like `"es"`/`"sk"` extracted from a JD, can either select an unintended bucket or, for `"cz"`, match nothing and fall through to literal `(req,)`.
- **Root cause**: Bucket selection conflates "is this the canonical name" with "is this a fragment of the canonical name" via a symmetric substring test on untrusted JD-derived language strings. The first matching key wins, so the result depends on `_LANG_ALIASES` declaration order, not on the best alias.
- **Impact**: A KO gate (hard filter) can be applied against the wrong language alias set, either incorrectly KO-ing an eligible candidate or incorrectly passing one — both corrupt the survivor pool that everything downstream ranks. KO failures are surfaced as recruiter-facing reasons, so a wrong-bucket match also produces a misleading "missing required language" clause.
- **Fix sketch**: Match only when `req` *equals* a known key or is *contained in the alias list*, not when `req` is a substring of a key. Anchor the lookup on full-word equality of the required language against each bucket's alias tuple.

## 6. `fairness_matrix` is O(N²) in `score_job` calls and re-tokenizes nothing per scheme — quietly quadratic on a real pool

- **Severity**: Low
- **Category**: performance / latent-failure
- **File**: `pipeline/jobfit/matching.py:651`
- **Scenario**: `matrix = [[score_job(c, job, weights=scheme).total for scheme in schemes] for c, _w in pairs]` runs `score_job` N×N times for an N-candidate pool. `score_job` re-invokes `score_skills` (which loops every candidate skill × every requirement, calling `skill_match_score` → `resolve_term` twice per pair) and `score_personal` for *every* (candidate, scheme) cell, even though the skills/career/personal sub-scores are independent of the weight vector and identical across all N schemes for a given candidate.
- **Root cause**: The weight vector only affects the final weighted sum, not the three dimension scores — yet the code recomputes all three dimensions N times per candidate instead of once. The design conflates "re-score under each scheme" (cheap: one dot-product) with "re-run the full scorer" (expensive).
- **Impact**: For the documented ~150-candidate recruiter pool a fairness run does ~22,500 full scorings instead of ~150; with the per-cell taxonomy resolution this is the heaviest path in the engine and will visibly stall the recruiter fairness view as pools grow.
- **Fix sketch**: Compute each candidate's `(skills, career, personal)` once, then fill the matrix with `round(100*(w["skills"]*s + w["career"]*c + w["personal"]*p))` per scheme — pure arithmetic, no re-scoring. Behavior-identical, ~N× faster.

## 7. `winnability` "below market" / `topVsMarketFloorPct` math assumes a stated band but reads a possibly-phantom anchor band

- **Severity**: Low
- **Category**: edge-case / scoring-math
- **File**: `pipeline/jobfit/winnability.py:104-116`, cross-ref `pipeline/jobfit/jobs.py:345-351`
- **Scenario**: A draft Job whose ad stated no pay gets `salary_band` stamped from the taxonomy market anchor (`normalize_job`, jobs.py:348) and recorded in `defaulted_fields`. `assess_winnability` then compares `job_band` against `role_band(family, seniority)` — i.e. it compares the anchor band against (often) the very same anchor band, computing `belowMarket=False` and `topVsMarketFloorPct≈0`, presenting an *assumed* band as if it were the recruiter's stated pay decision.
- **Root cause**: `winnability` reads `job.salary_band` without consulting `job.defaulted_fields`, so it cannot tell a band the recruiter actually set from the phantom anchor the pipeline stamped — the exact stated-vs-assumed distinction the rest of the system carefully preserves.
- **Impact**: The pre-publish coach gives a falsely reassuring "your pay matches market" (or a meaningless ~0% delta) for any draft that never stated pay, defeating the salary-vs-market lever for the common blind-draft case.
- **Fix sketch**: In the salary block, skip or label the comparison when `"salary_band" in job.defaulted_fields` (e.g. `salary["bandIsAssumed"] = True` and suppress `belowMarket`/`topVsMarketFloorPct`), so the coach only judges pay the recruiter actually set.
