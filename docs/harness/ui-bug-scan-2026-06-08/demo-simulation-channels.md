# Demo Simulation & Channels — UI+Bug combined scan
> Total: 4 findings (0 crit / 0 high / 4 med / 0 low)
> Group: Automation & Simulation | Lens mix: 3 bug / 1 ui | Files read: 22

Scope read: all 18 listed files + corroborating reads (Modal.tsx, offers-store.ts,
screen-wave/route.ts, group-eval/route.ts, jds/save/route.ts, DraftsPanel.tsx,
jobs/status/route.ts, Workspace.tsx, globals.css z-scale).

VERIFIED-HARDENED (not re-flagged, per brief): comms-dispatch per-decision failure
isolation (`dispatchInterviewReminder` swallows only the *post-send* audit write,
lines 167-173; delivery throw still propagates); `candidateRecipient` deliverability
ladder (contact → label → id → traceable literal, comms-dispatch.ts:25-31);
WebhookChannel dead-letter alerting (comms.ts:82-85); offers TOCTOU/CAS hardening
(offers-store getOrCreateOpenOffer / markOfferResponded). `resetSim` no-swallow
policy (sim-store.ts:21-64) is correct. The sim's data-sim-entry/click selectors all
resolve to real anchors (DraftsPanel, AiReviewCard, ScheduleTab, offer page). The
SIM_SCREEN_POLICY coupling invariant (constants.ts:66) is guarded at import + in CI.

---

## 1. Reset mid-run re-orphans the rows it just deleted (in-flight mutations outrace the stop flag)
- **Severity**: Medium
- **Lens**: 🐛 Bug
- **Category**: Race condition / reset mid-flow / data residue
- **File**: `app/features/simulation/SimulationProvider.tsx:619-625` (reset) vs `:354-387` (source action), `app/_lib/sim-store.ts:40-69`
- **Scenario**: Presenter clicks **Reset** while the `source` phase is running. `reset()` sets `ctrl.current.stop = true`, wakes the gate, `await`s `POST /api/sim/reset` (which DELETEs every `(SIM)` row), then sets state to IDLE. But the engine only honors `ctrl.current.stop` at its *checkpoints* (`beat`/`gate`/`waitDom`/`waitEntry`, and the explicit guard at line 380). The mutating fetches that run *before* the next checkpoint — `saveJd` (jds/save:356), the publish click / `POST /api/jobs/{id}/publish` (367-373), and the sourcing it triggers — have no stop check, so they complete and re-create `(SIM)` pipeline_entries/jobs **after** `resetSim()` already ran its DELETE.
- **Root cause**: Cooperative cancellation gated only at await points; the destructive reset runs concurrently with un-checkpointed network writes instead of awaiting loop teardown. `resetSim()` returns truthful counts for the moment it ran, but the run keeps writing.
- **Impact**: Reset reports success yet leaves freshly-sourced sim candidates/jobs behind; the next `Start` (which also resets first) usually masks it, but a Reset meant to "clean up and walk away" leaves a dirty board. Stage/queue views briefly show resurrected rows.
- **Fix sketch**: Have `reset()` (and `stop()`) await actual loop teardown before issuing the destructive reset — e.g. a `runDone` promise the `run()` finally-block resolves — or add `if (ctrl.current.stop) throw new SimStop()` immediately before each mutating fetch in `action()` bodies so an in-flight phase bails before writing. Simplest: in `reset()`, wake + await teardown, *then* `fetch("/api/sim/reset")`.

## 2. `getEntries` swallows non-OK pipeline responses into an empty list → misleading demo halts
- **Severity**: Medium
- **Lens**: 🐛 Bug
- **Category**: Silent failure at a trust boundary
- **File**: `app/features/simulation/SimulationProvider.tsx:161-163`
- **Scenario**: `getEntries` does `fetch("/api/pipeline").then(r => r.json()).then(p => p.entries ?? [])` with no `r.ok` check and no `.catch`. A transient 500 (DB busy, server error) returns a body like `{ error }` whose `.entries` is undefined → coerced to `[]`. Every consumer then treats "the server errored" as "the pipeline is empty": the `match` step throws `"No Screened candidate to walk (intake returned none)."` (line 421), `waitEntry`/`runGroupEval`'s cohort reads see nobody, and the cohort-advance loop silently no-ops.
- **Root cause**: No response-status gate; a failed fetch is indistinguishable from a genuinely empty result. (A thrown network error is also uncaught here — it would reject the awaiting step — but the OK/500-with-JSON case is the silent one.)
- **Impact**: A momentary backend hiccup surfaces to the presenter as a confident but wrong "intake returned none" / "group eval couldn't be generated" message during a live demo, sending them debugging seeding instead of the real (transient) cause.
- **Fix sketch**: In `getEntries`, throw on `!r.ok` with a labelled message (`Pipeline fetch failed (${r.status})`) so the run's catch reports the true cause via the existing "Failed: …" path, rather than masquerading as empty data. Mirror the explicit failure policy already documented for `waitEntry`/`advanceTo`.

## 3. `/api/sim/offer-link` GET has no try/catch — a throw becomes an opaque 500 that halts the walk cryptically
- **Severity**: Medium
- **Lens**: 🐛 Bug
- **Category**: Missing error handling at an API route / validation boundary inconsistency
- **File**: `app/api/sim/offer-link/route.ts:9-14`
- **Scenario**: Every other sim route (`inbound`, `reset`, `screen-draft`, `offer-draft`) wraps its body in `try/catch` and returns a JSON `{ error }` with a 4xx/5xx. `offer-link` does not: `getOpenOfferForEntry(entryId)` opens its own better-sqlite3 handle (offers-store.ts) and can throw on SQLITE_BUSY/contention or a malformed DB. An unhandled throw yields Next's default 500 with a non-JSON body. The consumer at `SimulationProvider.tsx:540` does `await fetch(...).then(r => r.json())`, which then throws a JSON-parse error, and the offer step halts with a cryptic `Unexpected token <…>` instead of "offer token not found".
- **Root cause**: Route omits the error envelope its siblings all use; the candidate read can throw and there's nothing to convert it to a structured response.
- **Impact**: Demo-stopping during the climactic offer step, with a misleading parse-error message that points at the client, not the DB. Inconsistent contract across the sim API surface.
- **Fix sketch**: Wrap the handler in `try/catch` returning `NextResponse.json({ error: … }, { status: 500 })`, matching the other four sim routes. The existing `?? null` token fallback already handles the legitimate "no open offer yet" case.

## 4. Eval/wave Modals (z-50) sit above the SimBar controls (z-47) — Stop becomes unreachable and the backdrop dismisses the eval instead of pausing
- **Severity**: Medium
- **Lens**: 🎨 UI
- **Category**: Z-index layering / control reachability / focus-trap interaction
- **File**: `app/_components/Modal.tsx:140-141` (z-50 + full-screen backdrop button) vs `app/globals.css:105-108` (sim z-scale: spotlight 45 / drawer 46 / bar 47 / frame 48); used by `SimDecisionWave.tsx:15` and `SimGroupEval.tsx:12`
- **Scenario**: During the `screen` step the screening-wave Modal is shown for a fixed `beat(3400)` (SimulationProvider:448-451), and during `offer` the GroupEval Modal is shown for `beat(2600)` (524-526). Both render through the shared `Modal`, which portals to `document.body` at **z-50** with a full-viewport backdrop `<button>` — strictly above the SimBar (z-47). While either modal is open the presenter cannot click **Stop / Pause** (covered by the backdrop), and clicking anywhere outside the modal fires the Modal's `onClose` → `closeScreenWave`/`closeGroupEval`, which only dismisses the eval — the run keeps going. The Modal also focus-traps and binds Escape to its own `onClose`, so Escape can't reach the bar either.
- **Root cause**: The reused generic `Modal` outranks the entire purpose-built sim z-scale and owns a page-covering dismiss target + focus trap; the sim never coordinates its overlay layering with the modal's hardcoded z-50.
- **Impact**: Loss of run control (no Stop/Pause) for ~2.6–3.4s windows, and a backdrop click that *looks* like it should pause/stop instead silently tears down the comparison the viewer was reading. Degraded but recoverable (the modal auto-clears).
- **Fix sketch**: Either render these sim modals below the SimBar (a sim-scoped wrapper at a z below `--z-sim-bar`, lifting SimBar to a top tier), or have the sim's modal `onClose` route through `pause()` so dismiss == pause during a scripted beat. Minimally, raise SimBar above z-50 so Stop/Pause stay clickable while an eval modal is up.
