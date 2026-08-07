# Fix Wave 4 — "A gate that cannot fail is not a gate"

> 5 commits, **7 Highs closed**.
> Baseline preserved: tsc 0 · node unit 1389 → **1404** (+15) · python 793 → **797** (+4) · i18n 3233×4 parity · `next build` ✓.

This scan surfaced the same shape more than any other: a check that reports PASS and has no
path to FAIL. Not a bug in the check's logic — an absence of the failing branch entirely.

## Commits

| Commit | Findings | Severity |
|---|---|---|
| `2cc53ed` | evaluation-fairness-seed-data #1, #2 | 2×High |
| `fd954c9` | pipeline-test-suite-python #1 | High |
| `e0f1ef5` | tasks-system-operations #1 | High |
| `6760e18` | dev-submissions-live-work-surface #1 | High |
| `2f237b4` | group-evaluation-fairness #2, dev-case-authoring-publishing #2 | 2×High |

## The five gates

1. **The reliability gate certified 2/2 = 100%.** `--no-llm --strict` had goldens for only 2 of
   13 curated scenarios and `run_golden` did `if not g: continue`, dropping the other 11 from
   the *denominator*. It now fails when a selected scenario has no golden, and prints real
   coverage. **Intended consequence: `npm run test:eval:strict` now exits 1.** The gate is not
   newly broken; it is newly honest.

2. **The optimizer trained and validated on the same set**, accepting on judge-score movement,
   so judge noise could ratify a non-improvement. Deterministic split (sorted name, even→train,
   odd→validation, no RNG); acceptance requires the *deterministic* reliability component to
   improve — the judge sum is advisory.

3. **A test asserted a tautology.** `assertGreaterEqual(kafka["qualifiedDelta"], out["qualified"] and 0)`
   — the right side collapses to `0`, so it only ever asserted `delta >= 0`. The winnability
   coach's headline invariant had been unguarded for months. Now asserts `> 0` **and** equality
   with an independently recomputed delta. The old test *data* was trivial too (every candidate
   scored identically, true delta 0), so the tautology was hiding nothing — it was simply
   guarding nothing. A second self-comparison (`assertEqual(out, {**out, ...})`) fixed alongside.

4. **Health reported "Healthy" while the clock was dead.** `scheduler-health.ts` judged error-row
   currency and never asked whether the scheduler was *running*. A dead tick silently halts
   interview reminders, offer expiry, and the GDPR anonymization sweep. `tick()` now stamps a
   heartbeat as its first statement — before any sweep, so a live-but-erroring tick still proves
   the chain runs. Absence never reads healthy: `starting` within the boot grace, `stalled` after.
   Both thresholds derive from one `SCHEDULER_TICK_MS` rather than new magic numbers.

5. **The anti-ghostwriting penalty had never fired.** `scoreAuthenticity` has an
   `observedBulkPaste` predicate and a −65 penalty; `promoteSubmission` forces advance→hold on a
   "suspect" band. All of it was inert because **five hops** dropped the event between the client
   and the scorer: the route's `KINDS` allow-list, the route's mapper, the type, the INSERT, and
   the SELECT. A feature can be fully implemented at both ends and still be dead if nothing
   carries the signal between them. A bulk paste now drives the score 100 → 35.

   *Residual risk, stated not papered over:* these events come from the candidate's browser and
   the POST trusts them. This catches naive paste-from-an-LLM; it is not tamper-proof.

6. **The robustness "gate" asserted from a no-op.** With uniform weights, re-scoring under every
   other archetype's weighting cannot change the order — so the check proved nothing and said
   "robust" anyway, while `sealDecisionSafe` recorded a lead as robustness-verified. Now returns
   `assessed | not_varied | unavailable | not_applicable`, and the **sealed record states the
   truth** instead of implying a check that never ran.

7. **A doctrine enforced in one route, forgotten in its sibling.** The manual `POST /api/devcase`
   approve bypassed the probe-strength audit that `lifecycle/[id]/approve` enforces. Extracted
   ONE `enforceProbeGate()` both call. Same class as the org role-vs-override cap (`2a77311`) and
   the checkout portal guard (`7dc4fb5`) — the third instance this run.

## A false claim in three languages

The robustness fix reworded the English copy. `cs`/`de`/`fr` still told users "the ranking is
robust." **`i18n:check` validates key parity, not content**, so it could never have caught this.
All three retranslated. Worth internalizing: a translated catalog is a place where a corrected
claim silently persists.

## A guard that worked

`tenancy-coverage.test.ts` failed closed on the new `scheduler_heartbeat` table because it was
not classified as scoped or exempt. That guard was built by a prior run precisely so a new table
cannot be added tenancy-blind. It cost one line and caught a real omission.

## Verification

| Gate | Before | After |
|---|---|---|
| `tsc --noEmit` | 0 | 0 |
| node unit | 1389 | **1404** |
| python | 793 OK | **797 OK** |
| `i18n:check` | 3233 × 4 | 3233 × 4 |
| `next build` | ✓ | ✓ |

Every fix confirmed **non-vacuous** against pre-fix code — by hardcoding `qualifiedDelta = 0`,
by reverting `KINDS`, by restoring `return "healthy"`, and by running the new eval assertions
against the old source (2 FAIL, 3 ERROR on missing helpers).

## Patterns (catalogue items 13–16)

13. **A gate with no failing branch is decoration.** Ask of every check: *what input makes this
    report FAIL?* If you cannot name one, it is not protecting anything. Uncovered inputs must
    fail closed or be loudly reported — never dropped from the denominator.
14. **Absence must never read as health.** No heartbeat, no golden, no sample, no signal — each
    is "unknown", a state distinct from "fine". Model it explicitly.
15. **A feature implemented at both ends can still be dead in the middle.** The paste penalty
    existed and the client emitted the event; five intermediate hops silently dropped it. When a
    control "exists", trace the signal end to end before believing it.
16. **`i18n:check` validates parity, not truth.** A corrected claim in `en.json` leaves the other
    locales asserting the old, now-false statement. Grep translated copy whenever a fix changes
    what the product *claims*.

## What remains

Criticals: 9/9 closed. Highs: **18 of 66 closed**, 48 open.
Next per the INDEX: Wave 5 (hiring correctness) — partially done, see `FIXES-WAVE-5.md`.
