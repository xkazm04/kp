# Architecture Diagrams — UI Perfectionist scan

> Context: The interactive pipeline/architecture diagrams page and the custom PlantUML-style renderer (elkjs layout) that draws component diagrams as styled SVG.
> Files reviewed: 9 of 10
> Total: 7 findings — Critical: 0, High: 3, Medium: 3, Low: 1

## 1. Step drawer is a non-trapping, non-restoring dialog with focus on no element

- **Severity**: High
- **Category**: a11y
- **File**: `app/diagrams/PipelineExplorer.tsx:66` (and `:53-104`)
- **Scenario**: A keyboard or screen-reader user clicks a funnel step, the drawer opens, then they press Tab.
- **Root cause**: `StepDrawer` rolls its own `role="dialog"` with `aria-modal="false"` and only wires an Escape key listener. There is no initial focus move into the panel, no focus trap, and no focus restore to the triggering node on close — unlike the app's real `Modal` (`app/_components/Modal.tsx:82-143`) which does all three. The very next interactive control (the SVG `role="button"` step nodes) sits *behind* the open drawer, so Tab walks into content the user can no longer see in context.
- **Impact**: Focus stays on the just-clicked SVG node behind/under the panel; Tab leaks straight to the page underneath; on close, focus is lost to `<body>`. The drawer is effectively unusable without a mouse, and SR users get no "dialog opened" boundary.
- **Fix sketch**: Reuse the existing `Modal` (or a shared drawer primitive) instead of a bespoke `<aside>`, or port its focus logic: on mount move focus to the panel/close button, trap Tab within the `<aside>`, and `prev?.focus()` on unmount. Keep `aria-modal="true"` since it visually occludies the right half.

## 2. Drawer cannot be dismissed by clicking outside it

- **Severity**: High
- **Category**: interaction-correctness
- **File**: `app/diagrams/PipelineExplorer.tsx:66-72`
- **Scenario**: A user opens a step drawer, then clicks anywhere on the page that is not the funnel and not the panel (e.g. the page header, whitespace, another section) expecting it to close.
- **Root cause**: The fixed wrapper is `pointer-events-none` (deliberately, to keep the left-half funnel clickable) and the panel re-enables `pointer-events-auto` for itself — but there is **no backdrop element** and no outside-click handler. Dismissal is only Escape or the small X. Every other dismissible surface in the app (`Modal`) closes on backdrop click.
- **Impact**: The only discoverable affordances to close are the 20px X (top-right) and Escape (undiscoverable, and keyboard-only). Mouse users who expect click-away dismissal are stuck with a persistent panel; inconsistent with the rest of the product's overlays.
- **Fix sketch**: Add a transparent click-catcher only over the *right* (drawer) region, or — simpler — adopt `Modal`'s backdrop-button pattern scoped so the left funnel column stays interactive. At minimum, document the X as the primary close and enlarge its hit target.

## 3. Below `lg`, the drawer covers the entire funnel, breaking the "relation stays visible" promise

- **Severity**: High
- **Category**: responsiveness
- **File**: `app/diagrams/PipelineExplorer.tsx:27` and `:71`
- **Scenario**: A user on a tablet/narrow laptop (`< 1024px`) clicks a step.
- **Root cause**: The funnel column only reserves space via `lg:pr-[52%]` (line 27) and the panel is only half-width via `lg:w-1/2` (line 71) — both gated on the `lg` breakpoint. Below it the panel is `w-full` and the funnel gets **zero** right padding, so the drawer fully obscures the diagram it is meant to annotate. The component's own comment ("the funnel stays on the left … so the relation is visible") is only true on desktop.
- **Impact**: On the most common non-desktop widths the core value prop (see *this* step highlighted next to its wiring) is lost; the active coral-bordered node is hidden under the panel, with no way to view both. There is also no responsive treatment of the drawer's own dense inner `PlantUml` diagram.
- **Fix sketch**: Below `lg`, render the drawer as a bottom sheet or a full modal whose header names the step (so the lost left-context is replaced by an explicit title), or scroll the active node into view and let the drawer be a true overlay. Verify the inner diagram is horizontally scrollable in the narrow panel.

## 4. Loading and degraded states are inconsistent and partly unannounced

- **Severity**: Medium
- **Category**: missing-loading-state
- **File**: `app/_components/puml/PlantUml.tsx:445-452` (skeleton), `:419-436` (degrade), `app/diagrams/page.tsx:121`
- **Scenario**: A diagram is laying out (ELK async), or is too large / fails layout, or its source file is missing.
- **Root cause**: Three different visual/semantic treatments coexist with no shared pattern: the layout skeleton is `aria-hidden` with `min-height:180` (a SR user hears *nothing* during the async ELK pass), the too-large/failed states are `role="alert"` in muted `text-steel`, while the page-level "Could not read {file}" is `text-coral` (`page.tsx:121`). So the same conceptual "this diagram isn't showing" surfaces in two unrelated colors and one silent state.
- **Impact**: SR users get no "loading" cue and may perceive an empty region; sighted users see error severity encoded inconsistently (coral vs steel) for equivalent failures; layout shift as the 180px skeleton is replaced by a taller diagram (CLS).
- **Fix sketch**: Give the skeleton `role="status"` + an SR-only "Rendering diagram…" label and a height closer to the expected layout; unify the failure copy/treatment into one small component shared by the renderer and the page so "can't read source", "too large", and "render failed" read alike.

## 5. Injected hover/active CSS hardcodes coral hex, bypassing the design tokens it exists to centralize

- **Severity**: Medium
- **Category**: visual-consistency
- **File**: `app/_components/puml/PlantUml.tsx:592`
- **Scenario**: A maintainer retunes the diagram "active/hover" accent via `DIAGRAM_STATUS_TOKENS` or the `C` color map.
- **Root cause**: The `<style>` string injected into the SVG hardcodes `#d65a4a` twice for `.puml-clickable:hover` and `.puml-active` strokes. That is the `coral`/`gate.stroke` value, but it is duplicated as a string literal — the exact "scattered hex literal" anti-pattern the `C` map and `constants.ts` comments say they were created to eliminate (`PlantUml.tsx:16-21`, `constants.ts:27-41`).
- **Impact**: Recoloring the interaction accent requires finding this inline CSS string; it will silently drift from `C.coral` / `DIAGRAM_STATUS_TOKENS.gate.stroke`. Low user-facing blast radius but a real consistency/maintenance trap in a file that explicitly polices this.
- **Fix sketch**: Interpolate `C.coral` (and reuse it for both selectors) into the template string, or move the rule to a static stylesheet keyed off a CSS var sourced from the token map.

## 6. Clickable diagram nodes expose no state or accessible name to assistive tech

- **Severity**: Medium
- **Category**: a11y
- **File**: `app/_components/puml/PlantUml.tsx:160-189`
- **Scenario**: A screen-reader user tabs through the interactive funnel.
- **Root cause**: Each clickable shape gets `role="button"` + `tabIndex=0` but no `aria-label`; the only accessible name is the SVG `<text>` tspans (multi-line, with literal `\n`-split fragments like "Library · JdBuilder"), and the *parent* `<svg>` already claims `role="img"` with its own `aria-label` (`:574-576`), which can hide descendant semantics in some AT. There is also no `aria-expanded`/`aria-pressed` to convey that activating a node opens a panel, nor that the active node is "pressed".
- **Impact**: SR users hear an unlabeled or oddly-concatenated "button", with no signal that it toggles a detail drawer or which one is currently open — the visual coral-border affordance has no programmatic equivalent.
- **Fix sketch**: Add `aria-label={box.label.replace(/\n/g,' ')}` and `aria-expanded`/`aria-pressed` reflecting `active` on clickable nodes; consider `role="img"`→`role="group"` on the interactive SVG so child buttons are reliably exposed.

## 7. Diagram title is announced twice (figcaption + svg aria-label) and the page heading isn't linked to its section

- **Severity**: Low
- **Category**: a11y
- **File**: `app/_components/puml/PlantUml.tsx:474-478` and `:574-576`
- **Scenario**: A screen reader reads a rendered diagram with a title.
- **Root cause**: The `<svg role="img">` carries `aria-label={"Diagram: " + title}` (`:576`) *and* a visible `<figcaption>` repeats the same title (`:475-477`), so the title is voiced twice. Separately, page `<section>`s (`page.tsx:107`) have an `<h2>` but no `aria-labelledby` tying the region to it.
- **Impact**: Minor verbosity/redundancy for SR users; weak landmark association for the diagram sections. Cosmetic-leaning but a genuine semantic duplication.
- **Fix sketch**: When a `<figcaption>` is present, reference it from the svg via `aria-labelledby` instead of repeating the string in `aria-label`; add `aria-labelledby` from each `<section>` to its `<h2>` id.
