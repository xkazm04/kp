# Matching & Transformation Engine — Tri-Lens Scan
> Total: 5
> Severity: 1 Critical / 3 High / 1 Medium / 0 Low
> Lens: 4 bug / 0 ui / 1 biz

> 🎨 UI Perfectionist — **N/A** for this context. The Matching & Transformation Engine is a headless Python scoring core (`pipeline/jobfit/*.py`, `data/taxonomy.json`); it renders nothing. UI rendering lives in the TS app (`app/_lib/format.ts`, `FitTierBadge`, score dials) and is out of scope here. No UI findings are reported. 🐛 Bug Hunter and 🚀 Business Visionary dominate as instructed.

## 1. `score_personal` silently zeroes short-named real skills and saturates overlap at 5 hits
- **Lens**: 🐛 Bug Hunter
- **Severity**: Critical
- **Category**: Scoring fairness / systematic under-credit
- **Value**: impact 9/10 · effort 2/10 · risk 3/10
- **File**: `pipeline/jobfit/matching.py:358-360`
- **Scenario**: A backend candidate whose declared skills are `["Go", "C", "C++", "AI", "R", "SQL", "k8s"]` is scored against a Go/SQL ad. The personal/description-overlap term filters every token with `len(t) > 3`, so `Go`, `C`, `C++`, `AI`, `R`, and `SQL` (all ≤3 chars) are dropped before matching — the exact tokens the ad is built around. Separately, `overlap = min(1.0, hits / 5.0)` means a candidate with 4 real overlapping skills tops out at 0.8 and one with 2 at 0.4, regardless of how perfectly they match a focused 3-keyword ad. Both effects depress the `personal` dimension (15–25% of the headline) for whole skill families.
- **Root cause**: The `len(t) > 3` guard was a blunt fix for the old substring false-positives ("C in desc"); now that `_term_in_words` does whole-word matching (matching.py:317), the length guard is redundant *and* discriminatory against legitimately short skill names. The `/5.0` divisor is an arbitrary saturation constant unrelated to the candidate's or ad's actual keyword count.
- **Impact**: Languages/tools with short canonical names (Go, R, C, C#, C++, AI, ML, BI, QA, SQL) are invisible to the personal dimension across the entire SE/data corpus — a fairness leak that systematically penalizes exactly the candidates a Czech tech-market product must rank well. Saturation at 5 flattens score separation between a 5-hit and a 9-hit candidate.
- **Fix sketch**: Drop the `len(t) > 3` filter now that matching is word-boundary based (keep a `len >= 1` guard); for short tokens that are taxonomy terms, allow the compact form. Replace `hits / 5.0` with a denominator tied to the ad's keyword surface (e.g. `hits / max(3, distinct_jd_skill_tokens)`), so overlap reflects coverage rather than a magic constant.

## 2. Zero-requirement / all-nice-to-have jobs report no missing skills and can reach "promising"
- **Lens**: 🐛 Bug Hunter
- **Severity**: High
- **Category**: Degenerate input / score inflation
- **Value**: impact 7/10 · effort 3/10 · risk 3/10
- **File**: `pipeline/jobfit/matching.py:294-299, 528-558, 590`
- **Scenario**: An ad ingested with zero structured requirements (LLM returned an empty `requirements` list, or all requirements are `nice_to_have`) is scored. In `score_skills`, `missing` is appended to ONLY for `req.kind == "must_have"` (line 297), so `missing_skills` is empty; `_confidence` therefore never adds the "Misses N must-haves" widener (line 556). With zero requirements, `total_w == 0` → `score = 0.0`, but career + personal alone (BAU weights 0.35/0.15) can still push `total` to ~55 and band the role "promising" with a **tight** confidence band and an empty `missing_skills` — reading as a confident, well-covered match against a job with no evaluated skill bar.
- **Root cause**: Missing-skill detection and the confidence widener are gated on must-haves existing; there is no guard for "the skill dimension was computed over zero (or zero must-have) requirements", so an unmeasurable skills score is treated identically to a measured 0.
- **Impact**: Recruiters see falsely confident "promising" matches for under-specified ads (common with blind/agency postings the corpus explicitly supports). The honesty contract the module advertises (confidence band explains uncertainty) is defeated precisely where uncertainty is highest.
- **Fix sketch**: When `total_w == 0` (or no must-haves exist), add an explicit `Confidence` driver ("role lists no scored skill requirements") and widen the band; consider capping the tier at "partial" when the skills dimension had no requirements to score against, rather than letting career/personal alone manufacture a tier.

## 3. `fairness_matrix` ranks by mean over an asymmetric, self-favouring matrix
- **Lens**: 🐛 Bug Hunter
- **Severity**: High
- **Category**: Cross-candidate comparability / ranking bias
- **Value**: impact 7/10 · effort 4/10 · risk 4/10
- **File**: `pipeline/jobfit/matching.py:621-644`
- **Scenario**: Two candidates are compared. Candidate A's proposed scheme has bumped `skills` toward its ceiling (A is skill-strong); B's scheme leans on `career`. The matrix scores every candidate under every scheme and ranks by the row mean. But each candidate's own diagonal cell (`own[i]`) is scored under the scheme that was *proposed from that candidate's own evidence* — `propose_weights` shifts weight toward `skills` exactly when that candidate backs must-haves with high-trust evidence (matching.py:509). So a candidate's own scheme is systematically the most flattering to them, and it is included in their mean with equal weight to others'. With only 2–3 candidates (the common recruiter case) the diagonal dominates the mean, so "robust under everyone's weights" collapses back toward "flattered by your own."
- **Root cause**: The mean includes the self-scheme diagonal, and `mean = round(sum(row)/len(row))` rounds each candidate independently, so ties and near-ties (`50.4` vs `50.6`) flip ordering on rounding noise. `sorted(..., key=mean[i])` is stable, but the rounding makes the rank sensitive to sub-point differences the band itself calls insignificant.
- **Impact**: The feature sold as a fairness/comparability guarantee can still rank the candidate who proposed the most self-serving (but in-bounds) scheme first. Rounding-driven tie flips make rankings non-robust to trivial input changes.
- **Fix sketch**: Rank on the **off-diagonal** mean (exclude each candidate's own scheme) or on the min-across-schemes (true "robust under any yardstick"); rank on the un-rounded mean and only round for display; break exact ties deterministically by label.

## 4. Company salary multiplier applied to a market-ANCHOR band, double-counting the premium
- **Lens**: 🐛 Bug Hunter
- **Severity**: High
- **Category**: Salary-band correctness / phantom-data leak
- **Value**: impact 7/10 · effort 3/10 · risk 4/10
- **File**: `pipeline/jobfit/insights.py:67-78`; `pipeline/jobfit/jobs.py:345-351`
- **Scenario**: A candidate analysis derives a `SalaryEstimate`, then `apply_company_salary_context` scales it by up to ×1.20 when the company text classifies as a high-paying type (multinational, etc.). But the same role often carries a `salary_band` that was *stamped from the taxonomy market anchor* (jobs.py:348, recorded in `defaulted_fields`), and the anchor band already bakes in the market-typical premium for that family/seniority. When the estimate originated from (or is later reconciled against) the anchor, multiplying again applies the company premium on top of a band that already contains it — inflating the advertised range the candidate negotiates against.
- **Root cause**: `apply_company_salary_context` has no awareness of whether the salary it is scaling was a *stated* figure or a *defaulted anchor* (the `defaulted_fields`/"salary_band" phantom marker that the rest of the codebase carefully respects in campaign.py and jobs.py). It scales unconditionally as long as `salary.maximum > 0`.
- **Impact**: Salary numbers users negotiate against can be systematically high for anchored roles at premium-classified companies — the most consequential output to get wrong, and a credibility risk for the product's core promise of defensible comp guidance.
- **Fix sketch**: Thread the statedness signal (the `defaulted_fields`/anchor provenance already exists) into `apply_company_salary_context`; when the band is an anchor, either skip the multiplier or apply only the residual delta above the anchor's built-in premium, and say so in the rationale.

## 5. Detection treats "no signal" (confidence 0.40) and "weak signal" identically, eroding the manual-review safety net
- **Lens**: 🚀 Business Visionary
- **Severity**: Medium
- **Category**: Explainability / calibration / fairness governance
- **Value**: impact 6/10 · effort 4/10 · risk 3/10
- **File**: `pipeline/jobfit/registry.py:160-166`; `archetypes.json:60-64`
- **Scenario**: A candidate with one faint signal (e.g. only `education_is_dominant`, score 1.0) is routed with `confidence = round(scores[best]/total, 2) = 1.0` — a *perfect* confidence from a single weak vote, because the normalization divides by the (also-tiny) total. Meanwhile a genuinely unguided candidate falls to the `0.40` default and trips `lowConfidenceThreshold = 0.55` for human review. So the case with one flimsy signal looks MORE certain (1.0) than the honest no-signal default (0.40), and never reaches manual review — even though `fairnessProtected` archetypes (student/career_switcher) are the ones being routed.
- **Root cause**: Confidence is the *share* of total score the winner holds, not the *strength* of evidence behind it. A lone weak signal yields share 1.0; the normalization conflates "uncontested" with "well-evidenced."
- **Impact**: The differentiator KP sells — calibrated, explainable, bias-resistant routing with a human gate on uncertainty — misfires exactly for fairness-protected candidates: thinly-evidenced routings bypass review while looking maximally confident. Mis-routing a switcher as a student (or vice-versa) silently selects the wrong scoring weights and reasoning lens.
- **Fix sketch**: Make confidence reflect absolute evidence mass, not just share — e.g. `share * saturating(total / expected_decisive_mass)` so a single weak signal lands well under `0.55` and reaches review; keep contradictions lowering it. Add a "thin evidence" driver to the routing reasons so the recruiter sees why a low-confidence route was flagged.
