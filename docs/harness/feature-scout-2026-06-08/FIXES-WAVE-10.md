# Feature Scout Fix Wave 10 — Human interviewer scorecard (PREP1)

> 1 commit — the larger of the two session heavyweights. Completes the Interview-Prep group's High items.
> Baseline preserved: tsc 0 → 0 · unit 635 → 635 · python 490 → 490 · next build ✓ (56 → 57 routes).

## Commit

| # | Commit | Opportunity | Files |
|---|---|---|---|
| 1 | `e8af054` | **PREP1** — human interviewer scorecard from the prep rubric | `interview-scorecard.ts`, `interview-prep.ts`, `api/interview-prep/scorecard/route.ts` (new), `HumanScorecardPanel.tsx` (new), `InterviewPrepModal.tsx`, `CandidateDrawer.tsx` |

## What was shipped

The only scorecard was AI-synthesized from the voice screen — when a human ran the
round there was nowhere to record per-competency ratings + evidence, though the
archetype-correct rubric (`rubricForArchetype`, with BARS anchors) already existed
and rendered in the compare grid. PREP1 closes the prep → live-interview → scorecard
loop for human-led rounds:

- **`HumanScorecardPanel`** in the prep modal renders `rubricForArchetype(entry.archetype)`
  — each competency with its anchors + a 1..`RATING_MAX` selector + an evidence field,
  plus an overall advance/hold/reject verdict and a summary. Hydrates from the saved
  artifact; collapsed by default (not every prep view is a scoring session).
- **`POST /api/interview-prep/scorecard?entry=`** validates field-by-field (bounded
  competency, rating clamped to [1, RATING_MAX], capped evidence/summary, coerced
  recommendation) and persists a `source:"human"` `Scorecard` onto the prep artifact's
  payload — reusing PREP2's `userProgress`/`humanScorecard` seam, so no schema change
  and the generated plan + `created_at` are untouched.
- **`Scorecard.source`** ("ai" default / "human") added so a surface showing both can
  label them. The **CandidateDrawer** reads the saved human scorecard (best-effort,
  via the existing `/api/interview-prep` GET) and shows it alongside the AI "Interview
  outcome" — so a hand-scored round is visible where recruiters work the board, not
  siloed in the prep modal.

## Verification

| Gate | Baseline | After Wave 10 |
|---|---|---|
| `tsc --noEmit` | 0 | 0 |
| `next build` | ✓ (56 routes) | ✓ (57 routes — new scorecard route) |
| `npm run test:unit` | 635 | 635 |
| `npm run test:python` | 490 (4 skip) | 490 (4 skip) |

## Interview-Prep group — status

All three High items of the "Interview Prep & Rubric" report are now shipped:
- **PREP1** (human scorecard) — this wave
- **PREP2** (persist checklist + notes) — Wave 5
- **PREP3** (copy the prep guide) — Wave 3

Remaining from that report: PREP4 (editable questions + role question bank, L),
PREP5 (interviewer assignment, Med), PREP6 (show rubric anchors in prep, Low —
substantially subsumed: the scorecard panel now shows the anchors).

## Patterns reinforced

- **PREP2's payload seam scales.** A second piece of human-entered interview state
  (the scorecard) rode the same reserved-key-in-`payload_json` pattern as the
  checklist/notes — no migration, no new table, both survive a regenerate-clears reset
  independently. Establishes the prep artifact as the home for per-entry human inputs.

## What remains (session-wide)

- Heavyweight: **VOX2** (live co-pilot — the one item needing a real voice-runtime
  change: streaming the in-flight transcript before `/complete`).
- Cross-surface follow-up for PREP1: merge human scorecards into the Decisions queue +
  CompareInterviews grid (they read AI scorecards from `interview_sessions`).
- Med/Low config + polish across Themes D/F + the small follow-ups.

## Branch

All on `feat/feature-scout-wave1-dark-capabilities` (Waves 1–10, unmerged). Pure commit.
