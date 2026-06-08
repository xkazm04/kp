# Feature Scout Fix Wave 9 — Decide from the comparison (DEC3)

> 1 commit — completes the Decisions group's High items (DEC1+DEC2 in Wave 8, DEC4 in Wave 5, DEC3 here).
> Baseline preserved: tsc 0 → 0 · unit 635 → 635 · python 490 → 490 · next build ✓.

## Commit

| # | Commit | Opportunity | Files |
|---|---|---|---|
| 1 | `f9f4c4e` | **DEC3** — advance/reject inline from the Group Evaluation modal | `GroupEvalModal.tsx`, `DecisionsTab.tsx` |

## What was shipped

- **DEC3 — decide from the comparison.** The group eval (ranked order, fairness
  matrix, per-candidate strengths/gaps) was read-only — acting meant closing it and
  reopening a per-candidate modal one at a time, splitting the decision context from
  the decision. Each candidate's detail tab now carries inline **Advance / Reject**
  buttons (and each tab badges its decided outcome). DecisionsTab resolves the eval
  candidate by label back to the live pipeline entry and runs the SAME `act()` —
  reusing the `expectedStage` CAS + comms as the queue. Decided candidates collapse to
  an "Advanced"/"Rejected" pill (the live queue moved them underneath); the modal
  stays open so the recruiter works the whole pool in one sitting. Read-only for the
  simulation (no `onDecide` → no buttons).

## Verification

| Gate | Baseline | After Wave 9 |
|---|---|---|
| `tsc --noEmit` | 0 | 0 |
| `next build` | ✓ | ✓ |
| `npm run test:unit` | 635 | 635 |
| `npm run test:python` | 490 (4 skip) | 490 (4 skip) |

## Decisions group — status after this wave

The "Decision Workflow & Group Eval" context report's three High items are now all
shipped, plus its one Medium decision-record item:
- **DEC1** (run the screening wave) — Wave 8
- **DEC2** (dry-run preview) — Wave 8
- **DEC3** (decide from the group eval) — this wave
- **DEC4** (decision note on advance/reject) — Wave 5

Remaining from that report: **DEC5** (per-role rule overrides + auto-advance threshold,
Med — builds on the decision-config-store) and **DEC6** (reviewer calibration /
second-opinion, Low).

## What remains (session-wide)

- Heavyweights: **VOX2** (live co-pilot), **PREP1** (human scorecard).
- Med/Low config + polish: PIPE4, SCH4, DEC5, VOX5, PREP4, PIPE5, JOB5, MAT6,
  dedup-by-email, matrix-CSV, all-tabs PDF, VOX4, DEC6, "advance lead + reject rest"
  batch shortcut (wants a preview).

## Branch

All on `feat/feature-scout-wave1-dark-capabilities` (Waves 1–9, unmerged). Pure commit.
