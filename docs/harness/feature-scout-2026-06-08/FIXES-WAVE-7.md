# Feature Scout Fix Wave 7 — AI-assist enrichments (Theme G)

> 2 commits — the two pure-client High items shipped (VOX3, MAT2). VOX2 (live co-pilot) is deferred.
> Baseline preserved: tsc 0 → 0 · unit 630 → 635 (+5 matrix-stats tests) · python 490 → 490 · next build ✓.

Theme G layers an AI/stat assist over data already captured. Two of the three are
pure-client reads of existing data; the third (VOX2) needs a real change to the
live voice runtime (stream the in-flight transcript) and is deferred like the
session's other heavyweights.

## Commits

| # | Commit | Opportunity | Files |
|---|---|---|---|
| 1 | `a996890` | **VOX3** — link scorecard evidence to transcript turns | `InterviewTranscriptModal.tsx` |
| 2 | `73f0dd1` | **MAT2** — per-role distribution + stats in the Fit Matrix | `matrix-stats.ts` (+ test), `MatrixShared.tsx`, `MatrixTab.tsx` |

## What was shipped

- **VOX3 — evidence → transcript anchoring.** The scorecard's verbatim evidence
  quotes and the full transcript were disconnected, so validating a contested rating
  meant scanning the whole transcript. Each evidence quote whose source turn can be
  found is now a clickable anchor that scrolls to + ring-highlights that turn
  (containment match, distinctive-word-overlap fallback; falls back to plain text
  when nothing matches well, so a paraphrased quote isn't mis-anchored). Cited turns
  are badged. Pure client — no API/schema. Turns the Interview→Offer gate from "trust
  the AI" into "verify it in one click."
- **MAT2 — Fit Matrix column distribution.** Each position header gained a compact
  strip: a 5-bar histogram of the column's non-blocked scores (bands mirror the
  legend) + best / median / strong-count (≥72), computed client-side over the whole
  pool from `data.cells`. Reads "deep bench vs one lucky hit" at a glance. The pure
  stats live in a testable `matrix-stats.ts`.

## Verification (before → after)

| Gate | Baseline | After Wave 7 |
|---|---|---|
| `tsc --noEmit` | 0 errors | 0 errors |
| `next build` | ✓ | ✓ |
| `npm run test:unit` | 630 / 0 fail | 635 / 0 fail (+5 matrix-stats) |
| `npm run test:python` | 490 (4 skip) | 490 (4 skip) |

Both pure-client; no schema, no Python, no concurrency surface.

## Patterns established (catalogue additions)

11. **AI-assist is usually a read over data you already have.** VOX3 (anchor quotes
    to turns) and MAT2 (column distribution) added zero storage — they re-present the
    scorecard + matrix data already on screen. The "AI" value is in the connection /
    summary, not new capture. Match the substring/stats math with a guard (VOX3
    returns -1 rather than mis-anchor; MAT2 returns null best/median on an empty
    column) so the assist degrades honestly.

## What remains (deferred — the heavyweight)

- **VOX2 — recruiter live co-pilot.** Watch the in-flight transcript against the
  run-of-show while the call is `in_progress`, with the prep checklist auto-ticking.
  Unlike VOX3/MAT2 this is NOT a read of existing data: the live transcript exists only
  in the candidate's browser and isn't persisted until `/complete`, so it needs the
  candidate side to stream partial turns (periodic POST or an SSE keyed by sessionId)
  + a recruiter monitor pane. A real change to the live voice runtime — its own
  focused session.
- VOX4 (transcript auto-summary digest), VOX3-for-CompareInterviews, and the MAT2
  row-level counterpart (how many roles a candidate is strong for) are smaller
  follow-ups in `INDEX.md`.

## Branch

All on `feat/feature-scout-wave1-dark-capabilities` (Waves 1–7, unmerged). Both
commits were HEAD-clean — pure.
