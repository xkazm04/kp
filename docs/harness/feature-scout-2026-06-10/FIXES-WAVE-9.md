# Fixes — Wave 9: Shell productivity + analytics actionability (2026-06-10)

> Themes G+I from INDEX.md — the `tabs.ts` deep-link substrate unifies them.
> 7 findings: ANA1, ANA2, ANA3, SHELL1, SHELL2, SHELL3, PIPE1. All implemented.
> Gates per fix: catalogs JSON-valid, tsc 0, unit 646→657, lint clean on changed files.
> Wave verification: full `npm run build` PASS, `npm run test:python` 500 OK (4 skipped).

One mental model for the wave: **every number, list, and aggregate becomes a
navigable entry point — and once you can navigate to a cohort, you can act on
it in bulk.** ANA1 built the board-filter deep-link substrate; everything else
either feeds it (analytics links, palette, recents) or pays it off (bulk
actions on the filtered cohort).

---

## 1. ANA1 — Every chart clicks through to the candidates behind it (`be019c8`)

**Where**: `app/features/tabs.ts(+test)`, `app/features/sub_pipeline/PipelineTab.tsx`,
`app/features/sub_analytics/AnalyticsTab.tsx`

The dashboard was display-only — "9 candidates averaging 12 days in Screened"
with no path to those nine cards. PipelineTab now hydrates its filter bar from
URL params at mount (`?q=`, `?quick=` validated against QUICK_FILTERS, new
`?stage=` validated against STAGES; the tab unmounts on every switch so each
navigation re-reads them). Funnel rows link `?tab=pipeline&stage=`, the
bottleneck banner gains "View candidates", byJob titles link `?q=<jobTitle>`.
`q`/`quick`/`stage` joined TAB_SCOPED_PARAM_KEYS (pinned-list test updated) so
a stale filter can't re-apply after a bare tab switch. In-board edits
deliberately do NOT write back to the URL — shareable view URLs are PIPE3,
its own finding.

## 2. ANA2 — Time windows + weekly momentum (`c7fc1f5`)

**Where**: `app/_lib/analytics-momentum.ts` (new, +6 tests), `app/_lib/db.ts`,
`app/api/analytics/route.ts`, `AnalyticsTab.tsx`

All-time-only aggregates could never answer "is this month better than last?".
`pipelineAnalytics(windowDays?)` scopes to the cohort of entries CREATED in
the window (cohort-by-entry, not event-replay — every figure keeps its
meaning); `?days=` clamps 7..365, absent → all time. New momentum series:
rolling 7-day buckets over `pipeline_events` with a non-overlapping kind
mapping — `added`+`intake_degraded` is exactly one per entry creation (the
extra `applied`/seed `matched` events would double-count), `advanced` excludes
Hired moves, which count as `hired`; `rejected`+`auto_rejected`. Pure math in
its own module. UI: window pills + grouped mini-bars with per-week aria.

## 3. ANA3 — "Automation impact" rollup over a shared attribution map (`674916a`)

**Where**: `app/_lib/decision-attribution.ts` (new, +5 tests), `db.ts`,
`DecisionLog.tsx`, `AnalyticsTab.tsx`

The product's headline value ("the AI handled N% of decisions") was invisible.
DECISION_META extracted to a shared module both the DecisionLog badges and the
server rollup import — per-row label and aggregate can never drift. While
extracting, coverage was COMPLETED: **15 kinds the writers actually produce
were unmapped** (including `auto_rejected` — the screening wave's own kind!)
and rendered UNKNOWN badges; each got an attribution + en/cs label, and a test
pins writers ⊆ map. `summarizeAutomationImpact` (pure) folds GROUP-BY-kind
counts through the map (unknown kinds counted as neither — never default
accountability to the machine). Panel: % automated, split bar, auto-advances,
auto-rejections, holds raised → resolved (per-entry: a decision event after
the first in-window hold), comms delivered. Respects the ANA2 window.

## 4. SHELL1 — Global command palette + /api/search (`56f9d60`)

**Where**: `app/api/search/route.ts` (new), `db.ts` (`searchEntities`),
`app/features/CommandPalette.tsx` (new), `Workspace.tsx`, `api-response.ts`

No cross-entity search existed anywhere — "where is X?" cost a guess plus 3
clicks. One LIKE lookup (wildcards escaped) across profiles / entries / jobs /
JDs / analyses, capped per type, behind the SEARCH_FAILED safe envelope.
The palette (sidebar affordance + Ctrl/Cmd+K anywhere) debounces and aborts
per keystroke, groups results by entity, and doubles as a tab navigator
derived from NAV_GROUPS. Navigation reuses the app's existing deep links —
including ANA1's `?q=` board filter for entries — with tab-scoped params
cleared. Modal chrome reused; the input wins opening focus via rAF after the
focus-trap's first-focus.

## 5. SHELL2 — "What needs my attention" nav badges (`88ed5cf`)

**Where**: `app/_lib/attention.ts` (new), `app/api/attention/route.ts` (new),
`app/features/useAttention.ts` (new), `tabs.ts`, `Workspace.tsx`, `WorkspaceNav.tsx`

Every queue depth hid behind a click; the automation heartbeat mutates entries
with no client signal, so work accumulated invisibly. `attentionCounts()`
(pending decisions / SLA-stale by server defaults / due reminders / job
drafts) serves both the polled `/api/attention` (mount + live-refresh bus +
visibility-gated 60s) and WorkspaceNav directly (server component snapshot,
best-effort guarded). Nav items opt in declaratively via `badgeKey` in
tabs.ts. Failures keep the last counts — a badge is a hint, never an error
surface.

## 6. SHELL3 — Recents: pick up where I left off (`14487e9`)

**Where**: `app/features/recents.ts` + `RecentsNav.tsx` + `RecordRecent.tsx`
(new), `CommandPalette.tsx`, `PipelineTab.tsx`, both detail pages

The shell's param-clearing contract erases selection on every tab switch, and
nothing recorded the deep links. Capped (8) `kp.recents` localStorage list
with a same-document change event; re-opens re-front. Recording sites = the
"I'm working on this" moments: board drawer / profile / job opens, palette
entity picks, and the `/jds/<slug>` + `/history/<slug>` detail pages (via a
render-nothing client island — the pages are server components). Surfaces: a
"Recent" sidebar group (client island mounted in BOTH sidebars) and the
palette's resting state (the SHELL1+SHELL3 compound). Deliberate cut:
last-active-tab-as-landing-view skipped — a landing-behavior change without
user input is a UX gamble.

## 7. PIPE1 — Bulk multi-select board actions (`e42e385`)

**Where**: `PipelineTab.tsx`, `PipelineBoard.tsx`, `PipelineShared.tsx`

Filters isolate a cohort but acting was one-drawer-at-a-time. A "Select"
toggle (MatrixTab `selectMode` precedent) flips CandidateRows into checkboxes
(role=checkbox, navigation suppressed); the action bar offers count / "Select
all N shown" / stage picker / "Move N". Moves run as sequential `set_stage`
POSTs **each carrying its own `expectedStage`** — a 409 means a concurrent
actor won, and the MatrixTab W11 failure-retention grammar applies: failures
stay selected for retry, successes deselect, the board reloads. Deliberate
cut: the optional "Screen N with AI" batch is not included — moving is the
verb the filters set up.

---

## Patterns worth keeping (→ harness-learnings)

1. **Make filter state URL-hydratable and the rest of the app composes with
   it free** (ANA1 → SHELL1/SHELL3): once the board reads `?q=/?stage=` at
   mount, analytics links, palette hits, and recents all got "open exactly
   this cohort" for the cost of an href.
2. **When extracting a shared map, audit its coverage against the writers**
   (ANA3): the extraction surfaced 15 unmapped event kinds — an aggregate
   built on the partial map would have silently undercounted; the writers ⊆
   map test stops the drift recurring.
3. **Badges/recents are hints, not features that may error** (SHELL2/SHELL3):
   fetch failures keep the last counts, storage failures no-op — a
   convenience surface must never add an error state to the shell.
4. **Bulk actions = the single-item verb in a loop with per-item CAS +
   failure retention** (PIPE1): no new endpoint, no transaction semantics to
   invent — each item carries the stage its card showed, and failures simply
   remain selected.
