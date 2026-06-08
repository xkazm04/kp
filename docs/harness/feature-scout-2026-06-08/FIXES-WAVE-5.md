# Feature Scout Fix Wave 5 — Human decision record (Theme E)

> 2 commits — the decision-record core shipped (PIPE3, DEC4). The 3 persistence-heavy items (PREP1, PREP2, RES5) are deferred.
> Baseline preserved: tsc 0 → 0 · unit 630 → 630 · python 486 → 486 · next build ✓.

Theme E is "make the human decision auditable" — see how a candidate got here, and
record why a recruiter advanced or rejected them. The two shipped items deliver
that core by reusing storage that already existed (the events table); the deferred
three each need NEW persistence (a scorecard, checklist state, an analysis
disposition column), which is a heavier, separate body of work.

## Commits

| # | Commit | Opportunity | Files |
|---|---|---|---|
| 1 | `43e7b5c` | **PIPE3** — per-candidate activity timeline in the drawer | `db.ts`, `api/pipeline/events/route.ts`, `CandidateDrawer.tsx` |
| 2 | `6f8efa7` | **DEC4** — decision note on advance/reject | `db.ts`, `DecisionsTab.tsx`, `AnalysisSummaryModal.tsx` |

## What was shipped

- **PIPE3 — per-candidate history.** The event taxonomy + the global activity feed
  existed, but the candidate drawer showed only AI actions + the latest interview
  outcome. Adds `listPipelineEventsForEntry` + a `GET /api/pipeline/events?entry=<id>`
  mode (full, oldest-first, recruiter-keyed — not the anonymized public feed) and a
  "History" section in the drawer reusing `EventDot` + `eventVerb`: applied → screened
  → advanced → scheduled → moved → … No schema change — the events were already there.
- **DEC4 — decision note.** The per-decision note plumbing existed end-to-end (route
  forwards `body.detail`; `DecisionLog` renders `d.detail`) but `actOnPipelineEntry`'s
  accept/reject branches ignored it, so every human decision logged a blank reason.
  Now the advanced/rejected events record the optional note; the Decisions analysis
  modal has a "Decision note" field; `act`/`decide` thread it as `detail`. The
  "why was this candidate rejected?" audit answer now exists — storage + display were
  already there, only the capture + one `recordEvent` arg were missing.

## Verification (before → after)

| Gate | Baseline | After Wave 5 |
|---|---|---|
| `tsc --noEmit` | 0 errors | 0 errors |
| `next build` | ✓ | ✓ |
| `npm run test:unit` | 630 / 0 fail | 630 / 0 fail |
| `npm run test:python` | 486 (4 skip) | 486 (4 skip) |

## Patterns established (catalogue additions)

9. **Wire the dormant plumbing before building new storage.** DEC4 shipped by passing
   a `detail` already threaded through the route + rendered by the audit log —
   accept/reject just never recorded it. When the storage + display already exist,
   the fix is the one missing arg, not a new column. (The Theme-A "dark capability"
   shape, applied to a data field rather than a whole backend.)

## What remains (deferred — new persistence, heavier)

- **PREP1 — human interviewer scorecard.** Let a human fill the archetype-correct
  rubric and save it as a `Scorecard` (today the only scorecard is AI-synthesized).
  Needs a human-scorecard store + a fillable rubric UI.
- **PREP2 — persist the prep checklist + interviewer notes.** The prep modal's
  checklist state is in-memory, lost on close; persist it per entry + add a notes
  field. Needs a checklist/notes store.
- **RES5 — analysis report disposition + note.** A disposition (advance/hold/pass) +
  note on a saved analysis. Needs `analyses.disposition`/`decision_note` columns + a
  PATCH + UI (pairs with RES3's deferred tagging).
- Themes F–G (recruiter config, AI-assist) + DEC1+DEC2 remain in `INDEX.md`.

## Branch

All on `feat/feature-scout-wave1-dark-capabilities` (Waves 1–5, unmerged). The db.ts
and AnalysisSummaryModal.tsx commits carry adjacent uncommitted idea-batch WIP.
