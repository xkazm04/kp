# Feature Scout Fix Wave 3 — Export & share (Theme C) ✅ COMPLETE

> 4 commits, ALL 5 export/share opportunities shipped (MAT4, SCH1, RES1, PREP3, RES6) + a shared, tested toolkit.
> Baseline preserved: tsc 0 → 0 · unit 624 → 630 (+6 export-toolkit tests) · python 486 → 486 · next build ✓.

Theme C is "get this off the screen." Hiring decisions happen in meetings, email
threads, and calendars *outside* the app — every one of these surfaces generated
useful content that had no way to leave. The fix is one small client-side toolkit
reused across five surfaces, not five bespoke exporters.

## Commits

| # | Commit | Opportunity | Files |
|---|---|---|---|
| 1 | `b371f8d` | **MAT4** + shared toolkit | `export-utils.ts` (+ test), `Results.tsx` |
| 2 | `7584493` | **SCH1** — .ics on the booked card | `api/schedule/[token]/route.ts`, `SchedulePicker.tsx` |
| 3 | `eb41f6e` | **RES1** — copy link + print on the report | `ReportActions.tsx` (new), `history/[slug]/page.tsx` |
| 4 | `8cc237a` | **PREP3** + **RES6** — copy prep / copy report lists | `InterviewPrepModal.tsx`, `results/shared.tsx` |

## What was shipped

- **Shared toolkit (`app/_lib/export-utils.ts`).** `toCsv` (RFC-4180-ish quoting),
  `buildIcs` (single-event VCALENDAR, UTC stamps, RFC-5545 text escaping), plus the
  browser helpers `downloadFile` (Blob + object URL) and `copyText` (clipboard). The
  two pure serializers are pinned by `export-utils.test.ts` (6 cases) — the
  load-bearing escaping/format logic, tested in isolation.
- **MAT4 — CSV export of ranked matches.** "Export CSV" in the Match results header
  (rank, role, company, score, confidence band, fit tier, matched/missing skills),
  built from on-screen data, no backend call.
- **SCH1 — .ics on the booked confirmation.** A confirmed slot lived only as text in
  an email (the top no-show cause). The booked card now offers "Add to calendar",
  building a single-event .ics from the confirmed slot + duration. The public invite
  projection now exposes `slotAt` (the candidate's own time), and a fresh confirm
  adopts the server's returned invite so the download works immediately.
- **RES1 — copy/print the candidate report.** A `ReportActions` bar on the history
  detail header: "Copy report link" (the stable `/history/<slug>` URL reopens the
  exact report) and "Print / Save as PDF". Scoped to the history page (the Analyze tab
  has no stable URL to share).
- **PREP3 — copy the interview prep guide.** "Copy prep" serializes the whole guide
  (scenario, run-of-show with questions + follow-ups, signals) to the clipboard.
- **RES6 — copy the report's reusable lists.** `ListBlock` (talking points, must-prove
  evidence, CV rewrite suggestions) gains a header "Copy" → markdown bullets.

## Verification (before → after)

| Gate | Baseline | After Wave 3 |
|---|---|---|
| `tsc --noEmit` | 0 errors | 0 errors |
| `next build` | ✓ | ✓ |
| `npm run test:unit` | 624 / 0 fail | 630 / 0 fail (+6 export-toolkit tests) |
| `npm run test:python` | 486 (4 skip) | 486 (4 skip) |

All client-side except SCH1's one-line projection addition (`slotAt`, the candidate's
own confirmed time) — no schema changes, no concurrency surface, lowest-risk wave.

## Patterns established (catalogue additions)

6. **One toolkit, many surfaces.** An "export/share" theme is a shared
   serializer/clipboard/download module reused across surfaces, not per-surface
   bespoke code — `toCsv`/`buildIcs`/`downloadFile`/`copyText` each have one home and
   one test. Adding the next export surface is wiring, not new logic.
7. **`print:hidden` on action chrome.** Copy/print/export buttons carry the Tailwind
   `print:hidden` class so they never appear in a printed/PDF'd report.

## What remains

- **MAT4 (matrix half)** — the Fit Matrix cross-tab CSV export (the Match-results half
  shipped); pairs with the still-deferred MAT3 matrix multi-select.
- **RES1 (full-fidelity PDF)** — `window.print` captures the active report tab; an
  all-tabs print view is a polish follow-up.
- Themes D–G (search/filter, decision-record, config, AI-assist) + DEC1+DEC2 remain in
  `INDEX.md`.

## Branch

All on `feat/feature-scout-wave1-dark-capabilities` (Waves 1–3, unmerged).
