# High Fix Wave 5 — scoring / fairness correctness (Python)

> 3 findings closed in 2 commits. Theme: *the fairness gate must actually enforce, and a
> validated-only-at-the-boundary value must be re-validated where it's used.*
> Baseline preserved: tsc **0**, unit **1019/1019**, Python fairness **5→8** tests, matching
> golden scores unchanged (53 matching/registry tests green). No TS/TSX changed — `next build`
> is unchanged from W4's green.

## Commits

| Commit | Findings | Fix |
|---|---|---|
| `66173da` | eval-fairness #1, #2 | **`_probe_pedigree`** accepted a top-score `delta <= 3` as PASS, but the university name is dropped before matching so the only honest delta is **0** — `<=3` silently absorbed a real pedigree advantage of up to 3 points (enough to reorder a top-5). Now requires `delta == 0`. **`Report.aggregate()`** substituted `entry_precision = 1.0` when no early-career scenario measured it, folding a coverage gap into a vacuous accuracy PASS — it now **omits** the metric when unmeasured and `passes()` requires every gated metric to be **present and** meet threshold (unmeasured ⇒ FAIL). + 3 gate-honesty regression tests. |
| `b6062ad` | matching | **`potential_score`** feeds the early-career `career` dimension directly but is range-validated only at the Pydantic boundary — a candidate built outside it (`model_construct` / direct field set) could carry an out-of-[0,1] or NaN value that overflowed the career bar + breakdown. `score_job` now clamps to [0,1] and rejects NaN. |

## Why these are safe
The two eval-gate changes only *tighten* the gate — the real run still passes (pedigree
delta is genuinely 0; entry_precision is genuinely measured at 1.0), verified by running
`matching_eval.run()` and the full `test_fairness` suite. The `potential_score` clamp is a
no-op for valid [0,1] values (so the matching golden tests are unchanged) and only catches
out-of-range/NaN inputs from non-validated construction paths.

## Deliberately not changed
- **`score_personal` saturation at 5 keyword hits** (`overlap = min(1.0, hits/5.0)`) — a
  5-keyword CV ties a 50-keyword one. This is a *scoring-curve tuning* decision, not a clear
  bug: changing the saturation point shifts every production ranking and the golden scores.
  That's a product call (re-calibrate + re-bless goldens), out of scope for a bug-fix wave.
- **`_band_span` salary auto-pass / archetype-weight sum** — the archetype-weight invariant
  was already fixed (Crit #7, registry import validation). The salary-band eval default is a
  Medium, deferred to a later eval-hardening pass.

## Pattern catalogue additions
23. **A fairness/quality gate must distinguish "measured & passed" from "not measured".**
    Defaulting an unmeasured axis to a passing value turns a coverage gap into green theater —
    omit it and fail the gate on absence.
24. **A "tolerance" on an invariant that should be exact is a leak.** If a field is dropped,
    its score delta must be 0; any non-zero tolerance silently licenses the exact bias the
    probe claims to forbid.
25. **Re-validate boundary-validated values at the point of use.** A field range-checked only
    in the Pydantic model can arrive out-of-range via `model_construct`/direct assignment;
    clamp it again where it feeds the math.
