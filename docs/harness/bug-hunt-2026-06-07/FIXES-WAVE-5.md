# Bug Hunt Fix Wave 5 — Dev Case provenance & fallback honesty

> 5 commits, **6 of 7 findings closed** (2 high, 3 medium, 1 low). 1 deferred (DevCase#2 — WIP coordination).
> DevCase#1 was completed in a follow-up pass (commit 5).
> Baseline preserved: tsc 0→0 · `npm run test:python` 474→474 (4 skipped). Python-only wave.

## Commits

| # | Commit | Finding | Severity | File |
|---|---|---|---|---|
| 1 | `d825afc` | devcase #5 + #7 | Medium + High | `evaluate.py` |
| 2 | `1aad2b7` | devcase #4 | Medium | `claude_cli.py` |
| 3 | `5a2252f` | devcase #3 | Medium | `interview_scenario.py` |
| 4 | `1a52d45` | devcase #6 | Low | `analyze.py` |
| 5 | `75f0cab` | devcase #1 | High | `submission_eval.py`, `lifecycle_eval.py` |

## What was fixed

1. **Eval harnesses reported a false all-green when the LLM path was fully broken.** When every LLM call error-fell-back (auth/provider/parse), `generate_with_fallback` returned `source="deterministic"` and the well-formed templates passed every `_check` — so the run read as reliable 100%, `llm_rows 0`, and `--strict` PASSED, indistinguishable from an intentional `--no-llm` run. `provenance` stashes `FALLBACK_REASON_KEY` on an artifact ONLY when the LLM *raised*, so `run_one` now collects it into `Row.fallback_reasons`; `signals()` exposes `error_fallbacks`; the report shows a prominent WARNING; and `submission_eval --strict` exits non-zero on any error-fallback. (Verified: `--no-llm` reports `error-fallbacks: 0`, no false positive.)

5. **Crash on a non-dict probe outcome.** `evaluate_submission`'s deterministic path did `o.get("handledWell")` over `probeOutcomes`, assuming every element is a dict — unlike the sibling consumers `mint_followups`/`assess_tooling`, which filter by `isinstance`. A stored/hand-built ToolingSignal carrying strings or `None` raised `AttributeError`. Now filtered to dicts.
7. **Zero-probe judgment got a free half-credit.** With no probes assessed, `handled` defaulted to a neutral `0.5`, so judgment received a 0.25 contribution as if half the probes passed — scoring success-theater on the fairness-critical dimension for an assessment that never ran. With no probe signal, judgment now rests on verification alone.
4. **One bad prompt sank a whole judge sweep.** `ClaudeCliProvider.map` promised "one bad prompt can't sink a sweep", but `_one` only caught `ClaudeCliError` — `complete()` also raises `ValueError` on an empty prompt, which `pool.map` re-raised, aborting the entire batch and losing every other item's judgment. `_one` now wraps any non-`ClaudeCliError` as a `ClaudeCliError` so callers skip the bad item and keep the rest.
3. **Opaque 500 on a missing interview skeleton.** `_SCRIPT` loaded eagerly at module top with no guard, so an absent/corrupt `interview-script.json` raised a raw `FileNotFoundError`/`JSONDecodeError` at import (before any CLI try/except). Wrapped in `_load_script()` that raises a clear, actionable message and validates the phases array.
6. **Unmeasured repos vanished from the size narrative.** `analyze_need`'s deterministic fallback tiers on a single global LOC sum, so a `loc<=0` snapshot (private repo, LOC probe failed) that still carried stack/dir signal disappeared — a multi-repo role could read as fully grounded and under-classified. The grounding narrative now flags the count of unmeasured repos so the LOC total reads as a floor.

## Deferred (1 finding) — with rationale

**DevCase#2 (High) — malformed LLM dimension scores silently become the deterministic estimate under `source="llm"`.** DEFERRED to coordinate with the user's in-progress WIP (`7597c20`), which is actively building the **dimension-score-provenance contract** in `models.py`/`evaluate.py` (`MISSING_DIMENSION_SCORE`, `_mirror_dimension_scores`, the canonical-score contract). The fix belongs in that design: in `evaluate_submission.coerce`, an unparseable individual LLM score should record a per-dimension degradation marker (e.g. `partiallyParsed: [...]`) or read `MISSING_DIMENSION_SCORE` rather than silently substituting the deterministic per-dimension estimate while the envelope still says `source="llm"`. Applying a competing provenance scheme here would collide with the WIP. **Coordinate with the canonical-score work.**

(DevCase#1 — initially deferred — was completed in a follow-up pass; see commit `75f0cab` above.)

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
| 5 | Dev Case provenance & fallback honesty | 6 (of 7; #2 deferred) |
| 6 | Silent failures & batch-abort recovery | 4 |

Pattern catalogue: 19 items. **32 / 51 findings closed** (+ Data#1 partial). No criticals remain.

## What remains

W7 status/uniqueness guards (6), W8 board/form UI (11), plus the deferred DevCase#2 (WIP-coordination) and the Data#1 signal-forward for the 5 non-analyze handlers — 19 findings open per `INDEX.md`.
