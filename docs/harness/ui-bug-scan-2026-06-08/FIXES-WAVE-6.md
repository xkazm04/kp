# UI+Bug Scan — Fix Wave 6: Silent failures & opaque errors

> 6 findings closed (2 High, 4 Medium) across 6 atomic commits. 1 Medium deferred (noted below).
> Baseline preserved: tsc 0 → 0, next build ✓, unit 638 → 638, lint clean.
> One mental model: **no swallowed errors — reconcile flags, fail loudly on no-signal, degrade visibly.**

## Commits

| # | Commit | Finding | Severity | Files |
|---|---|---|---|---|
| 1 | `2d63f16` | onboarding dispatch after Accept is silent/un-retried | High | offer-finalize.ts |
| 2 | `dca39d0` | github deep-review fabricates from zero signals | High | github-analysis/route.ts |
| 3 | `54d74da` | policy-pass empty run is success-theater | Medium | automation-pass.ts |
| 4 | `38a7961` | sim offer-link GET has no try/catch (opaque 500) | Medium | sim/offer-link/route.ts |
| 5 | `b2ef7fc` | diagram layout failure dumps raw source | Medium | PlantUml.tsx |
| 6 | `d018260` | salaryBandPosition NaN/Infinity verdict | Medium | salary-band.ts |

## What was fixed

1. **onboarding reconcile (High)** — the post-CAS `dispatchOnboarding` had no compensation; a comms blip 500'd the candidate and the retry masked it as "accepted", leaving a Hired candidate un-onboarded with no signal. Now caught → records a durable `onboarding_failed` reconcile event + logs, still returns ok.
2. **github no-signal guard (High)** — per-call `.catch(() => "" / [])` made a rate-limited fetch look like sparse repos, so Gemini fabricated a confident assessment. If every bundle is empty the review now returns `status:error` instead of calling the model.
3. **policy-pass `evaluated` (Med)** — an empty/terminal-board pass logged an all-zero "ok" run indistinguishable from a healthy idle pass. `AutomationSummary` now carries `evaluated` (active entries scanned), persisted on every run so the two are distinguishable in the run log.
4. **sim offer-link try/catch (Med)** — added the try/catch its four sibling sim routes have, so a DB throw returns clean JSON instead of an opaque 500 that crashed the sim's `.json()`.
5. **diagram failure UX (Med)** — a failed ELK layout silently dumped raw PlantUML source; now logs the real error and shows a friendly message (empty-but-parseable diagrams still show source).
6. **salary NaN verdict (Med)** — a non-finite midpoint no longer falls through to "within" or yields "Infinity% over"; it returns no verdict.

## Deferred (1)

- **sim reset re-orphans rows mid-run** (demo-simulation-channels #1, Med) — `resetSim` honors the stop flag only at await checkpoints, so in-flight publish/source mutations can re-create the `(SIM)` rows it just deleted. Closing it cleanly needs stop-flag checkpoints threaded through the sim orchestration's in-flight mutations — more involved than the rest of this wave, and demo-only. Left for a follow-up; tracked in the INDEX.

## Verification (before / after)

| Gate | Baseline (B2) | After Wave 6 |
|---|---|---|
| tsc --noEmit | 0 errors | 0 errors |
| next build | ✓ | ✓ (Compiled successfully) |
| test:unit | 638 pass | 638 pass |
| eslint (touched files) | — | clean |

## Cumulative status (waves 1–6)

| Wave | Theme | Closed |
|---|---|---|
| 1 | Trust-boundary & validation (security) | 8 |
| 2 | Data integrity (lost-updates & dropped writes) | 7 |
| 3 | Identity-by-label / wrong-record | 5 |
| 4 | Concurrency & idempotency | 6 |
| 5 | Stale UI / fetch-state | 8 |
| 6 | Silent failures & opaque errors | 6 |
| | **Total** | **40** |

**43 findings remain across 3 themes** (1 deferred Med + score/number consistency W7 + accessibility W8 + UI-states/polish W9 — all Medium/Low).

## Patterns established (catalogue items 18–19)

18. **Per-call `.catch` defaults make total failure look like sparse data.** Swallowing each sub-fetch to `"" / []` makes a wholesale failure (rate limit, 5xx) indistinguishable from a genuinely empty result — so downstream (especially an LLM) confidently acts on nothing. Detect "did we get ANY signal?" and bail loudly when not.
19. **Terminal side effect after a CAS with no compensation.** A non-idempotent side effect (dispatch/email) run after a committing CAS — where the idempotent retry early-returns success — silently drops on failure. Catch it, record a durable reconcile flag, and still return ok so the legitimate commit stands.

## What remains

43 findings (1 deferred + 3 themes). Recommended next: **Wave 7 — Score/number/label consistency** (ScoreDial↔scoreTone, history↔dial score, currency fallback, coerceString trim, salary unit drift, completeness meter tiers, SalaryGauge target, median band) — ~8 fixes sharing "single source of truth for derived numbers/tones."
