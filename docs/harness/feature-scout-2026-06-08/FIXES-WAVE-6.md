# Feature Scout Fix Wave 6 — Recruiter configuration (Theme F)

> 1 commit — the High item shipped (MAT1, full-stack through the Python scorer). The 5 Med/Low config items are deferred.
> Baseline preserved: tsc 0 → 0 · unit 630 → 630 · python 486 → 490 (+4 MAT1 tests) · next build ✓.

Theme F is "let the recruiter tune what's hardcoded." Its standout was MAT1 — the
matching engine already carried a bounded dynamic weight vector, but it was only
auto-proposed and read-only in Decisions; the recruiter ranking a pool couldn't
touch it. The remaining items each replace a different hardcoded constant with
config (per-stage SLA, availability windows, decision rules, languages, question
bank) — independent, mostly Med, work for follow-on passes.

## Commit

| # | Commit | Opportunity | Files |
|---|---|---|---|
| 1 | `87d05ce` | **MAT1** — recruiter-adjustable match weighting | `matching.py`, `match_cli.py`, `tests/test_matching.py`, `api/match/route.ts`, `MatchTypes.ts`, `MatchTab.tsx`, `Results.tsx`, `WeightsPanel.tsx` |

## What was shipped

- **MAT1 — recruiter-adjustable match weighting.** The Python scorer always had
  `resolve_weights` / `weight_bounds` / `score_job(weights=)`, used only by the
  Decisions auto-proposer. Now `match()` takes an optional `weights` override:
  resolved ONCE against the candidate's archetype (clamped to its bounds +
  renormalized to sum 1, so the client can't push an unfair or non-summing vector)
  and applied to every job, with the resolved vector + the archetype's bounds exposed
  on the response's candidate block. `match_cli` gained `--weights` (JSON; malformed →
  baseline); the route forwards a validated numbers-only object; the Match results
  gained a `WeightsPanel` — archetype-labelled, bounded sliders (Skills/Career/Personal
  or Foundation/Potential/Fit) that re-rank on apply and reset to the default. The
  fairness guarantee is preserved end-to-end: the slider can only move within the
  archetype's bounds, and the server re-clamps + renormalizes regardless of input.

## Verification (before → after)

| Gate | Baseline | After Wave 6 |
|---|---|---|
| `tsc --noEmit` | 0 errors | 0 errors |
| `next build` | ✓ | ✓ |
| `npm run test:unit` | 630 / 0 fail | 630 / 0 fail |
| `npm run test:python` | 486 (4 skip) | 490 (4 skip) — +4 MAT1 tests |

4 new Python tests pin MAT1's contract: baseline exposes resolved weights + bounds; an
adversarial override is clamped + renormalized; the override shifts the resolved
vector (and reaches the score breakdown); an empty proposal falls back to baseline.

## Patterns established (catalogue additions)

10. **Surface bounded engine power, don't reinvent it.** MAT1's whole value was
    *exposing* a weight vector the scorer already resolved + bounded — the UI just
    sends a proposal and the existing `resolve_weights` enforces fairness. When an
    engine already has a safe, bounded knob, the feature is a control + a passthrough,
    and the server stays the single enforcement point (the client can't push an
    out-of-bounds or non-summing vector — it's re-clamped server-side).

## What remains (deferred — Med/Low config items)

- **PIPE4 — per-stage SLA / aging thresholds.** Replace the single flat `STALE_DAYS`
  with per-stage thresholds (Offer 3d vs Accepted 14d), stored + editable, driving the
  board's aging cue + an `sla_breach` automation event. The clean "config store"
  embodiment of the theme.
- **SCH4 — recruiter-set interview availability windows.** Configurable proposal
  horizon instead of the hardcoded slots — touches the delicate `schedule-slots` area.
- **DEC5 — per-role rule overrides + auto-advance threshold** (builds on the existing
  `decision-config-store`).
- **VOX5 — per-role / per-session multi-language** beyond the hardcoded cs/en pair.
- **PREP4 — editable questions + a reusable role question bank** (L; builds on PREP2's
  persisted prep payload).
- Theme G (AI-assist) + DEC1+DEC2 + the Theme-E PREP1 scorecard remain in `INDEX.md`.

## Branch

All on `feat/feature-scout-wave1-dark-capabilities` (Waves 1–6, unmerged). MAT1's files
were all HEAD-clean — a pure commit.
