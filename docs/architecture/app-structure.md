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
  hiring/       channels, decisions (+groupEval), pipeline, schedule
  library/      jds, jobs
  insights/     about, analytics, matrix (+ matrix/focus — the candidate-focus
                mode, formerly the standalone Match tab)
  settings/     billing, branding, integrations, models, organization, workspace
  tools/        analyze, devcases, interview, profile
  shell/        Workspace.tsx + nav/, simulation/, tasks/, setup/ (the frame
                the menu lives in — sidebar, command palette, keyboard chords,
                tab catalog, AI tasks, simulation dock)
  shared/       cross-cutting types/logic with 2+ feature-group consumers
                (MatchPresentation, decisionsTypes, groupEvalTypes,
                matchTypes, pipelineTypes, profileTypes, renderTemplate,
                pipelineAxisDraft + usePipelineAxisCopy — the board-column
                editing model and its copy, shared by Settings → Hiring and
                the first-run wizard's Pipeline step, …)
```

This matches the refactor's target 1:1 (menu group → tab → folder). `shell/`
is not a menu entry.

Two folder names deliberately no longer match their tab id: `tools/profile/` is the
**Archetypes** tab (`?tab=archetypes`) and `tools/devcases/` is **Assignments**
(`?tab=assignments`). The ids were renamed for what the surfaces actually are; the
folders were left alone so the rename stayed a routing/label change rather than a
several-hundred-file move. `LEGACY_TAB_ALIASES` in `shell/tabs.ts` keeps the old
`?tab=profile` / `?tab=dev` / `?tab=match` links resolving — a `?tab=` value lives in
bookmarks and pasted links, so dropping one would land those on Overview and read as
"the feature is gone".

## How a tab switch works (and why it costs nothing)

The workspace is **one route**: `/` plus query params. Every selection and filter
(`?profile=`, `?job=`, `?q=`, `?quick=`, `?score=`, `?source=`, `?sort=`,
`?stage=`) is a param on the same page. The server render of `/` reads **none** of
them — only `?sim=auto` and `?onboarding=1`.

### The view selectors are app state; the URL is their inbox

`?tab=` (the panel) and `?sec=` (the Analytics section) are the exception: they no
longer *are* the state. `app/features/shell/nav/useUrlInboxState.ts` holds the
value in React state and treats the query as a **one-shot inbox** — read when
something arrives in it, then cleared:

- an incoming deep link still lands (a comms email, `TasksIndicator`,
  `CompletionCta`, a link a colleague sent) — *arriving* is the param appearing;
- clicking around writes **nothing**: no query churn, no history spam;
- the param cannot go stale, which fixes a bug the naive "read it once" version
  has — leave `?tab=x` in the bar and a second link to the *same* `?tab=x` is not
  a change, so nothing happens and the link looks broken.

The arrival is adopted **during render** (React's "adjusting state when a prop
changes" pattern, guarded by the previously-seen param) rather than in an effect,
so there is no frame of the wrong tab before a correction. The effect does only
the side effect: emptying the inbox.

`parse` owns the vocabulary, so legacy ids (`?tab=profile`, `?tab=dev`) still
resolve via `LEGACY_TAB_ALIASES` and a gated tab (`AGENTS_TAB_IN_NAV`) is
*rejected* rather than adopted-then-corrected — a link to a gated view is inert
instead of bouncing the reader to the default. About was gated the same way
until it was rebuilt as a six-chapter explainer for readers who are not in a dev
build; `ABOUT_TAB_IN_NAV` is gone and the tab now ships in every environment.

**Trade-off, chosen deliberately:** with no URL write there is no history entry
per switch, so Back no longer steps through tabs — it leaves the workspace.
Restoring that means carrying the tab in history *state* rather than the query.

`selectTab` still writes the URL in exactly one case: when a tab-scoped
deep-link param (`?profile=`, `?job=`, `?edit=`, `?jd*` — the `clearedTabScopedParams`
allowlist) is actually present, so the destination cannot inherit the previous
tab's selection. The ordinary click touches nothing.

Pinned by `e2e/shell-tab-state.spec.ts` and `e2e/analytics-sections.spec.ts`.

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

Warming is also **section-level**. In the two-level rail (`NavSectionRail`), a
second-level tab is two interactions away: open the group, then click the item.
Per-item hover only fires once the panel is already open, so reaching e.g.
Settings → Branding still paid for the chunk at click time. The rail button now
warms every chunk in its group on hover, focus and click (`prefetchSection`), so
opening a section starts all of its tabs' downloads at once — 2–7 small chunks
per group, deduped per document by `prefetchTabChunk`.

### The command palette lives on the rail

`shell/WorkspaceCommandPalette.tsx` is the Ctrl/Cmd+K search + navigator. Its
trigger is a **rail button** (icon + "Search" label, first in the rail's bottom
group, above feedback / theme / language / sign-out) — mounted on BOTH sidebars:
`WorkspaceNavDrawer.tsx` (SPA) and the link-mode `WorkspaceNav.tsx` (deep-link
pages; wrapped in `Suspense` because it reads `useSearchParams`, and it uses
`useOptionalSimulation()` so the tour command is simply absent where there is no
`SimulationProvider`). The surface is a **top-centre, chromeless dialog**
(`Modal placement="top" bare` — the launcher idiom: the eye starts at the input,
results grow down). The host owns all state (query, debounced `/api/search`,
keyboard highlight); while typing, entity hits lead and the tab navigator trails.

The body is `WorkspacePaletteLedger.tsx` — the `/prototype` winner ("Ledger",
master–detail): a dense grouped index on the left (`WorkspacePaletteRow.tsx`:
glyph tile, match highlight) and a **live preview pane** on the right for the
highlighted row: kind eyebrow, the name in the display face, the destination's
quick facts, "Opens in …", and an explicit Open ↵ button. Group glyphs/tints and
the destination resolver live in `workspacePaletteMeta.ts`.

**Preview facts** — `GET /api/palette/preview?tab=<id>` or `?type=<hit>&id=…`
returns one `PalettePreview` union member (`app/_lib/palette-preview/types.ts`);
per-destination resolvers (`resolve-hiring.ts`, `resolve-library-tools.ts`,
`resolve-insights-settings.ts`, `resolve-entities.ts`, dispatched by `index.ts`)
compute 2–6 facts from the cheap tenant-scoped primitives (counts, small lists —
never `pipelineAnalytics` or a Python spawn). Operator-only tabs (billing, models,
integrations, organization, workspaces) resolve to `{ view: "restricted" }` for a
demo session (`isOperator()`); the analysis view applies the same PII masking as
`/api/analyses/[slug]`. Client side, `shell/palette/usePalettePreview.ts`
(120 ms debounce, aborting, 30 s per-key memo) feeds `PalettePreviewPane.tsx`,
which dispatches to one small renderer per view (`PreviewHiring.tsx`,
`PreviewLibraryTools.tsx`, `PreviewInsightsSettings.tsx`, `PreviewEntities.tsx`)
built from `previewBits.tsx` (Tiles/Tile, Row, Status dot, Chips, RankList,
`useFmt`). Copy lives under the `palettePreview` catalog namespace. Adding a
destination = one union member + one resolver case + one renderer.

The old sidebar "Recent" group (`WorkspaceRecentsNav`) was removed; `recents.ts`
remains, feeding the palette's resting state and recording opens.

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

## `shell/tasks/` — the AI-tasks surface

`?tab=tasks` (labelled **AI tasks**; the id, the chunk and the catalog namespace
stay `tasks`) is a client-only live view reached from the sidebar footer, not a
deep-link target — so it is a valid `WorkspaceTabId` but absent from `NAV_GROUPS`.

| File | Role |
| --- | --- |
| `TasksProvider.tsx` + `tasksProviderTypes.ts` | Mounted above the tabs: the 2s/6s poll, start/cancel/retry, the read/unread ack. Survives tab switches |
| `TasksIndicator.tsx` | Sidebar-footer entry: ONGOING count, unread badges, start-failure alert, load meter |
| `TasksTab.tsx` | Header, start-error banner, the filter state (shared by the live table and the history pager), the dwell-ack |
| `TasksRunsPanel.tsx` | The recent window as ONE paginated table (`TablePager`, 20 rows) |
| `TasksTable.tsx` | Table shell + `ColumnFilter` headers, shared by the live window and history |
| `TasksTableRow.tsx` + `TasksRowActions.tsx` + `TasksOutcome.tsx` | One row shape for every status: progress bar + Cancel while active, outcome drawer + Retry once terminal |
| `TasksHistory.tsx` | Runs older than the recent window, via the shared infinite-scroll engine |
| `tasksTabHelpers.ts` (+ `.test.ts`) | Status metadata, the terminal/all status vocabularies, `sortTasks`, time/duration formatting |

Two shape decisions are load-bearing:

- **One table, not two lists.** In-progress and Done used to be separate card
  lists under separate headings, with no shared sort, filters or pager. They are
  one table now; `sortTasks` (unit-tested) carries what the headings did — running
  first, then queued, then terminal runs newest-first.
- **The tab owns only tasks.** Three unrelated operator panels used to hang below
  the lists because this was "the operator's tab". They now live where they
  belong: the System health readout folded into the consolidated **Billing →
  Usage & cost** section (`settings/billing/spend/**`, which already reported
  half of it), Backup & restore into **Settings → Organization**
  (`settings/organization/OrganizationBackupPanel.tsx`), and the outbound
  `kp.ats.v1` webhook into **Settings → Integrations**
  (`settings/integrations/IntegrationsWebhookPanel.tsx`).

## `shell/setup/` — the first-run wizard

One overlay, two modes (`OnboardingExperience.tsx`): **live** on a first run
(mounted by `Workspace` when the `/` gate says so; `?onboarding=1` forces it) and
**preview** from Settings → Organization, which reads but writes nothing. Four
steps and a hand-off, crossfaded one at a time inside a centred card whose left
rail carries the brand, the stepper and the language switch:

| Step | Asks for | Persisted by `finish()` |
| --- | --- | --- |
| Welcome | nothing (the pitch) | — |
| Company | org name (**required**), optional accent + logo | `setOrgName`, `PUT /api/brand` |
| Team | invites (optional) | `POST /api/org/invites` per row |
| Pipeline | the board's columns (optional) | `POST /api/pipeline/stage-migration`, **only when changed** |
| Hand-off | how to begin (tour / solo) | stamps `POST /api/me/onboarding` |

Two rules the steps share. **Language lives in the rail**, not in a step — see
[`localization.md`](./localization.md#choosing-the-app-language). And **no step
offers a skip button**: `stepSatisfied()` (`setupSteps.ts`) gates only `company`
(an org name) and the *validity* of the pipeline axis, so on Team and Pipeline
pressing Continue IS the skip. Leaving the wizard entirely has exactly one
affordance — the close control on the card. Everything else (a per-step "Skip for
now", an *Optional* tag under the rail labels, a "Skip setup" ghost button beside
Continue on Welcome, a "Step 1 of 5" counter under the language switch) was a
second way to say something the card already says, and is gone.

**Step 4 replaced a "First role" step** that collected the inputs of a real
backgrounded JD build. Authoring a job description belongs in the Library, where a
build has a ledger, a retry and honest engine caveats; the Getting-started
checklist walks a new operator there (`setupGettingStartedModel.ts` → the
`jd-builder` anchor). The board's shape took its place because it is the one
decision every later screen depends on, it is cheap while nothing is on the board,
and nothing else asks about it at first run. Its editing rules are NOT a second
copy — `shared/pipelineAxisDraft.ts` is the same model Settings → Hiring uses, and
`shared/usePipelineAxisCopy.ts` the same words (which is why both files sit in
`shared/`: two feature groups now edit one axis). The wizard narrows it rather than
forking it: the entry and terminal columns cannot be removed or re-roled, and an
occupied column cannot be dropped, so no click in the step can produce a shape the
server would refuse.

The step is **read-only first**. It opens on `SetupPipelineJourneyView` — a vertical
walk down the funnel where each stop carries its stage-role glyph, its name, its
role and one plain sentence saying what happens there
(`hiringPlan.roleMeaning.*`, served by `usePipelineStageRoleMeaning`) — and
*Change these steps* swaps in `SetupPipelinePresetsVariant`: three named shapes,
one chain showing the result, then the row-by-row editor. That editor's row is
`shared/PipelineStepRow.tsx`, the same row Settings → Hiring draws.

The journey won a `/prototype` round against a columns-preview of the same axis
(deleted): a first-run reader does not recognise the board yet, so explaining the
process beat rehearsing a screen. Nothing in the view is uppercase — `text-meta`
is a form-section marker, and this step is prose.

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

Historical artefacts (scan reports, `uat/**`, harness vaults,
`.claude/commands/backlog/*.md`) may still cite pre-refactor paths
(`sub_pipeline/`, `sub_jobs/`, etc.) — these are records of what was true at
the time and are deliberately left alone.

## Dev compile cost — what is actually slow, and what is not

**Read the table before optimising anything here.** Measured 2026-08-07 with
`scripts/perf/devbench.mjs` (cold = `.next/dev/cache/turbopack` wiped; each run
fetches `/`, the 10 APIs the page really calls, and every `_next` asset in the HTML):

| Scenario | Boot | First `/` | Assets | Total |
| --- | --- | --- | --- | --- |
| Restart, **persistent cache intact** | 0.7 s | 4.2 s | — | **4.9 s** |
| Restart, **cache wiped** | 0.7 s | 10.9 s | 24 files · 6.4 MB · 1.5 s | **13.0 s** |
| Warm `/` (already compiled) | — | **0.14 s** | — | — |
| Warm API (`/api/attention` … `/api/comms`) | — | 7–212 ms | — | — |
| First fetch of **all 30 tab chunks** | — | 12–56 ms each | 20.7 MB | **0.67 s** |

Three conclusions that keep getting re-litigated:

1. **Steady state is already fast.** A restart is ~5 s, a compiled page 140 ms, a
   tab switch 12–56 ms. Turbopack's filesystem cache (`.next/dev/cache/turbopack`,
   on by default since 16.1) is what buys this — **never `rm -rf .next`** to "fix"
   a dev problem; it converts a 5 s restart into a 13 s one.
2. **Tabs do not compile on demand.** Turbopack's lazy bundling is per *route*, not
   per dynamic chunk: `/` builds all 23 tab chunks (~20 MB) with the page, so by the
   time you click a tab its chunk is already on disk. "Each tab recompiles" is not a
   real effect — what looks like it in the log is a route's *first* compile.
3. **A 40 s+ compile means mass invalidation, not a slow bundler.** After a
   316-file commit the trace showed `ensure-page /page` = 41.0 s. Two `GET /` lines
   (43 s and 21.3 s) in that log were **one** compile — the second request started
   20 s in and ended at the same instant. Read `.next/dev/trace` before believing a
   dev-log number: `handle-request` spans overlap, `compile-path` does not.

### Turbopack config flags: measured, none of them help

Against the 13.0 s cold baseline, on `next@16.3.0-canary`:

| Flag | Result |
| --- | --- |
| `turbopackFileSystemCacheForDev` | **already `true`** by default — this is the 4.9 s restart |
| `optimizePackageImports` | Next already auto-applies `lucide-react` + `recharts` (`server/config.js`); the repo's 780 lucide import sites are covered |
| `turbopackSourceMaps: false` | 11.1 s — no win, loses dev stack traces |
| `turbopackMemoryEviction: false` | 11.4 s — no win |
| `turbopackRemoveUnusedExports/Imports: true` | **crashes** — Turbopack panic, "export usage not found" on the server-actions loader |
| `turbopackModuleFragments: true` | **crashes** — breaks `@sentry/react`'s `ErrorBoundary` export |

Both crashing flags are dev-default `false` for a reason; do not enable them.

### Why `/` is the expensive route

`app/page.tsx` reaches **983 first-party modules** — 234 statically, 749 only via
`next/dynamic`. That is the whole product behind one URL, which is inherent to the
`?tab=`-driven single-page workspace: `WorkspaceTabChunks` names all 23 tab loaders
at module scope. Shrinking this means changing that architecture, not adding a flag.

Non-config factors that dominated the worst observed runs, in order: a mass source
change invalidating the cache; **other `next dev` servers on the same box** (three
were live on :3001/:3002/:3005 holding 6.6 GB); and Windows Defender real-time
scanning a 768 MB cache directory with no exclusion.

### API route graphs

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

Both follow-ups are now done (cfdf06b6): the barrel sweep rewrote 178 files to
slice imports — **one** non-type importer of `@/app/_lib/db` remains — and
`plannedInterviewMinutes` moved into the leaf `app/_lib/interview-planned-minutes.ts`,
so `/api/schedule` no longer drags in `interview-run.ts` (115 modules · 1.14 MB).
That work is why every API route in the table above now answers in 7–212 ms warm;
it did **not** move `/`, which is bounded by the 983-module page graph instead.
