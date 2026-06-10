# Feature Scout — Analytics & Diagrams (2026-06-10)

> Total: 6 (3H/2M/1L)

## 1. Make every analytics chart click through to the candidates behind it
- **Value**: High
- **Category**: user_benefit
- **Effort**: M
- **Where**: `app/features/sub_analytics/AnalyticsTab.tsx:86` (funnel rows), `:121` (bottleneck banner), `:176` (byJob rows); `app/features/sub_pipeline/PipelineTab.tsx:95-98` (filter state) + `app/features/tabs.ts:107` (deep-link helpers)
- **Gap**: The whole dashboard is display-only. The bottleneck banner says "9 candidates averaging 12 days in Screened" and the role table says "Backend Eng: 14 in pipeline, 2 reached interview" — but there is no path from any of those numbers to the actual candidates. Meanwhile the board already has a search + quick-filter bar (PIPE2) and the app has an established `?tab=X&param=` deep-link convention (MatchTab `?profile=`, JobsTab `?job=`), yet PipelineTab's `query`/`quick` state is purely local and never URL-initialized.
- **Proposal**: Teach PipelineTab to hydrate its filter bar from URL params (`?q=`, `?quick=`, plus a new `?stage=<FunnelStage>` filter — the one dimension the funnel needs that the quick chips don't cover). Then wrap the funnel rows, the bottleneck banner, and each byJob row in `Link`s built with the existing `buildUrl` helper (e.g. `/?tab=pipeline&stage=Screened`, `/?tab=pipeline&q=<jobTitle>`). Purely client-side; no schema or API change.
- **Why users need it**: Analytics that ends at a number forces the recruiter to re-find the cohort by hand; one click from "stuck in Screened" to those exact cards turns the dashboard from a report into a worklist.

## 2. Add time windows and a weekly trend to the all-time-only analytics
- **Value**: High
- **Category**: feature
- **Effort**: M
- **Where**: `app/api/analytics/route.ts:9` (GET takes no params), `app/_lib/db.ts:1679` (`pipelineAnalytics()` — unconditional `SELECT … FROM pipeline_entries`), `pipeline_events` table + `idx_pipeline_events_created` index (`db.ts:250-263`)
- **Gap**: Every figure is an all-time aggregate over the entries snapshot: there is no period selector, no comparison, and no notion of direction. "Hire rate 12%" and "avg time-to-hire 18 days" can never answer "is this month better than last?". The data to do it already exists twice over — entries carry `created_at`/`stage_changed_at`, and `pipeline_events` is a full dated history (applied/added/matched/advanced/rejected/offer_accepted…) with a created_at index that nothing aggregates.
- **Proposal**: Add a validated `?days=30|90` window param to `/api/analytics` (clamped like `/api/analytics/decisions` does) that scopes inflow/outcome metrics to entries/events in the window, keeping all-time as default. Add a window selector to the header stat cluster and one new "momentum" panel: per-week counts of applications, advances, rejections, and hires bucketed from `pipeline_events.created_at` (a single GROUP BY strftime query), rendered as small bars.
- **Why users need it**: Hiring is managed in weeks, not lifetimes; a recruiter (or their manager) needs "what happened since the screening wave / since we re-weighted matching" — trends are the only way the dashboard can show whether interventions worked.

## 3. Aggregate the automation-vs-human split into an "Automation impact" panel
- **Value**: High
- **Category**: feature
- **Effort**: M
- **Where**: `app/features/sub_analytics/DecisionLog.tsx:34-53` (`DECISION_META` — the auto/human taxonomy exists per-row only), `app/_lib/db.ts:2095` (`recordAutomationEvent` kinds: `auto_rejected`, `screening_hold`, `outreach_sent`, `rejection_sent` with "policy auto-reject" vs "manual reject" detail, `interview_invite_sent`, `offer_sent`, `onboarding_started`, …), `app/_lib/screen-wave.ts:149`
- **Gap**: The product's entire thesis (see the About tab and the funnel diagram: "auto-advance BAU, hold the rest") is automation with human gates — yet no surface answers "how much is the automation actually doing?". The DecisionLog labels each row auto/human but nothing counts them; auto-advances, screening holds (and how often a human later overturned vs confirmed them), auto-rejections from screening waves, and dispatched comms are all individually recorded events with zero aggregation.
- **Proposal**: Add an automation rollup to `pipelineAnalytics()` (or a sibling fn): GROUP BY `kind` over `pipeline_events`, folded through a shared auto/human kind map (extract `DECISION_META`'s attribution into a module both the log and the server import so they cannot drift). Render a panel beside "By archetype": decisions made by automation vs humans, auto-advance count, holds raised → resolved, auto-rejects, and comms delivered (outreach/invites/reminders/offers). Respect the window param from #2.
- **Why users need it**: It is the product's headline value ("the AI handled 78% of decisions this month; humans only touched the 22% it deliberately held") — needed both to trust the automation and to sell the tool, and today it's invisible.

## 4. Show source effectiveness: where do interviewed/hired candidates actually come from
- **Value**: Medium
- **Category**: feature
- **Effort**: S
- **Where**: `app/_lib/db.ts:1967-1975` (manual/intake adds record `added`), `db.ts:1566` (match fan-out records `matched`), `app/api/apply/[id]/route.ts:299` (inbound apply records `applied`); nothing reads these as origins
- **Gap**: Entries enter the pipeline three ways — inbound conversational apply, JD-save match fan-out/sourcing, and recruiter manual add — and each origin is durably distinguishable from the entry's earliest `pipeline_events` kind (`applied` / `matched` / `added`). The analytics surface slices by role and archetype but never by origin, so nobody can tell whether the apply channel or recruiter sourcing produces the candidates that reach Interview/Hired.
- **Proposal**: One query (earliest event kind per entry_id joined to `pipeline_entries`) feeding a small "Where candidates come from" card: per-origin total / reached-interview / hired / conversion %, mirroring the byJob row shape. No migration — origin is derived, not stored.
- **Why users need it**: Channel ROI is a core recruiting question; it tells the recruiter whether to invest in job-ad ingestion + apply links or in sourcing/outreach for a given role mix.

## 5. Filter the decision log and export analytics for hiring-manager reporting
- **Value**: Medium
- **Category**: functionality
- **Effort**: M
- **Where**: `app/api/analytics/decisions/route.ts:23-31` (only offset/limit), `app/features/sub_analytics/DecisionLog.tsx:90` (buildUrl), `AnalyticsTab.tsx:165` (byJob table); toolkit at `app/_lib/export-utils.ts:10` (`toCsv`) and `:77` (`downloadFile`)
- **Gap**: The decision log is an undifferentiated infinite scroll — no filter by attribution (auto/human), kind group, candidate, or role, so auditing "all rejections this week" means scrolling. And the Analytics tab is the one reporting surface with zero export, even though the shared export toolkit (W3) already powers CSV on Match results and the Matrix and print/copy on history reports.
- **Proposal**: Add `kind`/`attribution` filter params to `/api/analytics/decisions` (allow-listed against the known kinds) with chips above the log; add "Export CSV" via `toCsv`/`downloadFile` on the byRole table and the filtered decision log, and mark action chrome `print:hidden` so the existing print pattern (ReportActions) extends to the whole tab.
- **Why users need it**: Recruiters report upward — a hiring manager wants "this role's funnel + the decisions taken" as a file, and an auditable log is only auditable if you can isolate the rows you're answering for.

## 6. Localize the architecture surfaces (diagrams page, step drawer, coverage content)
- **Value**: Low
- **Category**: user_benefit
- **Effort**: M
- **Where**: `app/diagrams/page.tsx:38-57` + `:86-96` (hardcoded English chrome/blurbs), `app/diagrams/PipelineExplorer.tsx:8-12` (`STATUS_META` labels) and `:22` ("Click any step…"), `app/diagrams/pipelineSteps.ts:16` (step titles/summaries), `app/features/sub_about/AboutCoverageData.ts:19` (titles/leads/bodies)
- **Gap**: The app just shipped full bilingual i18n (en + cs, commit 7922fbe) and AboutTab's chrome is localized — but its entire content layer (coverage titles/leads/markdown bodies) plus the whole `/diagrams` page (header, legend, blurbs, drawer labels, step summaries) is hardcoded English. Verified: no `useTranslations`/`next-intl` import anywhere under `app/diagrams/`, and no `diagrams` namespace in `messages/en.json`/`cs.json`. A Czech user following About's own "Zobrazit úplnou architekturu" link lands on an all-English page.
- **Proposal**: Add a `diagrams` namespace (page chrome, legend, STATUS_META, drawer labels) and move step titles/summaries + coverage titles/leads into the catalogs; the long markdown bodies can be keyed per-slug or explicitly documented as en-only for now. Diagram node text inside the `.puml` sources stays as-is (it's source-of-truth architecture, not UI copy).
- **Why users need it**: The bilingual experience breaks exactly on the surfaces used to present the product (About → architecture is the demo path); finishing the catalog keeps the i18n feature's promise.

---
## Cross-checks performed
- Read the 2026-06-08 Feature Scout INDEX + harness-learnings dedup ledger. No prior context covered Analytics/About/Diagrams. Adjacent shipped items verified as non-overlapping: MAT2 (matrix column stats), PIPE3 (per-candidate drawer timeline), RES1/MAT4/PREP3 exports (history/match/matrix surfaces — not analytics), PIPE2/PIPE5 (board filter bar + saved views, which #1 builds on rather than re-proposes). Noted adjacency: archived JOB4 ("per-role sourcing analytics", Med, never shipped, backlog retired) is in the same spirit as #4 but scoped to job-catalog sourcing views, not the global analytics origin split.
- `app/api/analytics/route.ts` — confirmed GET takes no query params (no window/role scoping); `pipelineAnalytics()` (db.ts:1679-1799) confirmed snapshot-only over `pipeline_entries` (funnel, byJob cap 12, byArchetype, bottleneck on active entries only) — `pipeline_events` is never aggregated anywhere (grepped `FROM pipeline_events` consumers: only listPipelineEvents/count, recentScreening guard, hasEvent dedup helpers).
- Event taxonomy enumerated from source: `recordEvent` kinds (EVENT_KINDS in PipelineShared.tsx:25-36 — matched/added/applied/re_applied/advanced/moved/scheduled/rejected/intake_degraded/intake_resolved) + `recordAutomationEvent` call sites (comms-dispatch.ts, automation-run.ts, screen-wave.ts:149 `auto_rejected`, offer-finalize.ts, devcase-run.ts) — confirming origins (#4) and the auto/human split (#3) are derivable today.
- Grepped `export-utils` imports — used by Results/Matrix/SchedulePicker/ReportActions/InterviewPrepModal, NOT by anything under `sub_analytics` (no toCsv/downloadFile/copyText/print on the Analytics tab).
- `PipelineTab.tsx` — confirmed `query`/`quick` filter state is local `useState` (lines 95-98), hydrated from localStorage views only, never from `useSearchParams`; the board's existing deep links (`?entry=`/`?profile=`/`?job=`) cover other tabs, so #1 is a real gap not a dup.
- `/api/analytics/decisions/route.ts` — confirmed offset/limit only (no kind/attribution/entry filters).
- i18n: grepped `useTranslations|next-intl` under `app/diagrams/` (zero hits) and `"diagrams"` namespace in `messages/en.json` (absent); `messages/*.json` confirmed bilingual catalogs exist (about.archLink present in both en and cs).
- Read the full PUML toolchain (PlantUml.tsx, parse.ts, layout.ts, measure.ts) — renderer already supports click targets, strict mode, expand/zoom; considered and dropped "diagram SVG/PNG export" and "live stage-count overlay on the funnel diagram" as below the quality bar versus the analytics items (novelty over recurring user need).
