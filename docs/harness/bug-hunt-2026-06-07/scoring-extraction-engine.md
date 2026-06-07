# Bug Hunt — Scoring & Extraction Engine (Python)

> Total: 6
> Critical: 1 | High: 0 | Medium: 4 | Low: 1

## 1. `Infinity` in Gemini JSON crashes the whole analysis (OverflowError escapes `_optional_int`)
- **Severity**: Critical
- **Category**: silent-failure
- **File**: C:/Users/mkdol/dolla/kp/pipeline/jobfit/pipeline.py:626-632 (`_optional_int`), used by `_clamp_int` (635), `_salary_from_payload` (522-537), `_score_from_payload` (495-505), `_job_fit_from_payload` (553), `_market_evidence_from_payload` (578-579)
- **Scenario**: Gemini returns `"minimum": Infinity` (or `-Infinity`, or any numeric field as `Infinity`) — a real, observed failure mode when the model emits an unbounded number. The grounded path (`use_grounding=True`) sets **no** `response_mime_type`, and `_parse_json` decodes with a stock `json.JSONDecoder`, whose default `parse_constant` happily turns `Infinity`/`NaN`/`-Infinity` into Python floats (verified: `JSONDecoder().raw_decode('{"minimum": Infinity}')` → `{'minimum': inf}`). The value then reaches `_optional_int`, which runs `int(round(float(value)))`. `int(round(float('inf')))` raises **`OverflowError`**, which is NOT in the `(TypeError, ValueError)` except clause, so it propagates.
- **Root cause**: Wrong assumption that the only failure modes of `int(round(float(x)))` are `TypeError`/`ValueError`. `Infinity` raises `OverflowError`; the JSON parser admits non-finite floats that the salary-band invariant module (`salary_band.normalize_band`, which *does* reject `inf`/`nan` and is unit-tested for it) would have caught — but the LLM-payload parse path bypasses `normalize_band` entirely. Note the asymmetry: `NaN` is handled gracefully (`int(round(nan))` raises `ValueError`, caught → `None` → defaults to 0), so this is silent for `NaN` but fatal for `Infinity`.
- **Impact**: A single non-finite number anywhere in score/salary/job_fit/market_evidence aborts the entire analysis AFTER the expensive Gemini call already succeeded — the exact failure `_softly`/`_salary_from_payload`'s repair philosophy exists to prevent. The user sees a 500 (`cli.py:61-66`), the result is discarded, and `pipeline.log` records `status: error` with a cryptic `OverflowError`.
- **Fix sketch**: In `_optional_int`/`_optional_float`, add `OverflowError` to the except tuple AND reject non-finite values: `f = float(value); if not math.isfinite(f): return None`. Better still, route salary numbers through the existing `salary_band.normalize_band`/`round_salary` (already inf/nan-safe) instead of re-implementing coercion. Optionally pass `parse_constant=` to the `JSONDecoder` in `_scan_json_values` to map `Infinity`/`NaN` to `None` at the parse boundary.

## 2. LLM-supplied salary midpoint is never clamped to [min, max]
- **Severity**: Medium
- **Category**: validation-gap
- **File**: C:/Users/mkdol/dolla/kp/pipeline/jobfit/pipeline.py:537
- **Scenario**: Gemini returns a coherent monthly band (`minimum: 80000, maximum: 100000`) but a `midpoint` that is an annual figure or a stray field (`midpoint: 1080000`). Line 537 takes `_optional_int(raw.get("midpoint"))` verbatim whenever it parses to a non-zero int — it is only re-derived from `(min+max)/2` when the LLM omits it. `apply_company_salary_context` recomputes the midpoint ONLY when a company adjustment factor `!= 1.0` is present (insights.py:68-72), which is the *uncommon* path. With no company context (the common case), the bogus midpoint survives unmodified into `SalaryEstimate.midpoint`.
- **Root cause**: Assumption that a model-supplied midpoint is internally consistent with the model's own min/max. The min/max are repaired (swap, fill) but the midpoint is trusted blindly and never bounded to the repaired range.
- **Impact**: `_salary_sanity_checks` flags `0 < min <= midpoint <= max` failure as "Salary range is inconsistent" (good), but the *displayed* midpoint is still wrong — `scripts/salary.py:58` and the UI render the garbage midpoint to the recruiter/candidate as a number they negotiate against. Success theater: a plausible-looking but wrong headline figure.
- **Fix sketch**: After computing min/max, clamp/derive the midpoint: `midpoint = _optional_int(raw.get("midpoint")); if midpoint is None or not (minimum <= midpoint <= maximum): midpoint = round_salary((minimum + maximum) / 2)`. This keeps the displayed midpoint always inside the band.

## 3. `market_salary_cli._coerce` misses `OverflowError`, defeating its own taxonomy-band fallback
- **Severity**: Medium
- **Category**: recovery-gap
- **File**: C:/Users/mkdol/dolla/kp/pipeline/jobfit/market_salary_cli.py:46-52
- **Scenario**: The grounded call (`use_grounding=True`, no mime type → stock JSON decoder) returns `"suggestedMinimum": Infinity`. `_coerce` does `lo = int(payload.get("suggestedMinimum") or 0)`. `int(float('inf'))` raises `OverflowError`, but the `except (TypeError, ValueError)` clause does not catch it. The exception escapes `_coerce` and is caught only by `main`'s outer `except Exception` (line 113), which prints a 500 error envelope.
- **Root cause**: Same wrong assumption as #1 — `int()` on a non-finite float raises `OverflowError`, not `ValueError`. The except clause was written for string-coercion failures (`int("85 000")`) and never considered non-finite floats slipping through the grounded JSON decoder.
- **Impact**: The module's documented contract ("Falls back to the deterministic taxonomy band when … grounding fails, so it always returns a usable range") is violated. Instead of the promised `_fallback(...)` band, the JD builder gets a 500 and no salary — a hard failure where a graceful degrade was advertised.
- **Fix sketch**: Add `OverflowError` to the except tuple in `_coerce` (and guard `math.isfinite`), so a non-finite grounded value degrades to the taxonomy band exactly like a string-parse failure does.

## 4. No retry/backoff on transient Gemini failures; the core call has no fallback
- **Severity**: Medium
- **Category**: recovery-gap
- **File**: C:/Users/mkdol/dolla/kp/pipeline/jobfit/gemini.py:202-225 (`grounded_answer`), 367-376 (`analyze_profile_with_gemini` call site)
- **Scenario**: Gemini returns a transient 429 (rate limit) or 503, or the request hits the 90s timeout (gemini.py:134). `grounded_answer` only swallows-and-degrades when a `fallback` is passed; `analyze_profile_with_gemini` passes **no** fallback, so any transient error propagates and aborts the entire analysis. There is no retry, no exponential backoff, and no distinction between a transient (retryable) and a permanent error.
- **Root cause**: Assumption that the single Gemini call either succeeds or fails permanently. Rate limits and 5xx are normal, recoverable conditions on a busy key; one blip discards an analysis that a single retry would have completed.
- **Impact**: Flaky, user-visible 500s under load or rate-limiting, with no automatic recovery. Each failure also burns the user's upload round-trip and the pre-pass work. Timing-class failure: partial-result state is fine (nothing persisted), but throughput collapses under transient pressure.
- **Fix sketch**: Wrap the `client.models.generate_content` call in a bounded retry (2-3 attempts, exponential backoff with jitter) that only retries on identifiably-transient errors (HTTP 429/503, timeouts) and re-raises on auth/4xx. Keep the existing 90s per-attempt timeout.

## 5. `years_experience = Infinity` slips through `_optional_float` and surfaces as "inf years"
- **Severity**: Medium
- **Category**: edge-case
- **File**: C:/Users/mkdol/dolla/kp/pipeline/jobfit/pipeline.py:617-623 (`_optional_float`), 319/342, 454
- **Scenario**: Gemini returns `"years_experience": Infinity` (admitted by the stock JSON decoder, see #1). `_optional_float` does `float(value)` → `inf`; `inf >= 0` is True, so it is accepted verbatim (unlike `NaN`, which is `>= 0`-False and falls back to the default). `inf` then flows into `CandidateProfile.years_experience` (typed `float`, no bound), `_explanation_fallback` (`f"…{salary…}"` is fine, but seniority text uses years indirectly), `build_evidence_trace` (`f"{profile.years_experience:g} years detected"` → "inf years"), and `_v2_profile_from_payload` (`years if years and years > 0 else None` → keeps `inf`).
- **Root cause**: `_optional_float` validates only `None`/`TypeError`/`ValueError`, not non-finite floats. `inf` passes every downstream `>= 0` / `> 0` guard and `:g` formatting never raises, so it is never caught.
- **Impact**: Plausible-but-corrupt output ("inf years detected") in the evidence trace and v2 profile, and `_infer_seniority`-style year thresholds (`years >= 7`) silently classify the candidate as senior on garbage input. Success theater rather than a flagged failure.
- **Fix sketch**: In `_optional_float`, reject non-finite: `f = float(value); return f if math.isfinite(f) else default`. Optionally clamp `years_experience` to a sane ceiling (the regex profiler already caps at 20-25 years).

## 6. Company-context rationale claims an adjustment was applied to a no-data (0/0) salary
- **Severity**: Low
- **Category**: silent-failure
- **File**: C:/Users/mkdol/dolla/kp/pipeline/jobfit/insights.py:67-75
- **Scenario**: Gemini surfaced no comp signal, so `_salary_from_payload` returns the legitimate zero/zero "no estimate" placeholder (pipeline.py:535-536). Company text yields an adjustment factor of e.g. 1.10. `apply_company_salary_context` early-returns only when `context is None or adjustment_factor == 1.0` — neither holds — so it runs `round_salary(0 * 1.10) = 0` for min/max/midpoint (harmless) but then unconditionally appends `"Applied company context factor 1.1 for <type>: raises expected cash range"` to `salary.rationale`.
- **Root cause**: The guard checks only the *factor*, never whether there is an actual band to adjust. A 0/0 placeholder is treated like a real band.
- **Impact**: A recruiter reading the Salary tab sees "Applied company context factor 1.1 … raises expected cash range" sitting next to an empty/zero estimate — a rationale describing an adjustment that did nothing, contradicting the "No salary estimate produced" sanity check. Misleading, not data-corrupting.
- **Fix sketch**: Bail out when there is no band to adjust: `if context is None or context.adjustment_factor == 1.0 or salary.maximum <= 0: return`.
