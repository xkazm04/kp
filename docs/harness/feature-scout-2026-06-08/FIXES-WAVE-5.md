# Feature Scout Fix Wave 5 — Human decision record (Theme E)

> 4 commits, 4 of 5 shipped (PIPE3, DEC4, PREP2, RES5). Only PREP1 (human scorecard) remains.
> Baseline preserved: tsc 0 → 0 · unit 630 → 630 · python 486 → 486 · next build ✓.

Theme E is "make the human decision auditable" — see how a candidate got here, and
record what the recruiter decided + why. Four of the five shipped: two reuse storage
that already existed (the events table), two add small, bounded persistence (progress
on the prep artifact's payload; two columns on `analyses`). Only PREP1 — a whole new
human-scoring surface — remains.

## Commits

| # | Commit | Opportunity | Files |
|---|---|---|---|
| 1 | `43e7b5c` | **PIPE3** — per-candidate activity timeline in the drawer | `db.ts`, `api/pipeline/events/route.ts`, `CandidateDrawer.tsx` |
| 2 | `6f8efa7` | **DEC4** — decision note on advance/reject | `db.ts`, `DecisionsTab.tsx`, `AnalysisSummaryModal.tsx` |
| 3 | `50f1729` | **PREP2** — persist prep checklist + interviewer notes | `interview-prep.ts`, `api/interview-prep/route.ts`, `InterviewPrepModal.tsx` |
| 4 | `07ed9af` | **RES5** — analysis disposition + note | `db.ts`, `api/analyses/[slug]/route.ts`, `api/analyses/route.ts`, `DispositionEditor.tsx`, `history/[slug]/page.tsx`, `HistoryTab.tsx` |

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
- **PREP2 — persist the prep checklist + notes.** The coverage checklist was in-memory
  `useState`, lost on close, with nowhere to jot the verbatim quotes the rubric asks
  for. Ticks + a notes field now persist onto the existing prep artifact (a reserved
  `userProgress` key in `payload_json` — no schema change, the generated plan +
  `created_at` untouched) via `PUT /api/interview-prep?entry=` (bounded checked map +
  capped notes). The modal hydrates once, debounce-autosaves edits, and a regenerate
  clears it.
- **RES5 — analysis disposition + note.** The report was read-only despite the
  AiDisclosure promise of a human decision. Migrated `analyses.disposition` +
  `decision_note`, a `setAnalysisDisposition` store fn, and `PATCH
  /api/analyses/[slug]`. The history detail header gained a `DispositionEditor`
  (advance/hold/pass + optional reason, autosaved, `print:hidden`); the history list
  shows a decision pill per row. Pairs with DEC4 to make the decision auditable on the
  analysis surface as well as the pipeline.

## Verification (before → after)

| Gate | Baseline | After Wave 5 |
|---|---|---|
| `tsc --noEmit` | 0 errors | 0 errors |
| `next build` | ✓ | ✓ |
| `npm run test:unit` | 630 / 0 fail | 630 / 0 fail |
| `npm run test:python` | 486 (4 skip) | 486 (4 skip) |

PIPE3/DEC4 added no schema; PREP2 stores under the artifact payload (no migration);
RES5's two `analyses` columns are additive + migrated (ALTER ADD in the idempotent
block, NULL on legacy rows). The unit suite (which exercises the analyses store) stayed
green.

## Patterns established (catalogue additions)

9. **Wire the dormant plumbing before building new storage.** DEC4 shipped by passing
   a `detail` already threaded through the route + rendered by the audit log —
   accept/reject just never recorded it. When the storage + display already exist,
   the fix is the one missing arg, not a new column. (The Theme-A "dark capability"
   shape, applied to a data field rather than a whole backend.)

## What remains (deferred — the one heavyweight)

- **PREP1 — human interviewer scorecard.** Let a human fill the archetype-correct
  rubric (`rubricForArchetype`, with BARS anchors) live from the prep modal and save
  it as a `Scorecard` tagged `source:"human"` keyed on `entry.id`, so human ratings
  flow into the same Decisions / `CompareInterviews` surfaces as the AI ones. A new
  scoring surface, not a wire-up: a human-scorecard store (sibling of the AI one), a
  `POST /api/interview-prep/scorecard`, per-competency rating rows + evidence textareas
  (which PREP2's notes can seed), and the read paths in Decisions/compare. Sized for a
  focused session of its own. PREP2 (just shipped) laid the persistence groundwork.
- Themes F–G (recruiter config, AI-assist) + DEC1+DEC2 remain in `INDEX.md`.

## Branch

All on `feat/feature-scout-wave1-dark-capabilities` (Waves 1–5, unmerged). The db.ts
and AnalysisSummaryModal.tsx commits carry adjacent uncommitted idea-batch WIP.
