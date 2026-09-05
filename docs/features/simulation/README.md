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
| `simWalkSteps.ts` | The PURE chapter sequencing lifted out of the walk: `SIM_CHAPTERS` (id, tab, spotlight target, timings), `simChapter`, the halt conditions (`matchHalt` / `offerHalt`) and `clickRoute`. Unit-tested beside it, including the invariant that the chapters ARE `SIM_PHASES` |
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
- **`resetSim` clears thirteen tables, and reports all thirteen counts.** Five are
  reachable through the `(SIM)` title (`pipeline_entries`, `jobs`, `jds`, plus
  `offers` and `pipeline_events` by entry). The other eight are reachable only
  through a key the purge already resolves, and until wave 22 they accumulated every
  run: `decision_records`, `schedule_invites`, `consent_events`, `outreach_state` and
  `dev_outbox` by SIM ENTRY ID; `group_evals` and `job_ingests` by SIM JOB ID;
  `jd_revisions` by SIM JD SLUG. The list is `SIM_PURGED_TABLES` in
  `app/_lib/sim-store.ts` and the return shape is derived from it, so a table added
  to the purge is reported automatically. `app/_lib/sim-store.test.ts` seeds one full
  walk's write set and asserts nothing survives.
- **`tasks` and `llm_usage` deliberately survive a reset.** They are the metering
  record of what the run spent; a demo that could erase its own usage ledger is a
  billing hole, not a clean reset.
- **One live run per workspace, and the lease has an OWNER.** `POST /api/sim/reset
  { hold: true }` claims a TTL-bounded lock (`SIM_RUN_TTL_MS`, 5 min) for the length
  of a walk and answers the lease **token** that claim minted; a second start is
  refused with `SIM_RUN_ACTIVE` (409) plus `retryAfterSeconds`, and the walk renders
  it. `DELETE /api/sim/reset` releases on done / stopped / failed, presenting that
  token in the `x-sim-run-token` header (`SIM_RUN_TOKEN_HEADER` in
  `app/features/shell/simulation/simRunLease.ts`, the one definition both sides
  import). A release from anyone else is refused with `SIM_RUN_NOT_OWNER` (409),
  and the walk's own `finally` sends nothing at all when its start was refused
  (`releaseInit(null)` is `null`). Until that pair landed the release was
  unconditional on both sides: a second tab refused with `SIM_RUN_ACTIVE` freed the
  first tab's lease anyway, and the next press wiped a live run. The walk also
  **renews** at every phase gate: `POST /api/sim/reset { renew: true }` with the same
  token pushes the expiry out a full TTL, claiming nothing and purging nothing (a
  non-owner gets `SIM_RUN_NOT_OWNER`). Step mode is the walk's default, so a run
  talked through by a presenter used to outlive its own five-minute protection.
  Without it
  a second visitor's run deleted the first one's job mid-walk — every demo visitor
  and every operator tab share the one `demo` tenant. Per-VISITOR demo namespaces
  would remove the sharing entirely; that is a tenancy-model change and the owner's
  call. The lock is in-process and best-effort: a courtesy against racing tabs on one
  self-hosted server, never an authorization boundary.
- **The console reads the tenant's real state on boot.** `GET /api/sim/reset` is the
  status door: read-only (no claim, no purge, no lease mutation) and tenant-scoped,
  answering `{ runActive, retryAfterSeconds, ownedByMe, residue }`. `ownedByMe` is
  true only for a caller presenting the holder's token, so a reloaded tab reads
  `runActive: true, ownedByMe: false` — "someone is walking, and it is not you" —
  rather than guessing. `residue` counts what a previous walk left behind, from the
  three marker-reachable tables `simResidue()` (`app/_lib/sim-store.ts`) resolves the
  purge's key sets from. The client half is the tiny external store in
  `simRunControl.ts` (`refreshSimDoor` / `subscribeSimDoor` / `simDoorSnapshot`),
  which `useControlMode` reads through `useSyncExternalStore` and the provider
  re-reads after every reset. Before it, the console's whole idea of itself was a
  BROWSER fact: the lease lives on the server, `SimulationProvider` boots to
  `IDLE_STATE`, and nothing asked — so a reloaded tab wore the ops deck while its own
  five-minute lease was still held, and the only control that reaches the console
  from ops (`guideAction` → `start`) was refused by that very lease, with copy telling
  the presenter to stop a run their tab no longer knew about.
- **A lease or leftover residue puts the console in front of the operator.**
  `consoleMode()` (`simRunControl.ts`, the extracted rule `useControlMode` now
  delegates to) adds `door.runActive || door.residue > 0` to the three existing
  reasons (running / done / errored / `?sim=auto`). The console is where Reset lives,
  and both of those states are exactly the ones a Reset answers — so the cleanup is
  reachable from idle instead of only through a run the operator did not want.
- **Reset says why, how much, and that it is working.** `performReset`'s `purge` dep
  returns the door's whole answer (`SimPurgeOutcome` in `simRunControl.ts`), not a
  boolean: the summed thirteen-table count on a 2xx (`totalCleared`), the CODE and
  `retryAfterSeconds` on a refusal. The console renders a success as
  `status.resetCleared` with the number (or `status.resetNothing` at zero, which is
  a success, not a failure) and a refusal through `useErrorMessage()` — with the
  wait attached, via the seconds-carrying variants `errors.simRunActiveSeconds` /
  `errors.simRunNotOwnerSeconds` that `simWaitVariant()` selects (the codes' own
  messages stay placeholder-free for the consumers that resolve them with no values,
  the same split as `errors.forbiddenCapabilityNeeds`). Before it a 409 rendered
  "Cleanup failed. Try again", the one instruction that cannot work: the retry is
  refused for as long as the holder's lease has left, and only the seconds say so.
  The Reset button also carries a local `resetting` flag (disabled + `aria-busy` +
  a spinning glyph) for the multi-second stop → settle → purge, so a presenter does
  not press it twice and race the first pair.
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

- **A closed tab releases its lease on `pagehide`** (`useSimulationWalk.releaseLease`, a
  `keepalive` DELETE carrying the token this tab claimed, wired by `SimulationProvider`).
  It is fire-and-forget: a release lost to a dying tab simply expires on the server's
  terms, and the status door above keeps the resulting wait honest.
- The run lock is per PROCESS. Two `next start` workers (or a future horizontally
  scaled deploy) each hold their own map, so the race it closes reopens there. Moving
  it into SQLite is the obvious next step and was not needed for the single-process
  self-hosted target.
- The dock has **no rendered-component tests**. The pure layer and the slot
  transitions are unit-tested; the keyboard behaviour they describe (focus
  restore on Escape and on collapse, the one-Escape-one-surface ordering against
  the real companion listener) has only been reasoned about and needs a live
  keyboard or an e2e pass.
- `--sim-bar-h` is published by whichever deck state is mounted, but nothing
  asserts that the two never both publish; the invariant rests on the single
  `usePublishBarHeight` call in `SimControlDock.tsx`.
- **The API fallback is now labelled, not silent.** Every scripted "click" is a real
  DOM click; when the control is not on screen within the wait, the walk calls the API
  the button would have called and the run log SAYS so (`log.clickedViaApi`), so a
  viewer can tell a working surface from one the engine papered over. The
  self-scheduling path says the same when it falls back to the recruiter's manual
  confirm (`log.selfScheduleUnavailable`).
- **The guided walk only runs on an OPEN deploy.** A gated deploy refuses at the
  door (above) rather than pretending. Closing this needs the owner decision on demo
  capabilities plus a seeded demo tenant; until then the demo is a self-host/dev
  surface, not a public-SaaS one.
- The seven `SIM_PHASES` are a fixed script. There is no way to run a subset, and
  no way to replay one phase without a full reset.
