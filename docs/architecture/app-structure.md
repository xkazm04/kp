# App structure — `app/features/**`

Status: **refactor complete and stable** (verified 2026-07-30 against the live
tree). Three rules apply to `app/features/**`:

1. **No `.tsx` over 200 lines.** Anything larger is split into modules.
2. **Every module in a feature folder starts with that feature's name** —
   `PipelineBoard.tsx`, `PipelineCandidateDrawer.tsx`, `pipelineBoardFilters.ts`
   — so a file's home is readable from its name alone and the folder sorts by
   role. PascalCase for `.tsx` components, camelCase for `.ts` helpers.
3. **The folder tree mirrors the app's menu** — `hiring/pipeline`,
   `insights/matrix`, `settings/billing`. A feature with internal structure
   nests further (`hiring/decisions/groupEval`).

Scope is `app/features/**` only. `app/_components/**` (shared UI), `app/_lib/**`
(business logic) and the public route pages keep their own homes — they have
no position in the menu, so rule 3 doesn't apply to them, and rule 1 has not
been extended to them.

## Live tree (confirmed on disk)

```
app/features/
  hiring/       channels, decisions (+groupEval), onboarding, pipeline, schedule
  library/      jds, jobs
  insights/     about, analytics, matrix
  settings/     billing, branding, integrations, models, organization, workspace
  tools/        analyze, devcases, interview, match, profile
  shell/        Workspace.tsx + nav/, simulation/, tasks/, setup/ (the frame
                the menu lives in — sidebar, command palette, keyboard chords,
                tab catalog, background tasks, simulation dock)
  shared/       cross-cutting types/logic with 2+ feature-group consumers
                (MatchPresentation, decisionsTypes, groupEvalTypes,
                matchTypes, pipelineTypes, profileTypes, renderTemplate, …)
```

This matches the refactor's target 1:1 (menu group → tab → folder). `shell/`
is not a menu entry.

## How a tab switch works (and why it costs nothing)

The workspace is **one route**: `/` plus query params. `?tab=` picks the panel,
and every selection and filter (`?profile=`, `?job=`, `?q=`, `?quick=`, `?score=`,
`?source=`, `?sort=`, `?stage=`) is a param on the same page. The server render of
`/` reads **none** of them — only `?sim=auto` and `?onboarding=1`.

That mattered, because `/` is `export const instant = false` (it awaits
`searchParams` and reads cookies for the entry + first-run gates, so it cannot be
prerendered under Cache Components). Routing tab switches through
`router.push` therefore made each one a full server navigation: measured on the
dev server 2026-08-05, **~358 KB of RSC payload per click**, byte-for-byte the
same for `?tab=channels` and `?tab=decisions` — the payload is dominated by the
~412 KB next-intl catalog `app/layout.tsx` hands to `NextIntlClientProvider`. The
board's filter→URL write-back paid the same toll on every chip click and every
debounced search keystroke.

**`app/features/shell/nav/shallow-nav.ts`** is the fix. `useShellNavigate()`
returns `{ push, replace }` that patch the URL with
`window.history.pushState` / `replaceState` when the target keeps the current
pathname, and fall back to the router when it doesn't. The App Router *patches*
both history methods (see the `useEffect` in
`next/dist/client/components/app-router.js`): they dispatch `ACTION_RESTORE`,
which updates the router's canonical URL — so `usePathname` / `useSearchParams`
re-render exactly as they do from `router.push` — with no RSC request, and they
copy Next's internal history state onto the new entry so the router's own
`popstate` handler still drives Back/Forward. Verified in-browser: a tab switch
and a filter chip each issue **zero** `_rsc` requests, and browser Back still
restores the previous tab.

`isSameDocumentUrl` (unit-tested in `shallow-nav.test.ts`) is deliberately
conservative — a cross-route URL that were wrongly treated as shallow would change
the URL bar and render nothing.

Call sites on the shallow path today: `Workspace.selectTab` + the badge-slice nav,
`usePipelineFilters` (the two-way filter sync) and `usePipelineNavigation`. Other
tabs still use `router.push`; migrating one is a two-line change.

### Tab chunks are warmed, not awaited

`app/features/shell/tabChunks.ts` owns the import specifiers for every code-split
tab **once**; `WorkspaceTabChunks.tsx` renders through the same map. A click used
to be the first moment a tab's chunk was requested, putting the download on the
critical path between the click and the first frame. `prefetchTabChunk(id)` starts
it on nav-item hover **and** focus (a keyboard user never hovers) and inside
`selectTab` before the URL flips; `warmLikelyTabChunks(active)` warms the hiring
tabs on `requestIdleCallback` after mount. All idempotent, all fire-and-forget — a
failed prefetch is swallowed, and the render path re-requests and surfaces a real
failure through the tab's `ErrorBoundary`.

## Why `shared/` exists

Before the refactor, three things made the tree impossible to split cleanly:

- `sub_match/MatchTypes` + `MatchShared` were imported by Hiring, Library and
  Insights;
- `app/_lib` imported *upward* into feature internals (`attention.ts` →
  `PipelineTypes`, `group-eval-run.ts` → `MatchTypes` + group-eval types,
  `candidate-timeline.ts` → `DecisionsTypes`, `archetype-registry.ts` →
  `ProfileTypes`, `templates-store.ts` → `render-template`, …);
- the shell (`simulation/`, `setup/`) reached into `sub_pipeline`,
  `sub_decisions` and `sub_organization`.

Anything with more than one feature-group consumer now lives in
`app/features/shared/`. Nothing in `shared/` may import from a feature group —
the dependency runs one way.

## Pinned filenames

These are imported by path from outside their owning directory (the shell or
a route page) — renaming them requires a coordinated cross-tree update, not a
local one: `hiring/pipeline/CommandBar.tsx`, `hiring/pipeline/SchedulerControl.tsx`,
`hiring/pipeline/PassPreviewModal.tsx`, `hiring/decisions/GroupEvalModal.tsx`.

Some tests read component source as *text* rather than importing it (path-
and-string assertions) — a rename or split must update these too:
`tools/devcases/DevTab.approve-error.test.ts`,
`insights/analytics/analyticsCalibrationFamilyApplyGate.test.ts`,
`tools/analyze/analyzeDropRouting.test.ts`,
`tools/analyze/analyzeFileIntakeGate.test.ts`,
`hiring/decisions/groupEval/groupEvalComparisonLeadCrown.test.ts`, plus
`app/api/jds/save/save-ingest-contract.test.ts` and `app/_lib/fit-thresholds.test.ts`
outside the features tree.
(The four `app/features/**` ones were themselves renamed by the refactor — the area prefix is part
of the new naming convention. `rg -l readFileSync --glob '**/*.test.ts*' app/`
lists all 109 source-reading tests if you need the full set.)

## Outcome, as landed

| Group | `.tsx` | `.ts` | LOC |
|---|---|---|---|
| hiring | 139 | 60 | 21832 |
| library | 55 | 41 | 9276 |
| tools | 81 | 55 | 13486 |
| insights | 51 | 14 | 6809 |
| settings | 25 | 16 | 3884 |
| shell | 50 | 43 | 9087 |
| shared | 2 | 13 | 2031 |

At landing: 403 `.tsx` files, none over 200 lines (largest exactly 200);
`tsc --noEmit` clean, 2401/2401 unit tests, i18n parity 4126 keys × 4 locales,
eslint byte-identical in count/breakdown to the pre-refactor baseline, dev-server
smoke of `/`, `/diagrams`, `/about`, `/?tab=analytics` all 200.

## Drift since landing (found 2026-07-30)

The 200-line cap has crept on 5 files as features grew — this is normal
maintenance drift, not a broken refactor, but worth a cleanup pass:

- `hiring/decisions/groupEval/GroupEvalComparisonTable.tsx` — 267 lines
- `tools/devcases/DevLifecycleRow.tsx` — 212 lines
- `hiring/channels/ChannelsCommsTable.tsx` — 203 lines
- `shell/WorkspaceCommandPalette.tsx` — 202 lines
- `hiring/decisions/groupEval/GroupEvalPerCandidateTabs.tsx` — 202 lines

None are large overruns (worst is +67 lines); splitting them the same way the
original refactor split larger files would restore the invariant.

## Known drift `context-map.json` should already reflect

The original refactor plan noted `context-map.json` would go stale
immediately after the move (it pinned 214 exact pre-refactor paths). The map
now shows the new `app/features/{hiring,insights,library,settings,shared,
shell,tools}/**` paths, so that regeneration has already happened — treat the
map as trustworthy for this area going forward, not as a hangover from the
refactor.

Historical artefacts (`docs/harness/**` scan reports, `uat/**`, `casesim/**`,
`.claude/commands/backlog/*.md`) may still cite pre-refactor paths
(`sub_pipeline/`, `sub_jobs/`, etc.) — these are records of what was true at
the time and are deliberately left alone.

## Dev compile cost — why a cold tab takes seconds

`next dev` compiles a route's **entire module graph** on first hit, with no
tree-shaking. Measured 2026-08-06 against the running dev server, the cost tracks
graph size almost linearly:

| Route | Graph | First hit | Warm |
| --- | --- | --- | --- |
| `/api/comms/relay` | 8 modules · 34 KB | 1.9 s | 7 ms |
| `/api/health` (before) | 55 modules · 718 KB | 25.6 s | 132 ms |
| `/api/schedule` | 132 modules · 1.34 MB | 22.6 s | ~30 ms |

`application-code` in the dev log stays in the low hundreds of milliseconds
throughout — it is compilation, not data. Warm, the whole Pipeline/Channels API
surface answers in **269–343 ms across 9 endpoints (~300 KB)**.

**What inflates the graphs: `app/_lib/db.ts`.** It is an `export *` barrel over 17
store modules — 52 first-party modules, ~707 KB of source — so *any* importer
compiles the whole data layer. 174 API routes exist; **112 still import the barrel
directly**, and the median route graph is 58 modules.

Worse, the barrel reached routes that never touch the DB, through hub modules.
`/api/attention` (badge counts) pulled it via
`attention.ts → job-ingest.ts → llm-config.ts → ./db`. Cutting the barrel import in
those hubs is the highest-leverage fix, because it shrinks every route downstream
at once:

| Module / route | Before | After |
| --- | --- | --- |
| `app/_lib/llm-config.ts` | 57 modules · 734 KB | 13 · 179 KB |
| `app/_lib/job-ingest.ts` | 60 · 763 KB | 20 · 219 KB |
| `/api/attention` | 68 · 863 KB | 43 · 560 KB |
| `/api/health` | 55 · 718 KB | 14 · 180 KB |

**The rule: import the slice (`@/app/_lib/db/pipeline`), not the barrel
(`@/app/_lib/db`)** — in `app/_lib/**` hub modules especially, where one import
taxes every route downstream. `import type` is free (erased before bundling), so
type-only barrel imports need no change.

Still outstanding: the 112 routes importing the barrel directly, and
`app/_lib/interview-run.ts` (115 modules · 1.14 MB) — `/api/schedule` imports it
for the single `plannedInterviewMinutes` helper, which wants extracting into a leaf
module.
