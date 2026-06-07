# Bug Hunt Fix Wave 5 — Dev Case provenance & fallback honesty

> 4 commits, **5 of 7 findings closed** (1 high, 3 medium, 1 low). 2 deferred (see below).
> Baseline preserved: tsc 0→0 · `npm run test:python` 474→474 (4 skipped). Python-only wave.

## Commits

| # | Commit | Finding | Severity | File |
|---|---|---|---|---|
| 1 | `d825afc` | devcase #5 + #7 | Medium + High | `evaluate.py` |
| 2 | `1aad2b7` | devcase #4 | Medium | `claude_cli.py` |
| 3 | `5a2252f` | devcase #3 | Medium | `interview_scenario.py` |
| 4 | `1a52d45` | devcase #6 | Low | `analyze.py` |

## What was fixed

5. **Crash on a non-dict probe outcome.** `evaluate_submission`'s deterministic path did `o.get("handledWell")` over `probeOutcomes`, assuming every element is a dict — unlike the sibling consumers `mint_followups`/`assess_tooling`, which filter by `isinstance`. A stored/hand-built ToolingSignal carrying strings or `None` raised `AttributeError`. Now filtered to dicts.
7. **Zero-probe judgment got a free half-credit.** With no probes assessed, `handled` defaulted to a neutral `0.5`, so judgment received a 0.25 contribution as if half the probes passed — scoring success-theater on the fairness-critical dimension for an assessment that never ran. With no probe signal, judgment now rests on verification alone.
4. **One bad prompt sank a whole judge sweep.** `ClaudeCliProvider.map` promised "one bad prompt can't sink a sweep", but `_one` only caught `ClaudeCliError` — `complete()` also raises `ValueError` on an empty prompt, which `pool.map` re-raised, aborting the entire batch and losing every other item's judgment. `_one` now wraps any non-`ClaudeCliError` as a `ClaudeCliError` so callers skip the bad item and keep the rest.
3. **Opaque 500 on a missing interview skeleton.** `_SCRIPT` loaded eagerly at module top with no guard, so an absent/corrupt `interview-script.json` raised a raw `FileNotFoundError`/`JSONDecodeError` at import (before any CLI try/except). Wrapped in `_load_script()` that raises a clear, actionable message and validates the phases array.
6. **Unmeasured repos vanished from the size narrative.** `analyze_need`'s deterministic fallback tiers on a single global LOC sum, so a `loc<=0` snapshot (private repo, LOC probe failed) that still carried stack/dir signal disappeared — a multi-repo role could read as fully grounded and under-classified. The grounding narrative now flags the count of unmeasured repos so the LOC total reads as a floor.

## Deferred (2 findings) — with rationale

**DevCase#2 (High) — malformed LLM dimension scores silently become the deterministic estimate under `source="llm"`.** DEFERRED to coordinate with the user's in-progress WIP (`7597c20`), which is actively building the **dimension-score-provenance contract** in `models.py`/`evaluate.py` (`MISSING_DIMENSION_SCORE`, `_mirror_dimension_scores`, the canonical-score contract). The fix belongs in that design: in `evaluate_submission.coerce`, an unparseable individual LLM score should record a per-dimension degradation marker (e.g. `partiallyParsed: [...]`) or read `MISSING_DIMENSION_SCORE` rather than silently substituting the deterministic per-dimension estimate while the envelope still says `source="llm"`. Applying a competing provenance scheme here would collide with the WIP. **Coordinate with the canonical-score work.**

**DevCase#1 (High) — eval harnesses report 100% reliability when every LLM call silently fell back.** DEFERRED as a focused follow-up: it changes operator-facing reporting **and the `--strict` CI gate** across two harness files (`submission_eval.py`, `lifecycle_eval.py`), which deserves dedicated attention over a tail-of-session change. It's an internal eval/CI diagnostic (not user-facing runtime), lowering blast radius. **Turnkey spec** (mechanism now fully understood — see `provenance.py`): `generate_with_fallback` stashes `FALLBACK_REASON_KEY` ("fallbackReason") on an artifact ONLY when the LLM *raised* (a `provider is None` `--no-llm` run never carries it), so error-fallback is cleanly distinguishable from intentional deterministic. Fix: in `run_one`, collect `FALLBACK_REASON_KEY` off each of the 4 artifacts (refl/tool/ev/tr) into a new `Row.fallback_reasons: dict`; in `signals()`/`_report_md`, count rows where `provider is not None` but at least one step error-fell-back, and surface a top-line warning; make `--strict` exit non-zero when "ran in LLM mode but N rows error-fell-back".

## Verification

| Gate | Before | After |
|---|---|---|
| `tsc --noEmit` | 0 | 0 (no TS touched) |
| `npm run test:python` | 474 (4 skipped) | 474 (4 skipped) |

## Patterns established (catalogue items 18–19)

18. **Inconsistent hardening across sibling functions is a latent bug.** When 2 of 3 consumers of a shape defensively guard (e.g. `isinstance(o, dict)`) and the 3rd doesn't, the 3rd is the crash waiting to happen — mirror the guard rather than trusting the input shape.
19. **A neutral-midpoint default conflates "no signal" with "average signal."** Defaulting a missing measurement to `0.5` credits an assessment that never ran. Treat absent input as no-signal (renormalize or drop the term), not as a middling result — the same lesson as `MISSING_DIMENSION_SCORE` (don't read absent as scored-50 in some places and scored-0 in others).

## Cumulative status (waves 1–6)

| Wave | Theme | Closed |
|---|---|---|
| 1 | Duplicate side-effects & double-firing | 6 |
| 2 | Python numeric & LLM-boundary safety | 6 |
| 3 | Analyze run lifecycle & task cancellation | 4 + Data#1 (analyze) |
| 4 | Voice interview end-of-call & connection timing | 6 |
| 5 | Dev Case provenance & fallback honesty | 5 (of 7; #1, #2 deferred) |
| 6 | Silent failures & batch-abort recovery | 4 |

Pattern catalogue: 19 items. **31 / 51 findings closed** (+ Data#1 partial). No criticals remain.

## What remains

W7 status/uniqueness guards (6), W8 board/form UI (11), plus the deferred DevCase#1 (turnkey) and DevCase#2 (WIP-coordination), and the Data#1 signal-forward for the 5 non-analyze handlers — 20 findings open per `INDEX.md`.
