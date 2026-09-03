# Guided simulation & the bottom control dock

Two things that share one directory (`app/features/shell/simulation/`) because
they share one surface: the **guided demo** — a scripted run that walks the whole
hiring story across the workspace's tabs — and the **control dock**, the
always-mounted footer that starts it, narrates it, and is the operator's console
the rest of the time.

Everything here is client state. There is no simulation table, no simulation API
and no key: the run drives the app's own endpoints, and the dock reads state that
already exists elsewhere. See "Data model" below.

## Entry points

| Entry | Where | What it does |
| --- | --- | --- |
| The Candi orb | `SimControlDockOrb.tsx`, bottom-center, always mounted in the workspace | Raises the deck. Carries the awaiting-decisions beacon (coral) and the AI-busy dot (moss) at rest |
| The guide button | `SimControlDockRail.tsx` (`DockGuide`), outside the panel's right border | The ONE door into the demo. Three honest states — `start` / `open` / `close` (`guideAction()`) |
| `/?sim=auto` | the localized landing CTA, via `GET /api/demo` | The page arrives with `useControlMode()` already `sim`, so the deck loads raised on the console |
| Command palette | `WorkspaceCommandPalette.tsx` `action-tour` | Same `sim.start()`. Absent on the deep-link pages, which mount no `SimulationProvider` |

### The public demo door (`GET /api/demo`)

The landing's "Try the live demo" CTA is a plain navigation to `/api/demo`. What
that door can honestly deliver depends on the deploy, and it now **says so** instead
of minting a session the walk cannot use:

| Deploy | Answer |
| --- | --- |
| **Open** (no `KP_SECRET` / no operator password) | `302 → /?sim=auto`. The proxy passes through and `resolveCaller()` folds to `OWNER_CAPS`, so the scripted run really works. No cookie: `signSession()` would throw without the secret |
| **Gated**, `KP_DEMO_ENABLED` on | `302 → /?demo=unavailable&code=DEMO_NOT_PROVISIONED` |
| **Gated**, demo off | `302 → /?demo=unavailable&code=DEMO_DISABLED` |

Both gated answers are refusals because a `demo`-workspace session is
`{ authed: false, caps: EMPTY_CAPS }` in `app/_lib/auth/current-user.ts`: the walk's
first write (`POST /api/jds/save`, `jd:write`) answers 401, and so do
`/api/decisions/screen-wave` and `/api/schedule/invite`. Nothing seeds the `demo`
workspace either, so even a permitted walk would source zero applicants. Before this,
the door minted the session anyway and the tour narrated four confident steps over a
role that was never created.

`DemoUnavailableNotice.tsx` resolves the `code` through `errors.<CODE>` in the
reader's language — the same vocabulary every coded API refusal uses — and falls back
to the generic body for an older link with no code. Pinned by
`app/api/demo/demo-door.test.ts` (all three deploy shapes plus the per-IP limit).

Granting a demo session `pipeline:write` inside the isolated demo tenant, and seeding
that tenant at first mint, is an **open owner decision** — it re-opens the
blast-radius question for `jds/save`, `screen-wave` and `schedule/invite`.

`SimBar.tsx` → `SimControlDock.tsx` is mounted by `WorkspaceSimSurfaces.tsx`, a
DOM sibling of `<main>` inside `SimulationProvider` + `TasksProvider`. The heavy
overlays beside it (spotlight, offer frame, explain drawer, screening-wave modal)
are lazy; the dock is not — it is chrome.

## User flows

**Operating the board (the 95% case).** The deck is down. The orb shows how many
candidates need a human decision. Raising it gives a WAI-ARIA `role="toolbar"`
row — Automations · Command · Schedule · Ask Candi — over exactly ONE open panel.
Re-selecting the active control closes it; Escape closes it and returns focus to
the control that opened it; lowering the deck moves focus to the orb.

**Watching the demo.** Pressing the guide button calls `sim.start()`. The mode
flips to `sim`, and the one transition effect in `useDockPanelEffects.ts` raises
the deck onto the console, which then carries Pause/Next, Stop, Reset, Step and
Explain while the run navigates tabs, spotlights elements and opens the offer
frame. The run is interruptible at every beat (`SimStop`), and `reset()` waits
for the in-flight mutation before deleting the SIM rows.

**Asking Candi.** Her control is whichever of two things the companion's
interface mode makes it (`candiControl()`): in `voice` a layer-2 panel of this
dock, in `dock` an action that toggles the left companion window. See
[`docs/features/companion/README.md`](../companion/README.md) §Dock.

## Surface table

| File | Holds |
| --- | --- |
| `SimControlDock.tsx` | The deck itself: collapsed/raised, the single `panel` slot, the footer row |
| `simControlDockLayers.ts` | The PURE layer: panel taxonomy, `toggleDockPanel`, `effectiveDockPanel`, `guideAction`, `nextToolbarIndex`, `dockEscapeAction`. Unit-tested beside it |
| `dockPanelSlot.ts` | The layer-1 transitions (a plain factory, not a hook — the dock reaches it after the collapsed early return). Unit-tested beside it |
| `useDockPanelEffects.ts` | The two ways the slot moves without a click: a run beginning, and Escape |
| `SimControlDockToolbar.tsx` | LAYER 1 — the roving-tabindex icon row |
| `SimControlDockPanelBody.tsx` | LAYER 2 — the one open panel, dispatched by id |
| `SimControlDockOrb.tsx` / `SimControlDockRail.tsx` | The rest state, and the two elements outside the panel's borders |
| `simControlCenterKit.ts` | `useControlMode()`, `useAutomationPass()`, `usePublishBarHeight()` |
| `SimulationProvider.tsx` + `useSimulationEngine.ts` + `useSimulationWalk.ts` | The run: state, the per-phase engine, the tab walk |
| `simRunControl.ts` | The PURE run-control ordering: `runControlFlags` (start/pause/resume/stop) and `performReset` (stop -> settle -> purge, reporting whether the purge succeeded). Unit-tested beside it |
| `simDrafts.ts` | The two DETERMINISTIC drafts (screening recommendation, offer letter), composed from the `simulation.draft.*` catalog keys. Unit-tested per locale beside it |
| `constants.ts` (`SIM_PHASES`) | The seven-phase chronology — design · source · match · screen · interview · offer · hired — each pinned to the tab it walks to |

**`--sim-bar-h`** is the one thing this feature publishes to the rest of the app.
`usePublishBarHeight()` measures the deck from the viewport's bottom edge and sets
it on `<html>`; the sim overlays and the companion window
(`bottom-[calc(var(--sim-bar-h)_+_8px)]`) anchor above it. It tracks BOTH deck
states — the raised footer row and the collapsed orb — so the companion never
lands on top of the orb. The fallback in `app/globals.css` applies only before the
first measurement.

## Data model

None. Nothing in this directory owns a table.

- The run's state is React state in `SimulationProvider` (`SimState`), discarded
  on unmount.
- The rows the demo creates are ordinary jobs / candidates / pipeline entries,
  written through the app's own APIs and deleted again by `reset()`.
- The dock's numbers are read, never stored: `useAttention()` for the awaiting
  count, `useTasks()` for the batch-screen task, `companion.open` for Candi.
- Keyless: the demo is a product surface that must work with no API key at all —
  the LLM-backed steps degrade to the same deterministic fallbacks the real
  features use, and the walk never blocks on a provider.

## What the demo may never do

The tour drives the REAL paths — that is its whole claim — so three of them carry
an explicit guard rather than a special-case fake:

- **It never mails anybody.** Every sim artifact's title carries the `(SIM)` marker
  (`constants.ts`: `markSimTitle` / `isSimTitle`, the same predicate `resetSim` purges
  by and the analytics filters exclude). `sendCommUnlessSim` in
  `app/_lib/comms-dispatch.ts` reads that marker off the pipeline entry's
  **`jobTitle`** and, when it matches, records the outbox row directly on the
  `simulation` channel with status `queued` instead of handing it to the channel
  resolver — so on a deploy with a relay configured (`COMMS_WEBHOOK_URL` or the
  UI-configured one) a demo run cannot POST a schedule invite, an offer letter or an
  interviewer brief about a seeded profile to the customer's mail relay. The row is
  still written: the Outbox entry is part of what the tour shows, and `queued` is the
  outbox's honest "recorded locally, nothing will deliver it" state. Pinned by
  `app/_lib/comms-dispatch-sim.test.ts`.
- **It never lies about cleanup.** `reset()` awaits the purge and reports `reset`
  only on a 2xx; a failed purge renders the localized "cleanup failed" status in red
  (`simulation.status.resetFailed`, four locales) so the presenter retries instead of
  starting the next run on the last one's residue. The ordering (stop -> settle ->
  purge) and the failure reporting are `performReset` in `simRunControl.ts`.
- **It never answers in English.** The five `/api/sim/*` routes answer
  `jsonRefusal` / `safeJsonError` with `SIM_*` codes, which the walk resolves through
  `resolveErrorMessage` in the reader's language; the two deterministic drafts are
  composed from the catalogs in the entry's own locale (else its team default, the
  same `resolveCommsLocale` precedence every candidate letter uses).

## Known gaps

- The dock has **no rendered-component tests**. The pure layer and the slot
  transitions are unit-tested; the keyboard behaviour they describe (focus
  restore on Escape and on collapse, the one-Escape-one-surface ordering against
  the real companion listener) has only been reasoned about and needs a live
  keyboard or an e2e pass.
- `--sim-bar-h` is published by whichever deck state is mounted, but nothing
  asserts that the two never both publish; the invariant rests on the single
  `usePublishBarHeight` call in `SimControlDock.tsx`.
- **The guided walk only runs on an OPEN deploy.** A gated deploy refuses at the
  door (above) rather than pretending. Closing this needs the owner decision on demo
  capabilities plus a seeded demo tenant; until then the demo is a self-host/dev
  surface, not a public-SaaS one.
- The seven `SIM_PHASES` are a fixed script. There is no way to run a subset, and
  no way to replay one phase without a full reset.
