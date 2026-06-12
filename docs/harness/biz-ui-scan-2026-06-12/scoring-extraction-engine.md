# Biz+UI Scan — Scoring & Extraction Engine (2026-06-12)

> Total: 5 (1H/2M/2L)

## 1. Wire the documented transient-failure retry into `grounded_answer` — it has zero callers
- **Lens**: business_visionary
- **Severity**: High
- **Category**: functionality
- **File**: `pipeline/jobfit/gemini.py:191`
- **Scenario**: A recruiter runs a 60-90s analysis (or a JD-builder market lookup) and a single Gemini 429/503/network blip aborts the whole run with an error — or worse, silently degrades: `market_salary_cli.py:122` passes a `fallback`, so one rate-limit blip quietly swaps a grounded market estimate for the static taxonomy band labelled "deterministic".
- **Root cause**: `_generate_with_retry` (gemini.py:191, 3 attempts, backoff+jitter, transient-only) is dead code — grep shows its only reference is its own definition. `grounded_answer` calls `client.models.generate_content` directly (gemini.py:253), and ALL four production LLM entry points (CV analysis gemini.py:422, profile extract :330, market salary market_salary_cli.py:117, profile draft profile_draft_cli.py:209) flow through it. Commit `89f4bba` ("fix(jobfit): retry transient Gemini failures with bounded backoff") added only the helper, never the call-site switch — yet `docs/harness/harness-learnings.md:47` and `docs/harness/bug-hunt-2026-06-07/FIXES-WAVE-2.md:25` both record the retry as shipped.
- **Impact**: Reliability of the product's most expensive, most user-visible operation depends on a fix that was committed half-done and documented as complete. Every transient blip is either a failed analysis the recruiter must rerun or a silently worse salary number in a candidate-facing JD.
- **Fix sketch**: In `grounded_answer`, replace the direct `client.models.generate_content(...)` (gemini.py:253-257) with `_generate_with_retry(client, contents, config_kwargs)` — the helper already takes exactly these arguments. Add a unit test in `tests/test_gemini_truncation.py` style (fake client raising one 503 then succeeding) so the wiring can't regress again; correct harness-learnings.md.

## 2. Triangulate the salary estimate against the engine's own anchor band and grounded market range
- **Lens**: business_visionary
- **Severity**: Medium
- **Category**: functionality
- **File**: `pipeline/jobfit/pipeline.py:963`
- **Scenario**: The Salary tab shows the headline band (the number the recruiter negotiates against) and, right below it, the grounded "grounded range: …" from market evidence (`app/_components/results/salary/SalaryTab.tsx:83-84`). When the two disagree, nothing flags it — and the third signal, the deterministic taxonomy anchor band, is computed, shipped, and shown nowhere.
- **Root cause**: The prompt instructs Gemini to stay within "roughly ±20%" of the deterministic `anchor_band` (gemini.py:406), but nothing verifies compliance: `_salary_sanity_checks` (pipeline.py:963-970) checks only range order and the 350k plausibility ceiling. `anchor_band` (built at pipeline.py:839, shipped via `DeterministicEvidence`, models.py:167) has no UI consumer — grep for `anchorBand` in `app/` hits only `schemas.generated.ts:66` and a test fixture. `MarketEvidence.suggested_minimum/maximum` (models.py:64-65) are likewise never compared to `salary.minimum/maximum`.
- **Impact**: The engine holds three independent salary signals and reconciles none of them. A hallucinated band 2x the anchor sails through under the 350k ceiling; a recruiter quoting it to a candidate or hiring manager has no warning the engine's own deterministic table disagrees. Salary defensibility is exactly the trust capability that makes this engine worth paying for over a gut-feel ATS.
- **Fix sketch**: Add a `_salary_anchor_checks(salary, evidence, market_evidence)` to the `_sanity_checks` family (pipeline.py:872): when `anchor_band` is non-empty, emit "Salary within the deterministic anchor band" or a warn line ("Salary midpoint deviates N% from the role/seniority anchor — verify before negotiating (manual review)") when the midpoint falls >25% outside; same pattern for a grounded range that doesn't overlap the headline band. The "(manual review)" suffix rides the existing `isSanityWarn` catch-all (`app/_lib/sanity-checks.ts:17`), so the QualityStrip callout and the History review-flag pill light up with zero UI work.

## 3. Stop shipping English-only deterministic narrative into the bilingual result panel
- **Lens**: ui_perfectionist
- **Severity**: Medium
- **Category**: ui
- **File**: `pipeline/jobfit/soft_signals.py:87`
- **Scenario**: A Czech-locale recruiter runs an analysis with `lang=cs`. Gemini's narrative (strengths, gaps, job-fit text) arrives in Czech — but the soft-signal panel ("3 'strong' skill claim(s) unbacked by any project or role", every suggested probe), the quality-strip trust ledger ("Salary range needs manual review"), the extraction recommendation ("Prefer Gemini extraction for this document.", pipeline.py:308-312), and the explanation fallback (pipeline.py:622) are all hard-coded English. The result panel is a permanent language mosaic.
- **Root cause**: `analyze_cv` threads `lang` only into the LLM prompt (pipeline.py:122); every deterministic string builder ignores it — soft_signals.py labels/details/probes (e.g. :87-93, :153-157), `_sanity_checks`/`_score_sanity_checks`/`_archetype_sanity_checks` (pipeline.py:874, :904-911, :939-944), `compare_extraction_quality`. The UI knows: `SoftSignalsSection.tsx:15` comments "Signal text is deterministic engine English (shown verbatim)", and `app/_lib/sanity-checks.ts:12-18` hard-binds warn/ok triage to the English phrasing (`/manual review|disagrees|…/`), which makes naive Python-side localization actively breaking.
- **Impact**: The just-shipped full bilingual experience (commit 7922fbe) stops at exactly the strings the engine itself authors — and these are the trust-critical ones (red flags, repairs, probes). For a Czech-market recruiter tool, the most sensitive text being un-localized reads as unfinished, and copy-pasting the interview checklist into a Czech hiring loop requires manual translation.
- **Fix sketch**: Don't translate prose Python-side. Emit structured codes + params alongside (or instead of) the sentences — `SoftSignal.key` already exists; add a parallel `code`/`params` (and a `severity: ok|warn`) to sanity-check entries — then translate client-side via next-intl messages (en/cs), the same pattern `JD_MARKDOWN_STRINGS` uses in `jd-build-run.ts`. `isSanityWarn` switches from the substring regex to the structured severity, removing the documented coupling in sanity-checks.ts.

## 4. Replace the hard-coded "pypdf skills: 0" with the pre-pass's real count (or drop the metric)
- **Lens**: ui_perfectionist
- **Severity**: Low
- **Category**: ui
- **File**: `pipeline/jobfit/pipeline.py:314`
- **Scenario**: On every analysis, the Extraction tab's quality panel shows "pypdf skills: 0" next to "Gemini skills: N" (`app/_components/results/extraction/ExtractionTab.tsx:32-33`) — implying the local extractor found nothing, every single time.
- **Root cause**: `compare_extraction_quality` hard-codes `pypdf_skills=0` (pipeline.py:314); the value is fabricated, not measured. Yet the honest number already exists at the call site: the deterministic pre-pass runs the taxonomy detector over the pypdf text and produces `evidence.detected_skills` (pipeline.py:810, in scope at the :170 call).
- **Impact**: A permanently-zero metric presented as a measurement quietly poisons the credibility of the whole extraction-quality comparison — a sharp-eyed recruiter who notices it's always 0 will rightly wonder what else in the panel is decorative.
- **Fix sketch**: Pass `len(evidence.detected_skills)` into `compare_extraction_quality` (note the `DETECTED_SKILLS_PREPASS_LIMIT=30` cap when labelling), or remove the `pypdf_skills` field from `ExtractionQuality` + the UI row entirely. `npm run build`'s schema codegen propagates either change.

## 5. Don't render "Keyword Coverage 0%" when the check had no vocabulary
- **Lens**: ui_perfectionist
- **Severity**: Low
- **Category**: functionality
- **File**: `pipeline/jobfit/ats.py:63`
- **Scenario**: A recruiter analyzes a candidate against a JD whose wording matches no taxonomy skill token (non-tech roles, soft-skill-worded Czech JDs). The Job-fit tab shows a headline "Keyword Coverage 0%" with an empty meter — reading as "candidate failed the ATS check" when in fact the check never had anything to measure.
- **Root cause**: When `_harvest_jd_keywords` finds nothing, `evaluate_keyword_coverage` still returns a populated panel with `hits=[]` and `coverage_percent=0` (ats.py:63-66). `JobFitTab.tsx:115-122` renders the headline percent and the `Meter` unconditionally whenever the panel exists; only the chip grid is gated on `hits.length`.
- **Impact**: A false-negative-looking 0% on the screening surface invites wrongly discounting candidates for roles the keyword universe simply doesn't cover — the opposite of the engine's hypotheses-not-verdicts stance.
- **Fix sketch**: In the `_softly` keyword-coverage lambda (pipeline.py:199-212) — or at the top of `evaluate_keyword_coverage` — return `None` when the effective JD keyword set is empty; the pipeline already treats `None` as "no panel" and the UI already null-guards (`JobFitTab.tsx:50`). Alternatively keep the object but render a "no JD keywords detected" empty-state instead of `0%` when `hitsTotal === 0`.

---
## Cross-checks performed
- Prior report (2026-06-10) re-checked: #1 soft signals now wired (pipeline.py:251-257 + SoftSignalsSection.tsx), #2 sanityChecks now rendered (QualityStrip.tsx + sanity-checks.ts), #6 `--lang` now forwarded (jd-build-run.ts:84) with localized fallback (market_salary_cli.py:29-32, SCOR6). None re-flagged; finding 3 here covers the *deterministic-string* localization gap the SCOR6 fix explicitly did not (and which sanity-checks.ts documents as a coupling).
- `_generate_with_retry` callers: grep across repo → definition only (gemini.py:191) + two doc files claiming it's live; verified `git show 89f4bba` also contains only the definition (1 reference), so it was never wired, not regressed.
- `anchorBand`/`deterministicEvidence` in `app/` → schemas.generated.ts + null-contract test only; no component.
- Known/deferred list respected (no auth, languages-beyond-en/cs, stream-strip CV#7/known #4, probe-brief threading known #5, etc.).
