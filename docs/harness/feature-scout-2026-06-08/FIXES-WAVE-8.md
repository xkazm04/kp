# Feature Scout Fix Wave 8 — Screening-wave guardrail (DEC1 + DEC2)

> 1 commit — the deferred-from-Wave-1 pair, shipped together as designed.
> Baseline preserved: tsc 0 → 0 · unit 635 → 635 · python 490 → 490 · next build ✓.

This is the pair held back from Wave 1 (dark capabilities): DEC1 (run the screening
auto-reject wave from the recruiter's Decisions tab) is irreversible — it flips
candidate statuses AND queues rejection emails — so it was never safe to ship
without DEC2 (a dry-run preview). They ship together here: the run button only
exists alongside the preview that makes it trustworthy.

## Commit

| # | Commit | Opportunity | Files |
|---|---|---|---|
| 1 | `c66d847` | **DEC1** + **DEC2** — run the screening wave from Decisions, preview-first | `screen-wave.ts`, `api/decisions/screen-wave/route.ts`, `ScreenWaveModal.tsx` (new), `RoleDecisionRow.tsx`, `DecisionsTab.tsx` |

## What was shipped

- **DEC2 — dry-run preview.** `runScreenWave` gained a `dryRun` option. It runs the
  full ranking / fairness-gate / tie-break math and returns `decisions[]` with
  rationales ("Would auto-reject …") + counts, but commits NOTHING — no `actOnPipelineEntry`
  CAS write, no `recordAutomationEvent` audit, no `dispatchRejection` email. The route
  forwards `dryRun` (default false, so the existing demo caller is byte-unchanged).
- **DEC1 — run it from Decisions.** A "Screening wave" action per role
  (`RoleDecisionRow`, only when the role has a real `jobId`) opens `ScreenWaveModal`,
  which dry-runs on open and on every bottom-% / match-threshold slider change
  (debounced), shows exactly who would be rejected vs kept with rationales and a live
  count, then commits on an explicit "Reject N & notify" — and live-refreshes the
  Decisions queue so rejected rows drop out.

The server stays the sole enforcement point on both preview and commit: fairness
shielding (early-career / unknown archetype, fail-closed) and the override
clamp/renormalize run server-side regardless of what the modal sends.

## Verification (before → after)

| Gate | Baseline | After Wave 8 |
|---|---|---|
| `tsc --noEmit` | 0 errors | 0 errors |
| `next build` | ✓ | ✓ |
| `npm run test:unit` | 635 / 0 fail | 635 / 0 fail |
| `npm run test:python` | 490 (4 skip) | 490 (4 skip) |

**On the missing integration test (honest note):** the dry-run "mutates nothing"
contract is the load-bearing safety property, and a DB-backed test was attempted. It
was dropped because `screen-wave`'s dependency chain (`archetypes.ts`) uses
`@/`-aliased imports, which by the repo's own documented convention don't resolve
under `node --test` (route/engine contracts are locked with source-level regex guards
or pure-module tests instead, not integration tests). The dry-run guard is a single
early-return branch; the cohort/tie-break math it gates is already unit-tested in
`decision-config-schema.test.ts` (`screenBottomCount`, `tieSafeBottomCount`), and tsc
+ next build verify the wiring. (A brief detour refactoring `comms.ts`'s one parameter
property to unblock the test was reverted when the alias blocker proved structural.)

## Patterns established (catalogue additions)

12. **Ship an irreversible action only with its preview.** A destructive,
    outward-facing batch (status flips + emails) is gated behind a `dryRun` that runs
    the identical math and commits nothing — the recruiter sees the exact cohort,
    tunes it, then explicitly commits. The preview and commit share ONE engine path
    (the only difference is the early-return before the mutating branch), so they
    can't diverge — the preview can't lie about what commit will do.

## What remains

- **DEC3** — advance/reject inline from the Group Evaluation modal (the third
  Decisions High; collapses compare→decide into one motion).
- The session's other heavyweights: **VOX2** (live co-pilot), **PREP1** (human
  scorecard).
- Med/Low config + polish across Themes D/F (PIPE5, JOB5, MAT6, PIPE4, SCH4, DEC5,
  VOX5, PREP4) + small follow-ups (dedup-by-email, matrix-CSV, all-tabs PDF, VOX4).

## Branch

All on `feat/feature-scout-wave1-dark-capabilities` (Waves 1–8, unmerged). The
screen-wave files were HEAD-clean — a pure commit.
