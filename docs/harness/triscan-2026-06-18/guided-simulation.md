# Guided Pipeline Simulation — Tri-Lens Scan
> Total: 5
> Severity: 1 Critical / 2 High / 2 Medium / 0 Low
> Lens: 2 bug / 1 ui / 2 biz

## 1. The demo's climax has no conversion CTA — it dead-ends on "Run again"
- **Lens**: 🚀 Business Visionary (primary)
- **Severity**: Critical
- **Category**: Conversion / funnel
- **Value**: impact 9/10 · effort 3/10 · risk 2/10
- **File**: `app/features/simulation/SimulationProvider.tsx:607` and `app/features/simulation/SimBar.tsx:46-49`
- **Scenario**: A prospect watches the keyless JD→Hired walkthrough — the single best "aha" moment this top-of-funnel surface produces. On the `hired` phase the bar shows `status: "Done — candidate hired 🎉"` and the only button becomes "Run again". There is no "Book a demo", "Start free", "Talk to sales", or even "Explore on your own" affordance anywhere in the simulation feature (grep for sign-up/CTA across `app/features/simulation` returns nothing).
- **Root cause**: The simulation was built as a mechanism demo, not a conversion funnel; the terminal state only offers replay, so the captured intent at peak interest leaks away.
- **Impact**: The highest-intent moment on the entire sales surface produces zero next-step. Replaying the same canned run has near-zero marginal value; the viewer closes the tab. This is the single biggest ROI miss on a conversion surface.
- **Fix sketch**: When `sim.done`, render a prominent CTA cluster in the SimBar (and/or a small "You just hired a candidate in 90s — do it with your roles" card): primary "Book a demo / Get started", secondary "Run again". Tie copy to the just-completed outcome ("Senior Java Backend Engineer · hired") for relevance.

## 2. Screen step double-advances the entry, leaving its stage ahead of the next step's expectation
- **Lens**: 🐛 Bug Hunter (primary)
- **Severity**: High
- **Category**: Sim/real state-machine desync
- **Value**: impact 7/10 · effort 4/10 · risk 4/10
- **File**: `app/features/simulation/SimulationProvider.tsx:484-487`
- **Scenario**: In the `screen` step the driver calls `advance(targetId)` (plain accept: `Screened → Interview`, clears approval), THEN posts `screen-draft` which sets `approval_kind='screening_review'` on the now-Interview entry, THEN posts a second `accept`. The server's `screening_review` branch (`pipeline.ts:1238-1247`) advances ANOTHER stage (`Interview → Offer`) and sets `approval_kind='calendar'`. The entry exits `screen` already at **Offer**. The `interview` step then confirms the calendar gate and calls `advanceTo(targetId, "Offer")` (line 538) — but the entry is already at Offer, so the first `advance` overshoots to `Hired` and `advanceTo` throws "Could not advance … to Offer".
- **Root cause**: The screen step mixes a manual `advance` with the `screening_review`-approval accept path, which themselves each move a stage; the two compose into a two-stage jump that the later `advanceTo("Offer")` doesn't account for. The `waitEntry` guard (`stage === "Interview" || approvalKind === "calendar"`) masks it because the calendar approval is set even though the stage is Offer.
- **Impact**: Fragile mid-demo break ("Failed: Could not advance …") in front of an audience whenever the path lands on the overshoot. Even when it limps through, the on-screen stage doesn't match the narration ("passed screening → Interview" logged while the row is at Offer).
- **Fix sketch**: Pick ONE advance mechanism for screen. Either drop the standalone `advance(targetId)` and let the single `screening_review` accept do the Screened→Interview move, or skip `screen-draft`/second accept and advance explicitly. Then have `interview` start from a known stage and guard `advanceTo` against an already-past target (return early if `curIdx >= targetIdx`).

## 3. Spotlight targets a not-yet-mounted element after a tab switch → rings `#main` instead of the feature
- **Lens**: 🐛 Bug Hunter (primary)
- **Severity**: High
- **Category**: Spotlight targeting race
- **Value**: impact 6/10 · effort 4/10 · risk 3/10
- **File**: `app/features/simulation/SimulationProvider.tsx:339` and `SimSpotlight.tsx:27-29`
- **Scenario**: `step()` sets `spotlight.selector` (e.g. `[data-sim="schedule"]`) and immediately calls `nav({tab})`. Each tab is a `next/dynamic` lazy import (Workspace.tsx:53-71), so on first navigation to a tab the chunk + its `[data-sim=...]` element aren't in the DOM yet. The spotlight's rAF `measure()` falls back to `document.querySelector("#main")` and rings the whole content region. After a `beat(readMs)` the chunk mounts and the ring jumps to the real target — but the caption ("Automating the interview round…") is already showing against the wrong (whole-page) ring.
- **Root cause**: The spotlight starts measuring the instant the selector is set, with no wait for the just-navigated tab's code-split chunk and target element to render; the `#main` fallback is silent.
- **Impact**: The showcase's signature coachmark visibly mis-points on the first visit to each tab (most acute cold, on slow networks), then snaps — reading as jank on the polished surface meant to impress.
- **Fix sketch**: Have the spotlight only fall back to `#main` after a short grace (e.g. keep `rect=null` until either the selector resolves or ~600ms elapses), or have `step()` `await waitDom(() => document.querySelector(target))` before painting the caption. Fade the ring in once the real target is found rather than animating from the `#main` box.

## 4. Guided-tour status and captions are invisible to screen readers (no aria-live)
- **Lens**: 🎨 UI Perfectionist (primary)
- **Severity**: Medium
- **Category**: Accessibility (live-tour announcements)
- **Value**: impact 5/10 · effort 2/10 · risk 1/10
- **File**: `app/features/simulation/SimBar.tsx:137-140` and `SimSpotlight.tsx:99-100`
- **Scenario**: During an autonomous guided tour the only narration of "what's happening now" is the SimBar status line and the spotlight caption bubble. Neither is in an `aria-live` region. A keyboard/AT user (the population for whom focus management "is critical", per the drawer's own design notes) hears nothing as phases advance — and because the driver dispatches synthetic clicks, the GroupEval/DecisionWave modals also grab focus without any spoken context for why.
- **Root cause**: The status `<p>` and caption `<p>` are plain text nodes; no `role="status"` / `aria-live="polite"` was applied to the dynamically-updating tour narration.
- **Impact**: The guided demo is effectively silent to AT users on a customer-facing surface, undercutting the "a11y matters" posture the codebase otherwise holds (skip-link, focus-trapped Modal, motion-reduce everywhere).
- **Fix sketch**: Wrap the SimBar status line in `role="status" aria-live="polite"` (it already truncates to one line, ideal for announcements), and add `aria-live="polite"` to the spotlight caption container so each phase's title+caption is announced as it changes.

## 5. No abandonment recovery — a mid-run reload silently discards the whole walkthrough
- **Lens**: 🚀 Business Visionary (primary)
- **Severity**: Medium
- **Category**: Abandonment recovery / resilience
- **Value**: impact 5/10 · effort 4/10 · risk 3/10
- **File**: `app/features/simulation/SimulationProvider.tsx:114` (`useState(IDLE_STATE)`)
- **Scenario**: All sim state lives in in-memory React state. If the prospect refreshes, the dev server HMRs, or they deep-link a tab the bar offers (the stepper buttons call `router.replace`, which is fine, but a hard reload isn't), the run resets to Idle with no offer to resume or re-enter. Worse, the SIM-marked DB rows from the interrupted run persist until the next `start()`'s reset, so a returning viewer sees half-built `(SIM)` artifacts scattered across tabs with no explanation or "resume the demo" prompt.
- **Root cause**: No persistence of run phase (e.g. to `sessionStorage` or a `?sim=phase` param) and no detection-on-mount of leftover SIM rows to offer a resume/clean-up.
- **Impact**: A common interruption (refresh, accidental nav, network hiccup) drops the prospect out of the funnel with orphaned demo data visible, eroding trust on the surface meant to build it.
- **Fix sketch**: Persist the current `phase` to `sessionStorage`/URL and, on provider mount, if leftover `(SIM)` rows exist, surface a small "Resume the demo / Clear it" prompt instead of starting cold. At minimum, auto-`/api/sim/reset` on first mount when not running so a returning viewer sees a clean app.
