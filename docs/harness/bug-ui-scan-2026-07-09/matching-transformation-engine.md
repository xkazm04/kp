# Matching & Transformation Engine — bug-hunter + ui-perfectionist scan

> Context: The deterministic scoring core — taxonomy, archetypes, skill transformation/transferability, candidate↔job matching, reasoning prep, recruiter scoring, insights and winnability.
> Files reviewed: 16 of 20
> Total: 5

## 1. A phantom `work_mode` default hard-KOs remote-only candidates out of every ad that never stated a work mode

- **Severity**: High
- **Lens**: bug-hunter
- **Category**: validation-gap / silent-failure
- **File**: `pipeline/jobfit/matching.py:284-286` (gate), `pipeline/jobfit/jobs.py:317-319,382` (phantom source)
- **Scenario**: A recruiter ingests/drafts a JD that states no work mode. `normalize_job` stamps `work_mode = "onsite"` (DEFAULT_POLICY) and records `"work_mode"` in `Job.defaulted_fields` (test_jobs.py:64 pins `["work_mode", "seniority", "salary_band"]` for a blank ad). A candidate on the `/api/match` inline path with `preferred_work_modes = ["remote", "hybrid"]` (exactly the tested case, test_matching.py:102) is then hard-KO'd: `if job.work_mode not in candidate.preferred_work_modes` fires on the phantom `"onsite"`.
- **Root cause**: `ko_filter` is the one consumer that turns a *phantom* field into a **hard gate**. `campaign.py:91-114` and `jobs.py`'s whole `defaulted_fields` machinery establish the contract that an assumed value must be treated as *absent, never asserted* — the salary coach (prior #7) was already flagged for the same omission. `ko_filter` never consults `job.defaulted_fields`, so an assumption the ad never made silently removes candidates from the survivor pool before they are ever scored.
- **Impact**: Silently wrong eligibility — a remote-only candidate is filtered out of every blind/onsite-defaulted role and shown a KO reason ("work mode onsite not preferred") for pay/mode the ad never stated. Changes who is even considered.
- **Fix sketch**: Gate only on a *stated* work mode: `if candidate.preferred_work_modes and job.work_mode and "work_mode" not in job.defaulted_fields`. Generalize by threading `defaulted_fields` into `ko_filter` so no phantom can ever become a hard gate (same rule the coach/campaign already apply).

## 2. [STILL-OPEN] `score_personal` saturates skill overlap at 5 hits and hands empty-language roles a free 0.5 — a 5-keyword CV ties a 50-keyword one

- **Severity**: High
- **Lens**: bug-hunter
- **Category**: scoring-math / normalization
- **File**: `pipeline/jobfit/matching.py:387` (`overlap = min(1.0, hits / 5.0)`), `:393` (`if not job.languages: return 1.0`), `:388` (blend)
- **Scenario**: Two candidates apply to a remote/no-language role. `_language_coverage` returns `1.0` (empty `job.languages`), and both a candidate sharing 5 skill tokens with the ad and one sharing 25 hit `overlap = 1.0`, so both land `personal = 0.5*1.0 + 0.5*1.0 = 1.0`. Still verbatim on `main` — the `/5.0` constant carries its own "known coarse heuristic, left as-is" comment (lines 383-386).
- **Root cause**: The `/5.0` saturation denominator is tied to neither the ad's keyword surface nor the must-have count, so any focused ad with ≥5 shared tokens maxes out; combined with the `lang_cov = 1.0` shortcut, `personal` collapses to a near-constant for whole classes of roles. Still matters because `personal` is 15-25% of the headline and this flattens exactly where the dimension should separate candidates.
- **Impact**: Silently wrong, reproducible mis-ranking: weak candidates are inflated toward the strong tier and equal-personal ties are decided by the other dimensions alone. High because it distorts the headline `total` on a common role shape.
- **Fix sketch**: Normalize `hits` against the ad's real keyword surface (`hits / max(k, len(capped jd tokens))`) or the must-have count; treat empty `job.languages` as "not a signal" (weight `overlap` fully) instead of a free 0.5. Re-pin the sanity suite after.

## 3. `score_skills` files a named-but-discounted must-have as `missing`, so a self-declared exact match reads identically to a skill the candidate never lists

- **Severity**: High
- **Lens**: bug-hunter
- **Category**: silent-failure / edge-case
- **File**: `pipeline/jobfit/matching.py:309-313`, cross-ref `:583-585` (confidence driver), `taxonomy.py:214-236` (provenance weights)
- **Scenario**: An early-career candidate (from `transform.build_match_candidate`, `provenance_default = "self_declared"`, weight 0.4) lists exactly the role's must-have, e.g. "Python", but only self-declared. `skill_match_score` = `1.0 * 0.4 = 0.4 < _MATCH_THRESHOLD (0.5)`, so the `if best >= 0.5` branch is skipped and the `elif req.kind == "must_have"` branch pushes the skill into `missing`. The candidate who *named* Python is reported the same as one who never mentioned it. (coursework 0.5 exact would pass; self_declared 0.4 never can.)
- **Root cause**: `missing` conflates two different states — "scored below the partial-match threshold" and "candidate does not claim it." The low skills sub-score (0.4) is the *intended* provenance discount, but routing the skill to `missing` overstates absence.
- **Impact**: Silently wrong recruiter-facing output for the fairness-protected cohort: `missing_skills` ("missing must-have: Python" for a student who listed it), `missingMustHaves` fed to the weight proposal, winnability's `base_missing`, and the `_confidence` "Misses N must-have skills" driver that *widens the score band*. The headline discount is fair; the "absent" verdict and the widened band are not.
- **Fix sketch**: Add a third bucket (e.g. `unproven`/partial) for `0 < best < _MATCH_THRESHOLD` and keep `missing` for `best == 0.0`; surface unproven-but-claimed skills distinctly and exclude them from the "misses N must-haves" confidence penalty.

## 4. Group-compare "covers the most required skills" divides matched (incl. nice-to-haves) by a denominator that only counts must-haves

- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: edge-case / scoring-math
- **File**: `pipeline/jobfit/group_compare.py:98-106`
- **Scenario**: `coverage(c)` returns `(len(matchedSkills), len(matchedSkills) + len(missingSkills))`. `matched_skills` (from `score_skills`) includes every requirement scoring ≥0.5 — **must AND nice-to-have** — while `missing_skills` is must-have-only. A candidate matching 2 musts + 3 nice-to-haves with 1 must missing yields `5/6`, presented to the hiring manager as "covers the most required skills (**5/6**)" though the role has only 3 must-haves.
- **Root cause**: The fraction mixes two populations — a numerator counting nice-to-haves and a denominator that excludes them — so both the ratio and its "required" label are wrong. The `best_cov = max(cands, key=coverage[0])` winner can also flip to whoever happens to match the most *nice-to-haves*.
- **Impact**: Misleading head-to-head shown to hiring managers (deterministic fallback path of the Decisions group evaluation); can nominate the wrong "most-covered" candidate. Medium — decision-support, not the headline score.
- **Fix sketch**: Compute coverage over must-haves only: numerator = matched must-haves, denominator = total must-haves (`len(matched_musts)` / `len(matched_musts) + len(missing_skills)`), or pass explicit must-have counts from `score_skills` so nice-to-haves never enter the ratio.

## 5. `normalize_job` discards a single-sided stated pay range and stamps the market anchor as a phantom instead

- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: edge-case / silent-failure
- **File**: `pipeline/jobfit/jobs.py:338-351`
- **Scenario**: A CZ ad states "od 60 000 Kč" ("from 60k") — very common — so the extractor returns `salary_min = 60000`, `salary_max = null`. The guard `if salary_min is not None and salary_max is not None` is false, so `stated_band = None`; the code then falls to `role_band(...)` and records `"salary_band"` in `defaulted_fields`. The recruiter's real stated floor is silently dropped and replaced by the taxonomy anchor, now labelled "assumed."
- **Root cause**: The stated-band path demands *both* ends, with no handling for a one-sided range, so a genuinely stated bound is treated as "no pay stated" rather than a partial fact.
- **Impact**: A stated pay signal is lost from every downstream surface that reads `salary_band` + `defaulted_fields` — winnability's below-market check runs against the anchor (compounding prior #7), and campaign copy fires `no_salary` despite the ad naming a floor. Medium: no crash, but a real, common recruiter input is silently replaced.
- **Fix sketch**: Form a one-sided band explicitly (e.g. `normalize_band(salary_min, salary_min)` for a floor, or carry min/max independently) and DON'T mark `salary_band` defaulted when the ad stated at least one bound; label the missing end rather than discarding the stated one.
