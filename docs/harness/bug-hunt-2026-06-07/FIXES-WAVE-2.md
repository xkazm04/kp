# Bug Hunt Fix Wave 2 — Python numeric & LLM-boundary safety

> 5 commits, 6 findings closed (1 critical, 4 medium, 1 low).
> Baseline preserved: tsc 0→0 · unit 585→585 · python 474→474 (4 skipped). No regressions.
> Python-only wave (pipeline.py, market_salary_cli.py, gemini.py, insights.py).

## Commits

| # | Commit | Findings closed | Severity | File |
|---|---|---|---|---|
| 1 | `d51f09a` | scoring #1 + #5 | Critical + Medium | `pipeline.py` |
| 2 | `63d719b` | scoring #2 | Medium | `pipeline.py` |
| 3 | `cb20898` | scoring #3 | Medium | `market_salary_cli.py` |
| 4 | `89f4bba` | scoring #4 | Medium | `gemini.py` |
| 5 | `abb2400` | scoring #6 | Low | `insights.py` |

## What was fixed

1. **`Infinity` crashes the whole analysis (critical) + "inf years" corruption.** The grounded Gemini path sets no `response_mime_type`, so the stock `JSONDecoder` admits `Infinity`/`NaN`. `int(round(float('inf')))` raises **`OverflowError`** — not caught by the `(TypeError, ValueError)` clause — so a single non-finite field aborted the entire analysis with a 500 *after* the expensive Gemini call succeeded (`NaN` was tolerated, `Infinity` fatal). `_optional_float` had the mirror bug: `inf` passes every `>= 0` guard and renders as "inf years". Both helpers now catch `OverflowError` and reject non-finite via `math.isfinite`. One commit closes both (shared root in the two coercion choke points).

2. **Bogus LLM midpoint rendered as the headline figure.** `_salary_from_payload` trusted the model's `midpoint` verbatim when non-zero (re-deriving only when omitted), so an annual-figure midpoint among monthly bounds survived into the displayed estimate. Now kept only when `min <= midpoint <= max`, else derived.

3. **Market-salary CLI 500s instead of degrading.** `_coerce` caught `(TypeError, ValueError)` (string junk → band) but `int(float('inf'))` raises `OverflowError`, which escaped to the 500 handler — violating the module's "always returns a usable range" contract. Added `OverflowError` to the except.

4. **No retry on transient Gemini failures.** A single 429 / 5xx / 90s-timeout aborted the analysis (the core call passes no fallback). Wrapped `generate_content` in a bounded retry (`_generate_with_retry`, 3 attempts, exponential backoff + jitter) that retries only identifiably-transient errors and re-raises auth/4xx; per-attempt 90s timeout unchanged.

5. **Rationale claiming an adjustment to an empty band.** `apply_company_salary_context` early-returned only on a 1.0 factor, so a 0/0 "no estimate" placeholder with a non-1.0 company factor appended "Applied company context factor … raises expected cash range" next to a zero estimate. Now also bails when `salary.maximum <= 0`.

## Verification

| Gate | Before | After |
|---|---|---|
| `tsc --noEmit` | 0 | 0 |
| `npm run test:unit` | 585 | 585 |
| `npm run test:python` | 474 (4 skipped) | 474 (4 skipped) |

Plus targeted manual checks: `_optional_int(inf/-inf/nan)`→None, normal ints preserved; bogus midpoint 1080000→90000 (in-band), valid midpoint kept; `inf` minimum no longer raises; market-cli `inf`→degraded to band; `_is_transient_error` true for 429/RESOURCE_EXHAUSTED, false for auth.

## Patterns established (catalogue items 6–9)

6. **A permissive JSON decoder admits non-finite floats.** A stock `JSONDecoder` (no `parse_constant`) turns `Infinity`/`NaN` into Python floats; `int()` on `Infinity` raises `OverflowError` (NOT `ValueError`) and `inf` passes every `>= 0`/`> 0` guard. Reject non-finite at every numeric coercion boundary (`math.isfinite`) and include `OverflowError` in the except.
7. **Trust-but-bound a model's derived field.** When an LLM supplies both bounds and a value derived from them (midpoint), the value's consistency with the bounds is not guaranteed — clamp/re-derive it into the repaired range before display.
8. **A single un-retried LLM call is a throughput cliff.** Transient 429/5xx/timeout are normal on a busy key; wrap provider calls in a bounded retry that distinguishes transient (retry) from permanent (fail fast).
9. **Guard the operand, not just the operation.** A side-effecting write guarded only by "is there a factor?" still ran on an empty target; also check the target is non-empty/valid (here: `maximum > 0`) before claiming it was modified.

## Cumulative status (waves 1–2)

| Wave | Theme | Closed |
|---|---|---|
| 1 | Duplicate side-effects & double-firing | 6 |
| 2 | Python numeric & LLM-boundary safety | 6 |

Pattern catalogue: 9 items. **12 / 51 findings closed.**

## What remains

W3 analyze lifecycle, W4 voice end-of-call, W5 dev-case provenance (WIP overlap), W6 silent failures, W7 status/uniqueness guards, W8 board/form UI — 39 findings open per `INDEX.md`. Of the original 3 criticals, 2 are now closed (W1 outreach re-send, W2 `Infinity` crash); **1 remains: the analyze poll-loop leak in W3** (`AnalyzeApi.ts:37`).
