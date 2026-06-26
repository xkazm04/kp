# CV Extraction & Pipeline Services — Ambiguity 🌀 + Business 🚀 scan
> Total: 5 | Lens: 🌀3 / 🚀2 | Severity: C1/H2/M2/L0

## 1. Credential gate & expiry are LLM-narrated only — no deterministic check for regulated roles
- **Lens**: 🚀 Business
- **Severity**: Critical
- **Category**: trust layer / regulated-hiring correctness
- **File**: pipeline/jobfit/gemini.py:470 (and :471, pipeline.py:403-409)
- **Observation**: The schema captures a structured `credentials[].expiry` (gemini.py:77) and `pipeline._credentials_from_payload` faithfully stores it (pipeline.py:407), but nothing ever *evaluates* it. The entire "CREDENTIAL GATE" — "a required-but-expired credential is the same risk … treat it as a BLOCKING gap" (gemini.py:471) — is delegated 100% to the LLM's free-text `recruiter_risk_flags`. By contrast, `authenticity.py` runs a deterministic safety net; credentials have none. The deterministic `soft_signals.py` detectors never read `profile.credentials` at all.
- **Why it matters**: For a regulated hire (RN, Series 7, OSHA card, PE, CPA, bar admission) an expired or missing licence is a hard, legally-consequential blocker. Relying solely on a non-deterministic Gemini generation to remember to flag it means a single missed flag = a silent wrong hiring outcome with compliance exposure — exactly the "trust layer" kp competes on. The `expiry` string is already parsed; comparing it to today is cheap.
- **Recommendation**: Add a deterministic credential check (mirroring `authenticity_checks`): when a JD names a required licence/cert absent from `credentials`, OR a captured `expiry` parses to a past date, emit a `Credential: …(manual review)` sanity-check folded into the trust ledger — independent of whether the LLM flagged it.
- **Effort**: M

## 2. Grounded salary is hard-pinned to "Prague/Czech tech," contradicting the multi-market salary design
- **Lens**: 🌀 Ambiguity
- **Severity**: High
- **Category**: internal contradiction / wrong market context
- **File**: pipeline/jobfit/gemini.py:407
- **Observation**: When `use_grounding=True`, the prompt injects: *"Use grounded web results to fill market_evidence with current Prague/Czech tech salary signals."* This directly contradicts the elaborate multi-market block immediately below it (gemini.py:463-464), which insists salary be estimated "in the candidate's/role's OWN market and currency … do NOT convert to CZK" and explicitly supports nurses, tradespeople, accountants in USD/EUR/INR/etc. The grounded web search is steered to Czech tech salaries for *every* candidate.
- **Why it matters**: A US nurse or an Indian engineer analyzed with grounding ON gets their `market_evidence` (and the salary anchor narrative) grounded against Prague tech pay — silently wrong comp context the recruiter negotiates against. It's a one-line legacy string the rest of the file already outgrew; the inconsistency is undocumented tribal drift.
- **Recommendation**: Make the grounding line market-neutral — e.g. "Use grounded web results for current salary signals in the candidate's inferred market and role family (the same market you set in salary.currency/period)." Drop the hard-coded Prague/Czech/tech wording.
- **Effort**: S

## 3. `panel_to_probe_briefs` → devcase probe bridge is built + tested but never wired in production
- **Lens**: 🚀 Business
- **Category**: dark capability / value left on the table
- **Severity**: High
- **File**: pipeline/jobfit/soft_signals.py:265
- **Observation**: `panel_to_probe_briefs` converts CV soft-signal antipatterns into `{kind, focus, rationale}` briefs "consumed by `design_case(focus_probes=…)`" (soft_signals.py:296) — the documented "Rec B" loop that turns a CV hypothesis (overclaim, vague delivery) into a targeted work-sample probe. But the only callers are tests (`tests/test_soft_signals.py:117,123`). The production `design_case` invocations (`devcase/devcase_cli.py:127`, `devcase/lifecycle_eval.py:114`) pass **no** `focus_probes`. The soft-signal panel is now rendered in the UI, but the CV→devcase automation that justified it stays dormant.
- **Why it matters**: This is the differentiating capability — "we don't just flag a risk, we auto-design the work-sample task that confirms it." It's fully built and tested yet delivers zero value because one wiring call is missing. kp has a documented history of exactly this "built-but-unwired" pattern.
- **Recommendation**: In the devcase design path, when an `AnalysisResult.soft_signals` panel exists, call `panel_to_probe_briefs(panel)` and pass the result as `design_case(focus_probes=…)`. Surface "probes derived from CV antipatterns" in the devcase brief.
- **Effort**: M

## 4. Tenure-instability "flight risk" divides total years by a *sampled* job count, on an unexplained 1.6-yr threshold
- **Lens**: 🌀 Ambiguity
- **Severity**: Medium
- **Category**: magic number / unreliable input / happy-path logic
- **File**: pipeline/jobfit/soft_signals.py:140
- **Observation**: `_tenure_instability` computes `avg = years_experience / n_jobs` and flags job-hopping when `avg < 1.6` (soft_signals.py:147). But `n_jobs` counts only `evidence` items the LLM happened to return with `kind == "job"` — a truncated/sampled list (evidence is capped elsewhere and the LLM does not exhaustively enumerate roles), while `years_experience` is the *total* career span. A candidate with 12 years whose CV surfaced 4 job evidence items reads as 3.0 yr avg (fine), but one whose CV surfaced 4 of 12 short contracts can read either way — the denominator is not a real role count. The `1.6` and the `n_jobs < 3` gate are undocumented magic numbers.
- **Why it matters**: This emits a recruiter-facing "flight risk" antipattern (confidence 0.5) off a denominator that doesn't mean what the formula assumes — a fairness/accuracy risk on a sensitive signal, with no recorded reasoning for `1.6`.
- **Recommendation**: Either base tenure on the structured `experiences[].recency` dates (already extracted) rather than a raw count, or document that this is a coarse heuristic and require corroboration; name and justify the `1.6`/`3` constants in a comment or shared config.
- **Effort**: S

## 5. Authenticity trust-band thresholds are unexplained magic numbers driving a recruiter-visible band
- **Lens**: 🌀 Ambiguity
- **Severity**: Medium
- **Category**: magic number / uncalibrated decision
- **File**: pipeline/jobfit/authenticity.py:49
- **Observation**: The fabrication/AI-padding screen fires on `buzz_hits >= 4` (authenticity.py:49), `len(text) >= 1500 and digits < 8` (:54), and `skills_count >= 25 and len(text) < 1500` (:58). The count of warned flags then maps 0→high / 1→medium / 2+→low (authenticity_band, :73-80) — a trust band a recruiter sees and acts on. Only the `> 45` years bound (:63) carries a justification; the rest are bare constants with no recorded calibration, no source, and no test of false-positive rate. `buzz_hits` also sums substring `.count()` across phrases, so "value add"/"value-add" double-counts — making `>= 4` even harder to reason about.
- **Why it matters**: These thresholds silently decide whether a real candidate is labelled low-trust ("AI-generated padding"). A bilingual or terse-but-legitimate CV (Czech CVs run shorter) can trip `>=1500 chars / <8 digits` or skill-stuffing on formatting alone. Tribal knowledge that should be documented and tunable, since it gates a trust verdict.
- **Recommendation**: Lift the thresholds to named, commented constants (or config) with a one-line rationale each; add a fixture-based test asserting clean real CVs in both locales land "high"; consider counting distinct buzzword phrases rather than raw substring occurrences.
- **Effort**: S
