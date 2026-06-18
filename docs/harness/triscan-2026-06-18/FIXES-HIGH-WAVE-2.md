# Tri-Lens Fix — High Wave 2: AI robustness (Python engine)

> Continues critical Wave 5. 4 atomic fix commits, **5 High findings closed** (4 bug + 1 test-coverage).
> Baseline preserved: Python `unittest` 630 → 634 (+4) · TS untouched (tsc 0 / 960) · 0 regressions.
> Branch: `vibeman/triscan-fixes-2026-06-18`.

## Commits

| Commit | Finding | Severity | Files |
|---|---|---|---|
| `f6333f3` | devcase-pipeline #2 — judge `int(score)` crash aborts the pass | High | devcase/llm_judge.py |
| `1c1b21d` | cv-extraction #2 + #3 — name leak · Czech `on` shreds English | High ×2 | redact.py (+test) |
| `f6274e7` | devcase-pipeline #3 — lifecycle_eval no `--strict` gate | High | devcase/lifecycle_eval.py |
| `7b76709` | pipeline-test-suite #2 — malformed-but-complete JSON untested | High (coverage) | tests/test_gemini_truncation.py |

## What was fixed

1. **Judge pass survives one bad payload.** `run_judge` guarded `res.json()` but called the caller's `parse_fn` unguarded; a wrong-shape dict (`{"score": null}` / `{"score": "good"}`) made a `_shape` closure raise `int(None)`/`int("good")`, and since the loop is synchronous that aborted the **entire** judge pass — every not-yet-shaped row lost its verdict. Wrapped `parse_fn` in try/except (matching the module's "malformed payloads are silently skipped" contract): one off-spec payload skips only its row. Single-point fix covering both `_shape` sites.

2. **Redaction: stop shredding English "on" + catch inline-title names.** (a) The pronoun regex included Czech `on` (he), which collides with the English preposition — `\bon\b` redacted every "on" in an English CV, corrupting the blind-scored text. Dropped `on` (kept `ona`, no common collision). (b) `_guess_name_line` only matched a line that is *entirely* 2–4 name tokens, so "Jan Novák — Senior Engineer" left the name unredacted; now it also checks the leading segment before a name/title separator, masking the name while the (clearly delimited) title stays. Tests for both.

3. **lifecycle_eval gets a `--strict` CI gate.** `submission_eval` could fail CI on a degraded provider (reliability < 100% or any LLM error-fallback); `lifecycle_eval` — the design half — always returned 0. Ported the applicable core (`reliability`/`error_fallbacks`, which lifecycle's `signals()` exposes), so a degraded provider can no longer silently certify the design pipeline.

4. **Malformed-but-complete JSON now tested.** The suite covered clean + truncation, but not a cleanly-finished response that's valid JSON of the wrong shape, or prose instead of JSON (both legitimate refusals). Locked the safe behavior: wrong-shape JSON parses to payload (not mis-flagged truncated; downstream `analysisSchema` rejects it); non-JSON prose raises a clear, non-truncation error.

## Verification

| Gate | Before | After |
|---|---|---|
| `python -m unittest discover -s pipeline/jobfit/tests` | 630 pass / 4 skip | 634 pass / 4 skip |
| `lifecycle_eval --no-llm --strict` | (no flag) | exit 0 on a clean run |
| TS (`tsc` / `node --test`) | 0 / 960 | unchanged (no TS edits) |

New tests: English-"on"-survives + inline-title name (test_redact), malformed-complete wrong-shape + non-JSON prose (test_gemini_truncation).

## Cumulative this session

30/30 criticals + **10 Highs** closed across 10 waves, 0 regressions throughout. TS 935→960, Python 626→634.

## AI/Python theme — remaining (per INDEX)

matching #2 (zero-requirement job inflation), #3 (fairness-matrix tie flips); cv-extraction #4 (grounded-mode echo-object selection), #5 (no pypdf↔Gemini fidelity cross-check); the `/5.0` overlap denominator tuning; fence the evaluate/judge prompts with the same `fenced_untrusted` helper (Wave-5 follow-up). All non-critical.
