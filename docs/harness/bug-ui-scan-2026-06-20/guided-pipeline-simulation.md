# Guided Pipeline Simulation — UI Perfectionist scan

> Context: A keyless, guided JD→Hired demo that drives real clicks through the app with a bottom bar, spotlight, explain drawer, group-eval and offer frames.
> Files reviewed: 12 of 19
> Total: 7 findings — Critical: 1, High: 3, Medium: 2, Low: 1

## 1. Offer/schedule frame blocks the whole page while running, with no visible way out

- **Severity**: Critical
- **Category**: a11y / focus-trap / dead-control
- **File**: `app/features/simulation/SimOfferFrame.tsx:44-49`
- **Scenario**: During the Interview and Hired phases the driver mounts a full-screen `SimOfferFrame` over a dimmed backdrop (`bg-ink/45`, `fixed inset-x-0`). The backdrop's `onClick` is `paused ? closeFrame : undefined`, so while the run is *playing* (the default `?sim=auto` mode), clicking the backdrop does nothing. The only dismiss affordances are the small X button and the Escape key.
- **Root cause**: The overlay is a modal-weight surface but is deliberately non-dismissable mid-step to avoid "tearing down the flow." Combined with no focus management, a keyboard user who tabs lands on app controls *behind* the dimmed iframe that they cannot see, and a mouse user has no obvious escape (backdrop is inert, X is tiny).
- **Impact**: For the marketing auto-run (the highest-intent, first-impression path), a prospect who wants to interact is stuck behind an inert dim layer for several seconds with no discoverable exit; screen-reader/keyboard users get no focus moved into the dialog and no `role="dialog"`/`aria-modal` on the frame container at all.
- **Fix sketch**: Give the frame container `role="dialog"` + `aria-modal="true"` + `aria-label`, move focus to the close button on open and restore on close, and surface a persistent, visible "Close" hint (not just the icon). Allow backdrop-dismiss even while running (it already falls back to the API path), or auto-pause the run when the frame is interacted with.

## 2. Explainer drawer claims `role="dialog"` but never manages focus or labels its close

- **Severity**: High
- **Category**: a11y
- **File**: `app/features/simulation/SimExplainDrawer.tsx:23-41`
- **Scenario**: The drawer renders `<aside role="dialog" aria-label="Simulation explainer">` and auto-opens at the start of every run (`start()` sets `explainOpen: true`). It is intentionally non-modal, but a `role="dialog"` with no focus moved into it and no return-focus on close is an ARIA contract it doesn't honor.
- **Root cause**: `role="dialog"` was applied for semantics but the component treats itself as an inline panel (correct for non-modal UX) — the two are mismatched. Screen readers announce a dialog that focus never enters.
- **Impact**: SR users hear "dialog" but Tab order stays in the page; the relationship is confusing, and the auto-open is never announced.
- **Fix sketch**: For a non-modal helper panel, drop `role="dialog"` in favor of `role="complementary"`/`<aside aria-label>` (which it already is) or `role="region"`, OR commit to dialog semantics with focus-in/out management. Keep it one or the other.

## 3. Pipeline stepper buttons render as the only label; no accessible list/step semantics

- **Severity**: High
- **Category**: a11y / semantics
- **File**: `app/features/simulation/SimBar.tsx:118-146`
- **Scenario**: The chronology is an `<ol>` of `<button>`s where the active step gets `aria-current="step"`, but the list has no accessible name and the `→` separators are `aria-hidden`. The numbered/check glyph (`<Check>` vs `<span>{i+1}</span>`) conveys completion *visually only* — a SR user hears just the phase label with no "completed/current/upcoming" state except on the single active item.
- **Root cause**: State is encoded purely in color/icon (moss check, coral fill, stone idle) with no text or `aria-label` equivalent.
- **Impact**: A SR/keyboard user cannot tell which phases are done vs pending; color-only state also fails contrast/colorblind expectations (moss-on-tint check is the sole "done" cue).
- **Fix sketch**: Add `aria-label` to the `<ol>` (e.g. "Pipeline phases"), and give each button an `aria-label` that includes state ("Screen — completed" / "Interview — current" / "Offer — upcoming"). Keep the check icon as decoration (`aria-hidden`).

## 4. Spotlight ring + 9999px box-shadow scrim is `pointer-events-none` — but the page underneath stays clickable mid-demo

- **Severity**: High
- **Category**: interaction-correctness / misleading-affordance
- **File**: `app/features/simulation/SimSpotlight.tsx:67-81`
- **Scenario**: The spotlight dims the page with a `box-shadow: 0 0 0 9999px rgba(...)` scrim on a `pointer-events-none fixed inset-0` overlay. Because the overlay ignores pointer events, the dimmed-but-live page behind it remains fully clickable while the driver is mid-beat dispatching its own `el.click()`.
- **Root cause**: The scrim is purely visual; nothing gates user input during an automated beat. A user clicking a dimmed control races the scripted click and `nav()` calls, which read/replace `searchRef` — a stray user navigation mid-walk can desync the run (it relies on its own `nav()` landing first).
- **Impact**: During the hands-off auto-run, a curious click on a dimmed control can fire a real mutation or change tabs out from under the walk, producing a confusing "Failed: timed out waiting for…" halt.
- **Fix sketch**: While `running && !paused && !awaitingNext`, intercept page input — either make the scrim `pointer-events-auto` (swallowing clicks, with a "paused to interact?" affordance) or disable the underlying main region (`inert` attribute) during a beat.

## 5. Group-eval and screen-wave modals can't be reopened once auto-dismissed; timed reveals are uncontrollable

- **Severity**: Medium
- **Category**: missing-control / UX-pacing
- **File**: `app/features/simulation/SimulationProvider.tsx:488-489` (and `:563-564`), `app/features/simulation/SimDecisionWave.tsx:10-20`
- **Scenario**: The screening wave shows for a hardcoded `beat(3400)` then `patch({ screenWave: null })`; the group-eval comparison shows for `beat(2600)` then clears. The Modal's only control is `onClose`, and `onRerun` is a no-op (`() => undefined`). A viewer who wants to keep reading the audit/comparison cannot — it vanishes on a timer and there's no replay.
- **Root cause**: Reveal duration is a fixed sleep, not gated by the step checkpoint or a user "continue". The reused `GroupEvalModal`/`Modal` expose actions the sim deliberately stubs.
- **Impact**: The most information-dense, trust-building screens (auto-reject rationale, field ranking) disappear before a real prospect can absorb them, and `Step` mode doesn't pause *inside* the reveal — only between phases.
- **Fix sketch**: Replace the fixed `beat()` reveals with a `gate()` checkpoint (or a "Continue" button inside the modal) so the viewer dismisses when ready; wire `onRerun` to re-trigger `runGroupEval` instead of a no-op so the stubbed control isn't dead.

## 6. Match-score `role="meter"` bars and the decision list lack a per-row keep/reject text cue beyond color

- **Severity**: Medium
- **Category**: a11y / color-only-state
- **File**: `app/features/simulation/SimDecisionWave.tsx:34-60`
- **Scenario**: Each decision row uses a coral (reject) vs moss (keep) bar fill plus a colored pill. The pill *does* carry text ("Rejected"/"Kept"), which is good — but the `role="meter"` bar's `aria-label` is only `Match score ${d.matchScore}`, while the *fill color* (coral vs moss) silently re-encodes the keep/reject decision a second time with no text. The `FitTierBadge` tier is also color-forward.
- **Root cause**: Decision state is doubled into bar color without an accessible equivalent on the bar itself; fine for sighted users, redundant-but-invisible for SR users.
- **Impact**: Minor for SR (the pill text saves it), but the bar's color carries semantic meaning a colorblind user may misread (red bar = "bad score" vs "rejected").
- **Fix sketch**: Keep the pill text; make the bar color purely about magnitude (one neutral accent) so color isn't overloaded to mean both "score" and "decision," or add the decision to the bar's `aria-label`.

## 7. Spotlight caption bubble uses fixed pixel clamps that break on small/zoomed viewports

- **Severity**: Low
- **Category**: responsiveness
- **File**: `app/features/simulation/SimSpotlight.tsx:57-65`
- **Scenario**: Caption placement is computed with literals: `captionLeft = Math.max(8, Math.min(rect.left, window.innerWidth - 420))` and `max-w-md`. On a ~360px-wide phone (or 200%+ browser zoom), `innerWidth - 420` is negative, so the clamp collapses to `8` and the `max-w-md` (28rem) bubble overflows the right edge; the pointer-tail math (`Math.min(..., 360)`) then aims at the wrong spot.
- **Root cause**: Hardcoded 420/360px assume a desktop-width viewport; the bubble width isn't responsive to `innerWidth`.
- **Impact**: On mobile/zoom the explanatory caption — the whole point of the spotlight — clips or detaches from its ring.
- **Fix sketch**: Make the bubble width `min(420px, calc(100vw - 16px))` and derive the clamps from that effective width; or render the caption full-width-bottom on `innerWidth < 480`. Also gate the spotlight's `box-shadow`/`animate-ping` on `motion-reduce` consistently (the ring already does, the scrim doesn't fade but is fine).
