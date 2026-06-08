# Feature Scout Fix Wave 14 — Human scorecards into the interview-review surfaces (PREP1 follow-up)

> 1 commit on `main`. Closes the PREP1 cross-surface follow-up.
> Baseline preserved: tsc 0 → 0 · unit 635 → 635 · python 490 → 490 · next build ✓.

## Commit

| # | Commit | Opportunity | Files |
|---|---|---|---|
| 1 | `d26aef6` | **PREP1 follow-up** — human scorecards in the compare grid + transcript modal | `api/interview/compare/route.ts`, `CompareInterviews.tsx`, `InterviewTranscriptModal.tsx` |

## What was shipped

PREP1 (Wave 10) recorded a human scorecard on the prep artifact and surfaced it in
the prep modal + the candidate drawer. The interview-*review* surfaces still showed
only the AI voice-screen scorecard. This folds the human one in:

- **Compare grid** — `/api/interview/compare` enriches each candidate with
  `getHumanScorecard(entryId)`; `CompareInterviews` shows a "human: <verdict>" badge
  in the column header and the human ratings + evidence in the per-candidate evidence
  card, distinct from the AI list. A recruiter comparing a pool now sees both verdicts
  side by side.
- **Transcript modal** — adds a "Human scorecard" section (same rubric layout as the
  AI one, coral-tinted so they're never confused) via a `/api/interview-prep` fetch.
  It renders even when there's **no voice session** (a human-led round), so the modal
  isn't a dead end for candidates screened only by a human.

Both reuse `getHumanScorecard`. These are AI-session-gated surfaces (`interviewedForJob`
lists voice-interviewed candidates), so a human-only candidate still shows in the
drawer + the transcript modal but not the compare grid — a documented scope, not a gap.

## Verification

| Gate | Baseline | After Wave 14 |
|---|---|---|
| `tsc --noEmit` | 0 | 0 |
| `next build` | ✓ | ✓ |
| `npm run test:unit` | 635 | 635 |
| `npm run test:python` | 490 (4 skip) | 490 (4 skip) |

## Interview-Prep / human scorecard — fully landed

PREP1 (W10) + this follow-up (W14) close the human-scorecard loop end to end: fill
(prep modal) → store (prep artifact) → read on the board (drawer), in the compare grid,
and in the transcript modal. The only thing NOT integrated is the Decisions
*scorecard-review approval gate* — that's an AI-pipeline approval (`scorecard_review`
via `runInterviewScorecard`), a different mechanism than displaying a scorecard;
wiring a human scorecard to trigger/satisfy that gate would be its own change.

## Session-wide remaining

- Heavyweight: **VOX2** (live co-pilot — needs in-flight transcript streaming).
- Med/Low: PIPE4, SCH4, DEC5, VOX5, PREP4, PREP5, PIPE5, JOB5, DEC6, MAT5,
  dedup-by-email, all-tabs PDF, VOX4.

## Branch / merge note

Committed on `main` (post-merge). `main` now 47 commits ahead of `origin/main`,
unpushed. Pre-existing idea-batch WIP untouched.
