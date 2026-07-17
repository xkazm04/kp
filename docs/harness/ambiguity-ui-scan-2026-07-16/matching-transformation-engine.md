# Matching & Transformation Engine — ambiguity-guardian + ui-perfectionist scan

> Total: 5 findings (0 critical, 1 high, 3 medium, 1 low)

## 1. Live-case "observed" credit is minted from naive substring skill matching
- **Severity**: High
- **Lens**: ambiguity
- **Category**: false-positive-observed-credit
- **File**: `pipeline/jobfit/live_case.py:84`
- **Scenario**: A candidate clears the live-case bar (`transfer_score >= 65`, confidence above `LOW_CONFIDENCE`). `_credited_skills` then decides WHICH of the role's must-haves to grant `observed` provenance (taxonomy weight 1.0 — full match credit, and it narrows the early-career confidence band). It does so with bidirectional substring matching: `any(_norm(m) in t or t in _norm(m) for t in transfers)`. A short or generic must-have like `"R"`, `"C"`, or `"Go"` matches almost any transfer string — `"r"` is a substring of `"Strong framing"`, so the language "R" is credited as *observed* off a dimension label the candidate never demonstrated. On the deterministic transfer path the `transfers` are dimension labels ("Strong framing"), not skills, so this misfires routinely.
- **Root cause**: The whole-token discipline the taxonomy module enforces everywhere (`contains_whole_token`, the `_FALLBACK_MIN_TOKEN_LEN` short-token guard) is abandoned here for a raw `in` substring test on skill names.
- **Impact**: The engine's *highest-trust* signal is fabricated. A recruiter reads "observed: R" as a skill demonstrated first-hand in a work sample; it also tightens the score's confidence band and outranks self-declared evidence — directly contradicting the module's "honest by construction" contract.
- **Fix sketch**: Match must-haves against `transfers`/`gaps` on normalized whole tokens (reuse `taxonomy.contains_whole_token` or `skill_match_score >= _MATCH_THRESHOLD`), not `in`. At minimum apply the same `>= 3`-char / stopword guard `_fallback_tokens` uses so 1–2 char skill names cannot substring-match, and require the shared token to be distinctive.

## 2. Early-career motivation scoring keeps the short-token/substring bug that `score_personal` deliberately removed
- **Severity**: Medium
- **Lens**: ambiguity
- **Category**: inconsistent-heuristic
- **File**: `pipeline/jobfit/matching.py:574`
- **Scenario**: `score_personal` (BAU) was rewritten with a long comment explaining that the old `len > 3` token guard was "discriminatory" (it dropped Go/R/C/SQL/AI) and that matching must be whole-word, never substring (`_term_in_words`, so "Rust" no longer hits "trust"). The early-career twin `score_motivation` still does `[t for t in asp.split() if len(t) > 3]` and then `t in title` (a raw substring test). So a student aspiring to "AI"/"data"/"UX" work has those tokens dropped, and "art" spuriously matches "smart". This term carries 0.35 of the early-career `personal` dimension.
- **Root cause**: The fix applied to the BAU path was never mirrored onto the early-career path; the two divergent implementations of the same "does the candidate's stated interest meet the ad" idea were left in the same file.
- **Impact**: Early-career candidates — the fairness-protected cohort — get a systematically noisier motivation score than BAU candidates: short, legitimate aspirations are ignored and substring false-positives inflate others. It also silently contradicts the documented word-boundary rule two functions above it.
- **Fix sketch**: Reuse `_description_words` + `_term_in_words` against `title` (and optionally description) so aspiration matching is whole-word and short tokens survive, exactly as `score_personal` now does. Drop the `len > 3` filter.

## 3. `fairness_matrix` / `fairness_check` rank early-career and experienced candidates together, breaking the track-separation invariant
- **Severity**: Medium
- **Lens**: ambiguity
- **Category**: fairness-track-leak
- **File**: `pipeline/jobfit/recruiter.py:41`
- **Scenario**: `fairness_track`, `rank_candidates_by_track`, and the docstrings throughout insist early-career (whose `career` slot is POTENTIAL) and experienced (whose `career` slot is work-history fit) are "two incomparable 0-100 scales" that "must never be ranked against each other on one `total`". Yet `fairness_check` passes the *entire* candidate list straight into `fairness_matrix`, which scores every candidate under every candidate's weight scheme and returns a single flat `"ranking"` list — students and seniors interleaved on one mean. No track grouping happens anywhere in this path.
- **Root cause**: The track-separation guard was added to `rank_candidates_for_job`/`rank_candidates_by_track` but not to the parallel fairness-matrix path, which pre-dates it.
- **Impact**: Any consumer that renders `fairness_check`'s `ranking` (or `mean`) shows exactly the cross-track comparison the rest of the engine goes to great lengths to forbid — a student can be listed "below" a senior on one incomparable number, the specific fairness harm the design set out to prevent.
- **Fix sketch**: Either compute the fairness matrix per track (split `candidates` by `fairness_track` before `fairness_matrix`, returning grouped `ranking`s), or attach `track` to each row of the matrix and document that `ranking` is only valid within a track. Make the separation structural, mirroring `rank_candidates_by_track`.

## 4. Education KO gate: "university" ranked below "bachelor" and unknown levels silently fail-open
- **Severity**: Medium
- **Lens**: ambiguity
- **Category**: undocumented-ordinal
- **File**: `pipeline/jobfit/matching.py:43`
- **Scenario**: `_EDU_RANK = {"none": 0, "university": 1, "bachelor": 2, "master": 3, "phd": 4}`. In `ko_filter` (line 327) a candidate whose `education_level` is `"university"` (rank 1) applying to a `min_education: "bachelor"` (rank 2) role is hard-KO'd — removed from the pool before scoring. "University" is nowhere defined; a CV parsed as "university" could mean a completed university degree (which should satisfy a bachelor floor), yet it silently loses. Separately, any level outside the five keys (e.g. "vocational", "high_school") makes `_EDU_RANK.get(...)` return `None`, and the gate is skipped — a fail-open that is correct for genuine unknowns but indistinguishable from a typo/new taxonomy value.
- **Root cause**: The ordinal encodes an unstated semantic ("university" = generic/partial tertiary, weaker than a named degree) that is never documented at the gate, and the `None` branch conflates "no evidence" with "unrecognized token".
- **Impact**: Candidates can be wrongly KO'd (or wrongly admitted) on an education floor whose ordering no one can see is intentional; it also diverges from `compute_potential`'s foundation map where `university=0.5 < bachelor=0.7` — consistent, but only by coincidence and equally undocumented.
- **Fix sketch**: Document the intended meaning of "university" next to `_EDU_RANK` (and cite the parity with `compute_potential`). Consider distinguishing an unrecognized education token (log/flag) from a truly unknown one, so a new value fails loudly like the taxonomy loaders do rather than silently skipping the gate.

## 5. Reasoning grounding guard clobbers strengths that cite a real highlight instead of a skill token
- **Severity**: Low
- **Lens**: ambiguity
- **Category**: over-narrow-guard
- **File**: `pipeline/jobfit/match_reasoning.py:306`
- **Scenario**: `_coerce` post-checks the LLM's `strengths` with `_any_strength_grounded`, whose token set (`_real_cv_tokens`) is built ONLY from `candidate.skills` + `matched_skills`. A perfectly concrete, grounded strength that cites an `experienceHighlight`, a company/project name, or a `workLink` (which the prompt explicitly asks the model to cite) contains none of those skill tokens, so it reads as "ungrounded" and the *entire* strengths list is discarded and replaced by the deterministic template.
- **Root cause**: The grounding check's evidence vocabulary is narrower than the grounding the prompt actually requests — it only knows skill tokens, not the highlight/summary/workLink facts the model was told to use.
- **Impact**: Legitimately specific, human-written rationale is silently overwritten with generic template prose whenever the model grounded in a project/experience rather than a named skill — the opposite of the "cite a concrete candidate-specific detail" goal, and it fires most for non-tech roles whose "skills" tokens are sparse.
- **Fix sketch**: Extend `_real_cv_tokens` to also harvest tokens from `experienceHighlights`, `summary`, and `workLinks` in the context, so a strength grounded in any real supplied fact passes. Keep the lenient "one grounded strength is enough" rule.
