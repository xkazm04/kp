# Candidate Profile & Job Matching — Ambiguity 🌀 + Business 🚀 scan
> Total: 5 | Lens: 🌀2 / 🚀3 | Severity: C1/H2/M2

## 1. Saved analyses (and inline candidates) without a v2 profile silently score as "bau" — losing early-career scoring AND the fairness shield
- **Lens**: 🌀 Ambiguity
- **Severity**: Critical
- **Category**: hidden assumption / silent unfair outcome
- **File**: app/_lib/match-candidate.ts:52
- **Observation**: `resolveCandidate` defaults `archetype: payload?.v2Profile?.archetype ?? "bau"`, and the inline-candidate branch (line 57) forwards the body verbatim with no archetype at all. `v2Profile.archetype` is explicitly "best-effort" and can be null (see `app/history/[slug]/page.tsx:73`, `candidate-pool.ts:27`). The Match tab lets a recruiter match by **savedAnalysis** as a first-class option (MatchTab.tsx:158-178). When such an analysis lacks a v2 profile, `MatchCandidate.archetype` becomes `"bau"` (matching.py:92) → it is NOT in `_EARLY_CAREER`, so the BAU **seniority KO floor** fires (matching.py:260) and the candidate is NOT `fairnessProtected` (archetypes.ts:66). The whole point of the fairness gate — "never auto-reject early-career" — is bypassed by a default.
- **Why it matters**: A student or career-switcher matched via the analysis/inline path is silently auto-filtered out of senior roles and stripped of the documented anti-bias guarantee, with no signal to the recruiter. That is exactly the "silent wrong/unfair hiring outcome" the fairness machinery exists to prevent, and a direct EU-AI-Act/discrimination exposure.
- **Recommendation**: When `v2Profile.archetype` is missing, run archetype detection on the analysis payload (the same `detect_archetype` the pipeline already has) instead of defaulting to `"bau"`; failing that, fail *closed* to a fairness-protected/early-career-neutral lens rather than the seniority-gated BAU lens. At minimum, surface a "no archetype detected — scored as Experienced" assumption chip so the default is visible.
- **Effort**: M

## 2. Core scoring blend weights and fit-tier cutoffs are unexplained magic numbers
- **Lens**: 🌀 Ambiguity
- **Severity**: High
- **Category**: magic numbers / undocumented constants
- **File**: pipeline/jobfit/matching.py:315
- **Observation**: The deterministic scorer — the authority every match surface renders (MatchTypes.ts:16-25 mirrors it) — is built on constants with no recorded rationale or calibration source: `score_career` blends `0.6*family + 0.4*seniority_proximity` with an off-family penalty of `0.35` (lines 311-315); `score_motivation` blends `0.4/0.35/0.25` with an off-family `0.3` (lines 401-413); `score_skills` weights nice-to-haves at `0.4` vs must-haves `1.0` (line 287); and the strong/promising cutoffs are `FIT_STRONG_THRESHOLD = 70` / `FIT_PROMISING_THRESHOLD = 55` (lines 69-70). Unlike `_MATCH_THRESHOLD` (lines 54-62, thoroughly justified) and the `/5.0` saturation (lines 377-379, flagged as a tracked tuning item), these carry no "why these values" note.
- **Why it matters**: These numbers decide candidate *ranking order* and the strong/promising/partial banding recruiters act on. A reviewer (or auditor) cannot tell whether `0.35` vs `0.30` off-family penalties are deliberate or copy-paste drift, nor whether 70/55 reflect any real fit/no-fit data. Tuning them is unsafe because no one can see what they were meant to encode.
- **Recommendation**: Add a short "calibration" docstring/section near these constants stating the intended meaning and the basis (data, heuristic, or arbitrary-pending-tuning), and unify the two off-family penalties (0.35 vs 0.3) or document why they differ. Ideally pin them with a golden-fixture test so a change is a conscious, reviewed act.
- **Effort**: S

## 3. Hitting the AI-candidate allowance silently degrades "Explain fit" to the rule-based template — no upsell, and the source chip hides the paywall
- **Lens**: 🚀 Business
- **Severity**: High
- **Category**: monetization / silent paywall
- **File**: app/_lib/reasoning-run.ts:63
- **Observation**: When `meterAllows("ai_candidates")` is false, the runner appends `--no-llm`, forcing the deterministic template (which is then left uncached). The UI renders only a neutral chip — `source === "llm" ? sourceLlm : sourceRuleBased` (MatchShared.tsx:73-76) — which is the *identical* presentation a provider outage produces (reasoning-run.ts:62 comment). So a recruiter who exhausts their paid AI allowance gets a generic verdict with zero indication that (a) it's degraded and (b) it's degraded because of billing.
- **Why it matters**: This is the single highest-intent monetization moment in the product — the recruiter wants the AI verdict *right now* on a specific candidate — and it is met with a silent downgrade instead of an "Upgrade to continue AI reasoning" prompt. Revenue left on the table, plus a quality-perception hit (users blame the AI, not their plan).
- **Recommendation**: Return a distinct `degraded: "quota"` flag from the runner when the meter blocks LLM, and have the card render an upgrade CTA (and keep the deterministic answer as a preview). Separate the "outage" and "quota" cases in the chip copy so the cause is honest.
- **Effort**: M

## 4. matched_skill_provenance is computed and shipped for every candidate but rendered only for early-career — experienced candidates' self-declared skills read as verified
- **Lens**: 🚀 Business
- **Severity**: Medium
- **Category**: dark capability / trust gap
- **File**: app/features/sub_match/MatchCard.tsx:182
- **Observation**: `score_job` populates `matched_skill_provenance` for *all* candidates (matching.py:635) and it rides the wire (MatchTypes.ts:53). But the card only renders the provenance badge for early-career: `const pl = early ? provLabel(...) : null` (MatchCard.tsx:182). For an Experienced (BAU) candidate, a matched skill that is merely `self_declared` is shown the same green chip as an `observed`/`professional` one. (The partial-strength `~` marker at line 187 is shown for all, but provenance is not.)
- **Why it matters**: A recruiter reading "matched: Kubernetes" on an experienced candidate cannot tell verified hands-on possession from a self-declared claim — exactly the over-trust the provenance system was built to prevent — and the data to fix it is already on the client. Surfacing it is a differentiation win (evidence-graded matching) at near-zero cost.
- **Recommendation**: Render the provenance badge (or at least a self-declared warning tone) for all archetypes, not just early-career; reuse the existing `provLabel` mapping.
- **Effort**: S

## 5. The paid AI reasoning (verdict / strengths / gaps / interview probes) is trapped in the card — excluded from the CSV export
- **Lens**: 🚀 Business
- **Severity**: Medium
- **Category**: value left on the table / export gap
- **File**: app/features/sub_match/Results.tsx:114
- **Observation**: `exportCsv` emits rank, role, company, score, confidence band, fit tier, matched/missing skills (lines 114-129) — but not the LLM rationale. The reasoning (verdict/strengths/gaps + **interviewProbes**) is the most differentiated, metered output, yet it's generated per-card on demand (MatchCard.tsx:58) and never flows into the export or any shareable artifact. JobCompare (MAT5) and CandidateMatrix likewise omit it.
- **Why it matters**: Hiring decisions and interviews happen in meetings, email, and ATS hand-offs *outside* the app (the comment at Results.tsx:111-113 says exactly this). The interview probes are the recruiter's next concrete step, and shipping the AI "why" with the ranking is a natural upsell anchor for the paid tier. Leaving it card-only erodes the value of the feature recruiters are paying for.
- **Recommendation**: Add an "Export ranking + AI reasoning" action that bulk-generates (or includes already-generated) reasoning per row and writes it into the CSV/PDF; at minimum append cached reasoning columns when present.
- **Effort**: M
