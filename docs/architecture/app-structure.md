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

The three rules — what a cold load renders, when a param counts as an *arrival*,
and when the inbox is emptied — are pure functions in `shell/nav/urlInbox.ts`
(`initialInboxValue`, `arrivalAdoption`, `shouldEmptyInbox`), pinned by
`urlInbox.test.ts`; the hook is the React plumbing around them. The rule worth
reading twice is that an **absent** param is an arrival to *record* but never a
value change: the hook clears the param it just consumed, so treating that
absence as "the default arrived" would bounce every deep link back to Overview
one frame after it landed.

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

### The deep-link sidebar has a public viewer, so it gates on `isOperator()`

`shell/WorkspaceNav.tsx` (`WorkspaceShell`) is the link-mode sidebar for the three
server-rendered detail pages — `/jds/[slug]`, `/history/[slug]`, `/diagrams`. Two of
those are gated, but **`/jds/` is on the public allow-list**
(`app/_lib/auth/public-routes.ts`): it is the shareable, candidate-facing role page
with the Apply CTA and the OG unfurl. So this sidebar renders for anonymous visitors,
and everything it draws must be safe for one.

It therefore resolves `await isOperator()` **itself**, rather than taking the answer
as a prop — a host page that forgot to pass it would silently re-open the leak, and
the nav is the thing that knows what its own chrome costs. Two things hang off it:

- **Attention badges.** `attentionCounts(await currentWorkspace())` runs only for an
  operator. `currentWorkspace()` resolves a cookieless caller to `DEFAULT_WORKSPACE`,
  so before the gate `curl https://host/jds/<slug>` with no cookies returned the
  default team's real queue depths (entries awaiting a human decision, entries past
  their stage SLA, confirmed future interviews, unpublished draft roles, new inbound
  arrivals) as bare integers in `NavPanelItem`. A non-operator gets
  `attention={null}`, which the shared renderer already treats as "no badge".
  The renderer carries a second, explicit gate for the same rule:
  `NavSectionRail`/`NavPanelItem` take an optional `showAttention` (default `true`,
  so omitting it is today's behaviour), and `false` suppresses the inline pill, the
  badge-slice pill and the `pr-9` gutter reserved for one even if a populated
  `attention` map is handed in. Withholding the counts and passing `showAttention`
  are equivalent and compose; neither depends on the other.
- **Operator-only rail controls.** The command palette (it searches the workspace's
  candidates and roles behind a gated `/api/search`), the recruiter feedback door, and
  Sign out — which offered a candidate who never had a session a button that POSTs
  `/api/auth/logout` and hard-navigates them off the job ad. Appearance and language
  (`RailPreferences`) are viewer chrome and stay for everyone.

Open mode (`KP_OPERATOR_PASSWORD` unset) makes `isOperator()` true for everyone by
design, so a keyless/dev install and the e2e subset are unchanged; only a
password-protected deploy has an anonymous principal to distinguish. A `/api/demo`
demo session is deliberately *not* an operator (see `require-operator.ts`), so it also
sees the un-badged rail on these three pages.

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

**A failed search clears the rows.** `useWorkspaceCommandPaletteSearch.ts` reduces
each response through the pure `searchResponseState(ok, body)`
(`useWorkspaceCommandPaletteSearch.test.ts`): a non-ok status, an `error` body or an
unparseable body yields `{ hits: [], failed: true }`. It used to raise the error and
leave the previous query's hits standing — and since `paletteListView` reads
`itemCount > 0` as "settled results", nothing dimmed them, the highlight stayed on
row 0, and Enter opened a candidate the recruiter had not typed. A malformed but
successful body is the opposite case and stays a genuine zero-hit result, so the
palette may still say "no matches" for it.

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
(120 ms debounce, aborting) feeds `PalettePreviewPane.tsx`,
which dispatches to one small renderer per view (`PreviewHiring.tsx`,
`PreviewLibraryTools.tsx`, `PreviewInsightsSettings.tsx`, `PreviewEntities.tsx`)
built from `previewBits.tsx` (Tiles/Tile, Row, Status dot, Chips, RankList,
`useFmt`). Copy lives under the `palettePreview` catalog namespace. Adding a
destination = one union member + one resolver case + one renderer.

The memo behind it lives in `shell/palette/previewCache.ts` and is keyed on
**(workspace, query)**, not on the query alone: a palette query says nothing
about whose numbers it asked for, so a query-only key let one document re-show
the previous tenant's counts for the whole 30 s TTL after an in-place team
switch. An unresolved tenant is not a key — nothing is read and nothing is
written, so the worst case is a colder pane rather than a wrong one. The tenant
comes from the same door `shell/recents.ts` uses (`GET /api/workspaces` →
`current`; the session cookie carrying it is httpOnly), resolved once per
document, and changing it empties the cache. `previewCache.test.ts` pins the
scoping, the TTL boundary and the three response shapes that mean "error".

The union carries **canonical slugs**, not display text, wherever the value is one
the pipeline branches on — archetype, role family, seniority (the resolvers group
straight off `role_family` / `profiles.archetype`). Renderers must put those through
`useEnumLabel()` (`enums.<group>.<slug>`, `labelize` fallback), exactly as the board,
Decisions and Matrix do; rendering them raw printed `software_engineering` / `bau` in
all four locales. Stage is the exception — `resolve-entities.ts` resolves it to the
workspace's own column label server-side, so it arrives ready to draw.

The old sidebar "Recent" group (`WorkspaceRecentsNav`) was removed; `recents.ts`
remains, feeding the palette's resting state and recording opens.

### The bottom control dock is a two-layer toolbar with a rail

`shell/simulation/SimBar.tsx` → `SimControlDock.tsx` is the always-mounted bottom
deck. Collapsed, it is the Candi orb (`SimControlDockOrb.tsx`) — a haloed mark
carrying the awaiting-decisions beacon and the aiBusy pulse. Raised, it is a fixed
footer ROW of three parts: a bordered panel box in the middle, and one element
outside each of its borders.

- **Outside the borders** (`SimControlDockRail.tsx`) — the Candi power switch on
  the left (`DockBrand`, the only control that lowers the deck, carrying the
  aiBusy pulse) and the ONE guided-demo button on the right. Round 4 removed the
  logo, the "Control center" wordmark and the mode subtitle that used to sit
  beside the switch ("it does not bring value" — operator, 2026-08-24); the switch
  is icon-only at every width. Neither element ever hides, because each is the
  only route to what it opens; the guide button sheds its LABEL below `md`
  instead, leaving a square that still hits the touch target. The panel between
  them is `min-w-0 flex-1`, so it absorbs the remaining width and wraps its own
  row rather than colliding with either side.
- **Layer 1** (`SimControlDockToolbar.tsx`) — always visible inside the box: the
  "N need you" route into the decisions queue, and a compact `role="toolbar"` icon
  row of four controls. Roving tabindex: one tab stop, arrows/Home/End move FOCUS
  (never activation — half the row fires side effects), Enter/Space activates. The
  math is `nextToolbarIndex()` + `toolbarMemberCount()` in
  `shell/simulation/simControlDockLayers.ts`, unit-tested beside it. The Candi
  member is the only CONDITIONAL one and it is LAST (`CANDI_TOOLBAR_INDEX`), so
  its presence never renumbers the three fixed panels under an index the operator
  is standing on. The guide button is NOT a member of the toolbar — it is outside
  the box across a visual gap, so it owns its own tab stop.
- **Layer 2** (`SimControlDockPanelBody.tsx`) — ONE panel rendered above the row,
  keyed by a single `panel` state (`DockPanelId = "sim" | "ops" | "command" |
  "schedule" | "candi"`). Re-selecting the active control closes it
  (`toggleDockPanel()`); Escape closes it too, leaving the row in place.

**Keyboard truth, and the two surfaces that share Escape.** The whole Escape
decision is `dockEscapeAction()` in `simControlDockLayers.ts`, pure and pinned by
tests. ONE press dismisses ONE surface: the companion window is stacked above the
deck, listens on `document` (which propagation reaches before `window`, where the
dock listens) and now marks its own key handled with `preventDefault()`, and the
dock ignores an already-handled event. So Escape closes her first and the next
press closes what she was covering. Focus never falls to the body: dismissing a
panel returns focus to the control that opened it (`dockTabDomId`, which the guide
button outside the border carries too), and lowering the deck moves focus to the
orb that replaces it. There is no focus trap in either direction — the dock is
chrome, not a modal. In window mode "Ask Candi" is a TOGGLE, because the row
announces it with `aria-pressed` and that is a promise the second press undoes the
first.

| Control | Where | Opens |
| --- | --- | --- |
| Guided demo | outside-right | `SimControlDockSimFace` — phase stepper, status line, run controls (Start/Pause/Next, Stop, Reset, Step, Explain) |
| Automations | layer 1 | `SimControlDockOpsFace` — AI screen + automation pass tiles, pass strip |
| Command | layer 1 | `hiring/pipeline/CommandBar` — the free-text pipeline command line, imported, not forked |
| Schedule | layer 1 | `hiring/pipeline/SchedulerControl` — the automation clock, imported, not forked |
| Candi | layer 1 | **depends on the companion's interface mode** (`candiControl()`). In VOICE mode it toggles the `candi` panel — `companion/CompanionInputPanel`, the one-line composer, with her answer showing in the voice strip at the top of the screen. In WINDOW mode it is round 3's **action**: it calls `openDock()` on `CompanionDockProvider` and empties the slot. With no companion in the tree it is not rendered |

The `ops` panel's LABEL is "Automations"; its panel id and its i18n key both stay
`operations`, because an identifier is not a caption. The row's transitions all
live in `shell/simulation/dockPanelSlot.ts` — deliberately a plain factory, not a
`use*` hook, since the dock reaches it after the collapsed early return.

Two round-3 consolidations are worth knowing about. **Schedule was a tile inside
the ops panel** that unrolled `SchedulerControl` beneath the other tiles on its own
`scheduleOpen` boolean — the last surface in the dock that could be open beside
another one. Promoting it to a panel is what makes one-surface-at-a-time hold
*inside* the panel too. And **the guided demo had two doors to the same
`sim.start()`**: a layer-1 slot whose console carried the Start button, and a
"Guided tour" tile in the ops panel that called `sim.start()` directly. They were
one feature reached twice (the command palette's `action-tour` is a third route to
the same call). They are now the single outside-right button, whose three branches
are `guideAction()`: close the console, show it, or begin a run — after which the
ops → sim effect below reveals the console itself.

Mutual exclusion is structural, not an effect: there is one `panel` slot, so a
second panel cannot exist. Opening any panel calls `closeDock()`, and in WINDOW
mode raising the companion empties the slot in return — the chat window counts as
the competing surface in both directions. The control is omitted entirely when
`useOptionalCompanionDock()` is null (the deep-link pages render no dock), rather
than shown as a button that cannot work.

**Round V3 folded the companion INTO that rule for voice mode.** "Ask Candi" was
the deliberate exception — an action raising a competing floating window — and in
voice mode there is no competing window to raise: her answer is a strip at the top
of the screen, so the thing the footer should own is the INPUT. `candi` is
therefore a real member of `DOCK_PANEL_IDS`, and the one subtlety is that its
openness is **not stored in the `panel` state**. `companion.open` already is that
state: the strip reads it, and the command palette sets it from a surface that has
never heard of this dock. `effectiveDockPanel(stored, candi, companionOpen)` joins
the two during render — one line, no effect, and the companion wins the tie so
something that raised her from outside the row puts her input on screen with her
answer. The two effects that move the slot without a click (a guided run
beginning, and Escape) live in `useDockPanelEffects.ts`.

`useControlMode()` in `shell/simulation/simControlCenterKit.ts` no longer picks a
whole face — it picks the DEFAULT layer-2 panel on raise, auto-raises the deck onto
the sim panel the moment a run begins, and names the deck in the layer-1 subtitle:

| Mode | When | Default panel |
| --- | --- | --- |
| `sim` | a guided run is `running`, `done`, or **failed** (`error !== null`), or the page arrived at the public `/?sim=auto` entry | Guided demo |
| `ops` | otherwise | Automations |

`--sim-bar-h` (the height the sim overlays and the companion window anchor above)
is republished on every panel open/close for free: `usePublishBarHeight()`
observes the deck with a `ResizeObserver` rather than recomputing on a state
change. It tracks BOTH deck states — the raised footer row and the collapsed orb,
one call switching refs — and measures from the viewport's bottom edge rather than
reading `offsetHeight`, because the orb is a small fixed element sitting above
that edge and what the companion has to clear is the whole occupied strip. The
fallback in `app/globals.css` applies only before the first measurement.

The guided demo behind the console has its own feature doc:
[`docs/features/simulation/README.md`](../features/simulation/README.md).

`error` is part of the predicate on purpose: the walk's failure path patches
`{ running: false, error, status: "Failed: …" }` in one `setState`, so without it
the deck flipped back to `ops` in the same commit that wrote the failure and the
reason never painted — only `?sim=auto` ever showed it. `start()` and `reset()`
both restore `IDLE_STATE`'s null `error`, so the console still hands the deck
back (and `reset()` is what purges the run's `(SIM)` residue).

The guided run's screening step sends its own `SIM_SCREEN_POLICY.screenWaveOverride`
(`shell/simulation/constants.ts`) to `/api/decisions/screen-wave`. That override
carries an explicit empty `familyFloors` map: `runScreenWave` merges per top-level
field over the workspace's saved rule, and `effectiveFloor()` prefers a per-family
entry over `maxMatchToReject` — so without it a workspace that applied a calibrated
threshold to the demo role's family (`software_engineering`) silently governed the
demo's reject floor. `constants.test.ts` pins that against the real resolver.

### The guided walk reads the board, it does not assume it

Two rules the walk (`shell/simulation/useSimulationWalk.ts` + `useSimulationEngine.ts`)
now follows, because the demo is the first thing a prospect sees and a narration line
that outruns the server is the same class of problem as a marketing overclaim:

- **Stages come from the workspace's own axis, resolved by ROLE.** `getBoard()`
  reads `stages` off the `/api/pipeline` payload (the axis `getPipelineAxis()`
  resolved for this team) and the run derives its entry / screened / offer columns
  through `stageWithRole()` + `screenedLandingStage()`. Stage **ids** are stable and
  a literal id is fine; the axis **shape** is workspace data (Settings → Hiring
  composes it, ids are free-form, the `offer` column is optional), so nothing in the
  walk may assume the shipped five columns. `advanceTo()` bounds itself by that live
  axis and refuses a target the board does not have *before* the first accept —
  previously it accepted the candidate through every remaining column, extending a
  real offer and landing them on the terminal stage, on the way to failing. The
  post-screening wait keys off the stage the accept actually returned rather than the
  literal `"Interview"`. `/api/sim/inbound` files its applicant the same way
  (`stageWithRole("entry", …)`, the seam `cv-intake.ts` and `/api/apply/[id]` already
  use); `sim-inbound-scope.test.ts` pins it.
- **Every response the walk consumes is status-checked.** `okJson()` throws a
  localized, labelled error on any non-OK body, so the failure surfaces as the dock's
  "Failed: …" instead of `?? 0` coercing an error object into a zero shape. This
  matters most at the screening step: `/api/decisions/screen-wave` is
  `requireOperator()`-gated and **rejects the anonymous demo-workspace session**
  (401), refuses a commit whose approval token is missing or no longer matches the
  reviewed set (409), and 400s a rejected override — each of which used to render
  "0 matched · 0 auto-rejected · 0 advanced" over a live cohort and then log
  "passed screening" for a decision wave that never ran.

`/api/sim/offer-link` hands back an offer **capability token**, and `/api/offer/<token>`
is a public route that accepts or declines on the candidate's behalf — so it resolves
the entry in `currentWorkspace()` first and 404s otherwise, like its sibling sim
routes. Entry ids are derived (`m-<candidateId>-<jobId>`), not secret, so the scoping
is the authorization (`offer-link-scope.test.ts`).

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
| `TasksProvider.tsx` + `tasksProviderTypes.ts` | Mounted above the tabs: the 2s/6s poll, start/cancel/retry, the read/unread ack, and `loadFailed` (the last poll did not reach the queue). Survives tab switches |
| `TasksIndicator.tsx` | Sidebar-footer entry: ONGOING count, unread badges, start-failure alert, load meter |
| `TasksTab.tsx` | Header, start-error banner, the filter state (shared by the live table and the history pager) |
| `TasksRunsPanel.tsx` | The recent window as ONE paginated table (`TablePager`, 20 rows) — and the dwell-ack, because this is where the visible page slice lives |
| `TasksTable.tsx` | Table shell + `ColumnFilter` headers, shared by the live window and history |
| `TasksTableRow.tsx` + `TasksRowActions.tsx` + `TasksOutcome.tsx` | One row shape for every status: progress bar + Cancel while active, outcome drawer + Retry once terminal |
| `TasksHistory.tsx` | Runs older than the recent window, via the shared infinite-scroll engine |
| `tasksTabHelpers.ts` (+ `.test.ts`) | Status metadata, the terminal/all status vocabularies, `sortTasks`, time/duration formatting |

Five decisions are load-bearing:

- **Retry replays the persisted params, but only when they still resolve.**
  `POST /api/tasks/[id]/retry` re-runs a failed/interrupted/canceled row
  server-side from `params_json`. `analyze` is the one kind whose params name
  request-scoped uploads (`baseDir`, `variants[].cvPath`) that `runAnalyze` deletes
  in a `finally` on every exit, so the route stats them first and refuses (409)
  when they are gone rather than queueing a run that can only fail again.
- **The ack follows the eye, not the poll.** `seen_at` clears the sidebar's unread
  AND failed badges, so the 1.5s dwell-ack (`unseenIdsOf`, unit-tested) runs over
  the rows `TasksRunsPanel` actually drew — its page slice, already narrowed by the
  column filters. Acking the whole polled window while the table paginates 20 at a
  time acknowledged outcomes on pages the reader never turned to.
- **An unread poll is not an empty one.** A dropped fetch or a 500 leaves `tasks`
  at `[]` on a first load; `loadFailed` carries that third state so the panel says
  the server is unreachable instead of asserting "No recent AI tasks" over runs it
  never read.
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
second way to say something the card already says, and is gone. The rail obeys
that same gate through ONE number: `OnboardingExperience` hands the wizard a
high-water mark **capped at the current step whenever its required input is
unsatisfied**, so clearing the org name after advancing greys the rail back out
instead of leaving an open door past the field the footer is blocking on.
Backward navigation is never capped.

**`finish()` is best-effort per step, never silently so**
(`setupOnboardingFinish.ts`). Each write is allowed to fail without sinking the
rest, but the closing claim is ONE truthful fold of all of them
(`setupFinishOutcome.ts`): every write reports a `SetupPartResult` — `landed`,
`skipped` (an empty invite list, an untouched axis, a blank name: legitimate
answers) or `refused` with the server's machine CODE — and `foldSetupOutcome()`
turns those into the toast. All landed → `setup.toast.saved`; anything refused →
`setup.toast.partialLead` followed by one line per part naming **what** did not
land and **why**, the reason resolved from the code through `useErrorMessage()`
so it arrives in the reader's language.

This matters because none of these writes throws. `setOrgName`/`setOrgLanguage`
return `{ ok: false, code: "ORG_SETTINGS_FORBIDDEN" }` when the caller lacks
`org:manage` (`_lib/org-actions.ts`), `POST /api/org/invites` refuses per address
(400 malformed, 403 above the caller's role, 409 already a member) and the axis
write can answer 409 — a finish that only watched for exceptions closed on a green
"your workspace is set up" while the workspace kept the seed default as its
identity on every generated JD, offer and candidate mail. Invite results carry the
**address** as well as the code, so the partial line names the invitee that was
refused. The Team step keeps the first half of that bargain by refusing to stage
an address the route would reject at all (`SetupInviteEditor.tsx`), so the common
mistake is caught where it is made rather than four steps later.

**The wizard survives a reload** (`setupDraft.ts` + `useSetupDraft.ts`, live mode
only). Answers are mirrored into `sessionStorage` under a key scoped to the
principal — `GET /api/me/onboarding` answers the same user-else-workspace identity
the stamp writes under, because session storage outlives a logout inside one tab
and the next person to sign in must not inherit a half-typed setup. Only the
operator's own answers travel (name, accent, logo, invites, consent, the axis
*draft*, the step); `pipeline.stored`/`counts` and the brain probe are re-read from
the server, so the dirty check keeps comparing against real truth. The merge lets
anything typed in this mount win over the restored value, and finishing or
dismissing clears the slot — a dismissal is an answer, not an interruption.

**It is a real dialog.** The overlay uses the shared `useDialogA11y()` (focus in
on open, Tab trapped, Escape dismisses, page scroll locked), so it joins the same
stack every other modal is on instead of running a bare `keydown` listener beside
an `aria-modal` it never enforced. Each step change moves focus to the step's
`<h2>` (`SetupWizardStepPane.tsx`, remounted per step so the move happens after
the crossfade) and updates a persistent `aria-live` region with
`setup.aria.stepAnnounce`; the org-name field therefore carries no `autoFocus` —
two effects racing for focus on one commit is a coin flip, and the announcement
has to win.

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
server would refuse. That covers the presets too
(`setupPipelinePresets.ts`): *With a work sample* adds its column only when the
loaded axis has room for one (`AXIS_MAX_STAGES`) and does not already carry a step
by that name — in preview mode `base` is a real workspace's board, and either case
would otherwise hand back a draft `axisProblems` refuses (`tooMany`,
`duplicateLabel`) and leave Continue dead on a one-click path.

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

Nothing used to re-read these graphs, which is how the rule above erodes
silently: a barrel import back in a hub re-inflates a hundred routes and every
gate stays green. Two things now read it back:

- **The rule itself is linted.** `eslint.config.mjs` restricts
  `ImportDeclaration[importKind!='type'][source.value='@/app/_lib/db']` at
  `error` across `app/**` and `packages/**` (tests exempt — a test file is never
  compiled into a route). Zero violations when it was added, so anything it fires
  on is new, and it runs wherever `npm run lint` runs: ci.yml's node-quality job
  and `.githooks/pre-push`. `import type` stays legal, because it is free.
- **The graph itself is measurable.** `scripts/perf/check-budget.mjs` walks the
  same first-party graph statically (no build, no server, no `node_modules`) and
  holds each route to a recorded ceiling. It is not yet calibrated or wired into
  CI — see [`../development/performance-budget.md`](../development/performance-budget.md)
  for the two steps that make it a gate.

Both follow-ups are now done (cfdf06b6): the barrel sweep rewrote 178 files to
slice imports — **one** non-type importer of `@/app/_lib/db` remains — and
`plannedInterviewMinutes` moved into the leaf `app/_lib/interview-planned-minutes.ts`,
so `/api/schedule` no longer drags in `interview-run.ts` (115 modules · 1.14 MB).
That work is why every API route in the table above now answers in 7–212 ms warm;
it did **not** move `/`, which is bounded by the 983-module page graph instead.

### Layer boundaries — which context may import which

The barrel rule above is a *cost* rule. Three further import rules are *layering*
rules, and they exist because `context-map.json` splits this tree into 143
contexts across 17 groups while nothing read that split back: an agent scoped to
one context could wire any module to any other and only review would notice.

Each context in the map carries a `category` (`ui` · `api` · `lib` · `data` ·
`test`), and that category is the layer axis. The rules are keyed to the
**directory layout** those categories describe rather than to the map's
per-context `file_paths`, which are a generated snapshot (2026-08-21) that would
make the rules go red on a rename instead of on a coupling mistake.

| Rule | Scope | What it blocks |
| --- | --- | --- |
| `NO_ROUTE_HANDLER_IMPORT` | `app/**`, `packages/**` | importing an `api/**/route.ts` — a route is an HTTP entry point, not a module, and importing one runs its side effects in your graph |
| `UI_NO_DB_VALUE_IMPORT` | `app/features/**`, `app/_components/**` | a **value** import of `_lib/db/*` from a UI module (`import type` stays legal — erased, free) |
| `PACKAGES_NO_APP_IMPORT` | `packages/**` | any import of `app/**`, including `import type`, because the breakage is to source portability rather than to bundle size |

All three are `error` in `eslint.config.mjs`, so they run in `npm run lint` —
`ci.yml`'s `node-quality` job and `.githooks/pre-push` — and a violation is a
failed build, not a review comment.

**Each started at zero**, verified across `app/` and `packages/` before it was
written, counting `import type` separately from value imports: every one of the
~40 `_lib/db` imports under `app/features/**` is already type-only, the value
imports all live in `app/<route>/page.tsx` server components (outside the UI
glob, and the right place for them), nothing imports a route handler, and
`packages/voice-tts` imports nothing from `app/`. So none of them needed a
ratchet, and anything they ever fire on is new — the same standard the
transaction rules and the barrel rule were held to.

> **esquery trap.** These are the first selectors in `eslint.config.mjs` to match
> a *path*, and esquery parses an attribute regex as `"/" [^/]+ "/"` — a literal
> `/` in the pattern, escaped or not, terminates it early and leaves a selector
> that matches nothing. A rule green because it is broken is the worst failure a
> gate has, so the patterns spell the separator `\x2f`, which is the same
> character to `new RegExp` and invisible to esquery's terminator. Do not
> "simplify" them back to `\/`.

> **Flat-config trap.** The UI and packages rules live in their own config
> blocks whose `files:` are *subsets* of the wide `app/**` block. ESLint flat
> config does not merge a rule's options — the last block matching a file
> **replaces** them — so those blocks restate `TRANSACTION_SELECTORS`,
> `DB_BARREL_SELECTOR` and `NO_ROUTE_HANDLER_IMPORT`. Adding a selector to the
> wide block without adding it to the two narrow ones silently switches it off
> for the UI layer and for `packages/`.
