# Feature Scout — Analysis Results & Reporting (kp)

> Total: 6 opportunities (High: 3, Medium: 2, Low: 1)
> Files read: ~16

## 1. Shareable / printable candidate report (PDF + share link)
- **Value**: High
- **Category**: feature
- **Effort**: M
- **Where it slots in**: `app/history/[slug]/page.tsx:50` — the history detail header that already renders the full `ResultPanel` at a stable, linkable URL.
- **Gap**: The report has no export at all. Grep across `app/` finds zero `window.print`, `jsPDF`, `toBlob`, or `application/pdf` on any results surface — the only copy/share affordances in the app are JD-markdown copy (`JdBody.tsx`) and apply-token links (`ApplyTokenPill.tsx`). A recruiter who wants to send a hiring manager the job-fit read has nothing to hand over but the raw app URL.
- **Opportunity**: A "Share / Export" action in the detail header: (a) "Copy report link" (the `/history/<slug>` URL is already stable and persisted), and (b) "Download PDF" / print-to-PDF rendering the report in a clean print stylesheet. Optionally a read-only token route so the link works without auth.
- **Why it matters**: Recruiters live in email and ATS handoffs; a portable candidate report is the most-requested artifact a hiring tool produces.
- **Sketch**: New `ReportActions.tsx` in the `history/[slug]/page.tsx` header; "Copy link" via `navigator.clipboard` (pattern in `JobPostingModal.tsx`); PDF via a `print:` Tailwind stylesheet + `window.print()`.

## 2. Push candidate from the report straight into the pipeline
- **Value**: High
- **Category**: integration
- **Effort**: S
- **Where it slots in**: `app/_components/results/ResultPanel.tsx:111` (report header, no actions today); `app/features/sub_match/Results.tsx:23` already shows the working `addToPipeline` → `POST /api/pipeline` flow.
- **Gap**: After reviewing a result a recruiter likes, there's no way to act from the report. `addToPipeline` exists only in Match and `RecruiterCandidates.tsx`; the analysis report (Analyze tab + history detail) is a dead end — they must navigate away, re-find the candidate, and re-add.
- **Opportunity**: An "Add to pipeline" CTA in the report header (when `analysis.jobFit`/`jd_slug` present) that POSTs to `/api/pipeline` with candidate label, role family, JD-derived job, and `jobFit.score` as `matchScore`, landing at the `Screened` stage.
- **Why it matters**: Closes the loop from "scored" to "in the funnel" in one click, reusing a proven API.
- **Sketch**: Reuse the `Results.tsx` `addToPipeline` shape; pass `analysis.jobFit.score` and `found.row.jd_slug`; guard behind `hasJobFit`.

## 3. Searchable / filterable history with tagging
- **Value**: High
- **Category**: functionality
- **Effort**: M
- **Where it slots in**: `app/features/sub_history/HistoryTab.tsx:62` (flat table) and `app/api/analyses/route.ts:8` (`listAnalyses(200)`, no query params).
- **Gap**: History is an un-queryable flat table — no search/filter/sort, no tagging, no disposition, no delete. The `analyses` table (`db.ts:134`) has only `score`/`role_family`/`seniority`/`jd_slug` and no `tags`/`status`. Past ~50 runs the table is unusable.
- **Opportunity**: A search input (candidate label/slug) plus filter chips for role family, seniority, JD, and score range, backed by query params on `/api/analyses`; plus a lightweight tag/disposition persisted on a new column.
- **Why it matters**: History is the recruiter's working memory; without filtering it stops being useful exactly when there's enough data to matter.
- **Sketch**: Extend `listAnalyses` with `q`/`roleFamily`/`seniority`/`jdSlug` (mirror `JobFilter` at `db.ts:919`); `ALTER TABLE analyses ADD COLUMN tags TEXT` in the existing migration block; client filter bar above the table.

## 4. Cross-analysis compare (pick two saved runs side by side)
- **Value**: Medium
- **Category**: feature
- **Effort**: M
- **Where it slots in**: `app/_components/results/compare/CompareTab.tsx:22` + `app/_lib/comparison.ts:34` (`buildComparison`).
- **Gap**: Compare only works for CV variants uploaded together in one multi-variant run (`hasRenderableComparison` gates on `comparison.variants`). Two candidates analyzed in separate runs against the same JD — the everyday "who's stronger, A or B?" — can't be compared; history rows open one at a time.
- **Opportunity**: A "Compare selected" action in `HistoryTab` — check 2-3 rows (ideally same `jd_slug`), feed their loaded payloads into the existing `buildComparison`, render `CompareTab`. The delta table, driver insights, and merged-recommendation engine already exist.
- **Why it matters**: Candidate-vs-candidate comparison is the core shortlisting decision and the rendering engine is already built — mostly wiring.
- **Sketch**: Row checkboxes in `HistoryTab.tsx`; `loadAnalysis` each slug (or new `/api/analyses/compare?slugs=`), call `buildComparison(inputs)`, render `<CompareTab>` on a `/history/compare` page.

## 5. Report-level disposition + decision note (human-in-the-loop record)
- **Value**: Medium
- **Category**: user_benefit
- **Effort**: S
- **Where it slots in**: `app/history/[slug]/page.tsx:50` header; persisted via a new column on `analyses` (`db.ts:603` `saveAnalysis`).
- **Gap**: The report is read-only — no place to record *why* a recruiter advanced or passed, or to note context for a teammate. `AiDisclosure` promises "a human reviews and makes every advance, offer, and rejection decision," but that decision is never captured against the analysis; the schema stores no disposition or note.
- **Opportunity**: A small "Decision" panel in the report header — disposition select (advance/hold/pass) + free-text note, persisted and shown on the history row. Pairs with #3's tagging.
- **Why it matters**: Turns the AI read into an auditable human decision, reinforcing the fairness/disclosure stance and sharing context across the team.
- **Sketch**: `ALTER TABLE analyses ADD COLUMN disposition TEXT, decision_note TEXT`; `PATCH /api/analyses/[slug]`; compact editor in the history header.

## 6. "Copy talking points / rewrite suggestions" quick-copy on report lists
- **Value**: Low
- **Category**: automation
- **Effort**: S
- **Where it slots in**: `app/_components/results/job-fit/JobFitTab.tsx:56` (Interview Talking Points / Must-Prove Evidence / CV Rewrite Suggestions) and the merged-bullets block at `CompareTab.tsx:205`.
- **Gap**: The report generates highly reusable text — talking points, must-prove evidence, rewrite bullets, merged headline/skills line — all render-only. A recruiter prepping an interview or coaching a CV has to hand-retype; no list block has a copy affordance.
- **Opportunity**: A "Copy" button on `ListBlock`/`BulletList` headers (and the merged headline/skills cards) that copies the list as plain text / markdown bullets.
- **Why it matters**: Cheap polish that makes the report's best output immediately actionable where it's meant to be used.
- **Sketch**: Optional `copyText` prop on `ListBlock` in `results/shared.tsx:148`; header button using `navigator.clipboard.writeText` (pattern in `JobPostingModal.tsx:41`).

---

_Cross-checks performed to avoid proposing existing features: confirmed no PDF/print/CSV/clipboard export on any results surface; `AiDisclosure` is already used on candidate-facing pages (offer/apply/schedule/interview) so it was not proposed; `addToPipeline` exists in Match/RecruiterCandidates but not in the report; Compare is variant-only with no cross-run path; `listAnalyses`/`/api/analyses` take no filter params and the `analyses` table has no tags/status/disposition columns._
