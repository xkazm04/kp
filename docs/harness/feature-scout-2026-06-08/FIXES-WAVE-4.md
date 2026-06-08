# Feature Scout Fix Wave 4 — Search, filter & saved views (Theme D)

> 2 commits, both HIGH items shipped (PIPE2, RES3). The 3 Med/Low items (PIPE5, JOB5, MAT6) are deferred.
> Baseline preserved: tsc 0 → 0 · unit 630 → 630 · python 486 → 486 · next build ✓.

Theme D is "find the candidate / run at realistic volume." Two list surfaces were
un-navigable past a few dozen items — the pipeline board and the analysis history.
Both fixes filter client-side over data already loaded, so neither needs a schema
or server change at current scale.

## Commits

| # | Commit | Opportunity | Files |
|---|---|---|---|
| 1 | `d8e0bfe` | **PIPE2** — board search + quick filters | `PipelineTab.tsx` |
| 2 | `e119cb9` | **RES3** — searchable + filterable history | `HistoryTab.tsx` |

## What was shipped

- **PIPE2 — board search + quick filters.** A filter bar above the board: free-text
  candidate/role search + quick-filter chips (Interview, Aging, Awaiting decision,
  Needs intake), narrowing the lanes + cards client-side (the board already holds
  every entry). Empty lanes drop out of a search; the summary StatChips stay full
  totals; the Aging chip now also toggles its filter; a "no matches" state replaces
  an empty board. Position grouping was extracted to one `groupPositions` so the full
  board (count) and the filtered board (lanes) key lanes identically.
- **RES3 — searchable + filterable history.** A filter bar on the History tab:
  free-text search (candidate or slug) + role-family and seniority dropdowns
  (populated from the loaded set), filtering the fetched rows client-side, with
  "X of Y" + Clear and a "no matches" state.

## Verification (before → after)

| Gate | Baseline | After Wave 4 |
|---|---|---|
| `tsc --noEmit` | 0 errors | 0 errors |
| `next build` | ✓ | ✓ |
| `npm run test:unit` | 630 / 0 fail | 630 / 0 fail |
| `npm run test:python` | 486 (4 skip) | 486 (4 skip) |

Both purely client-side — no schema, no server query, no concurrency surface.

## Patterns established (catalogue additions)

8. **Filter where the data already is.** For a bounded list already fully loaded in
   the client (the board's entries, history's ≤200 rows), client-side search/filter
   is the right, lowest-risk fit — no schema, no server query, no in-flight-fetch
   race. Reach for server-side query params + paging only when the set outgrows the
   fetch cap (noted on RES3 as the tagging/scale follow-up).

## What remains (deferred — Med/Low)

- **RES3 tagging + server-side query** — per-run tags (a `tags` column + PATCH + tag
  UI) and `/api/analyses` query params, for when history outgrows the 200-row fetch
  cap. Client filtering covers it at current scale.
- **PIPE5 — saved board views.** Named presets of {filter + position selection},
  persisted (localStorage or a `board_views` table), shown as pills above the board.
  Builds directly on PIPE2's filter state.
- **JOB5 — saved searches / candidate segments** for the sourcing surfaces.
- **MAT6 — Fit Matrix dimension-sort + minimum-fit filter** (Low) — the matrix is the
  third list surface; pairs with the deferred MAT3-matrix / MAT4-matrix work.
- Themes E–G (decision record, recruiter config, AI-assist) + DEC1+DEC2 remain in
  `INDEX.md`.

## Branch

All on `feat/feature-scout-wave1-dark-capabilities` (Waves 1–4, unmerged).
