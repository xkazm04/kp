// The two-layer control dock's FIRST level: the taxonomy of layer-2 panels and
// the pure interaction math behind the icon row. Side-effect-free `.ts` so both
// are unit-testable without rendering the dock (the bare `node --test` runner
// strips `.ts` types but cannot load a `.tsx`).

/** Every panel that can occupy the dock's ONE layer-2 slot.
 *
 *  "Ask Candi" is deliberately ABSENT. It is an action, not a panel — it opens
 *  the companion dock, which is the competing surface — so it can never be the
 *  value of the dock's single `panel` state. That is what makes the operator's
 *  rule (b) ("no two options active at the same time") structural: there is one
 *  slot, so a second panel cannot exist, and no cleanup effect has to enforce it.
 *
 *  Round 3 added "schedule": the automation clock used to be a DeckTile inside
 *  the ops panel that unrolled `SchedulerControl` under the other tiles, on an
 *  independent `scheduleOpen` boolean. That was the last surface in the dock
 *  that could be open beside another one, so promoting it to a first-class
 *  panel is what makes strict one-surface-at-a-time hold INSIDE the panel too. */
export const DOCK_PANEL_IDS = ["sim", "ops", "command", "schedule"] as const;
export type DockPanelId = (typeof DOCK_PANEL_IDS)[number];

/** The subset of those panels the layer-1 icon row itself offers.
 *
 *  "sim" is absent by construction: round 3 consolidated the guided demo's two
 *  entry points (a layer-1 slot AND a "Guided tour" tile inside the ops panel,
 *  both of which reached the SAME `sim.start()`) into the ONE guide button that
 *  sits outside the panel's right border. The console is still a layer-2 panel —
 *  it is just no longer reachable from the row. */
export const DOCK_TOOLBAR_PANEL_IDS = ["ops", "command", "schedule"] as const;

/** Stable DOM ids for the layer-1 button ↔ layer-2 region association. Exactly
 *  one dock mounts per document (SimBar in Workspace), so this needs no useId
 *  plumbing — and living here rather than in the toolbar lets the guide button
 *  outside the panel's border label the "sim" region without importing the row
 *  it is no longer part of. */
export const DOCK_PANEL_DOM_ID = "sim-dock-layer2";
export const dockTabDomId = (id: DockPanelId): string => `sim-dock-tab-${id}`;

/** Toggle semantics for the icon row: re-selecting the ACTIVE layer-1 option
 *  closes its panel, any other selection switches to it. One transition, so
 *  "opening one closes the other" is a property of the reducer rather than of
 *  an effect that could run late or not at all. */
export function toggleDockPanel(current: DockPanelId | null, next: DockPanelId): DockPanelId | null {
  return current === next ? null : next;
}

/** What the ONE guide button outside the panel's right border does when pressed.
 *
 *  It is a single control with three honest states rather than two buttons that
 *  looked like two features: `start` is the invitation (no run in flight, so the
 *  press begins one and the mode effect raises the deck onto the console),
 *  `open`/`close` toggle the console once a run is live, done or failed — which
 *  is where pause/stop/step/explain live. Pure, so the branch is pinned by tests
 *  instead of by reading the JSX. */
export type GuideAction = "start" | "open" | "close";
export function guideAction(panel: DockPanelId | null, mode: "sim" | "ops"): GuideAction {
  if (panel === "sim") return "close";
  return mode === "sim" ? "open" : "start";
}

/** Roving-focus target for the layer-1 toolbar (WAI-ARIA toolbar pattern: arrows
 *  move FOCUS, never activation — activation stays on Enter/Space, because half
 *  the row toggles a panel and half of it fires an action, and an arrow key that
 *  committed either would be a change the operator did not ask for).
 *
 *  Horizontal keys first; the vertical pair is accepted too because the row wraps
 *  on narrow viewports, where Down/Up is what the geometry suggests. Wraps at both
 *  ends. Returns null for every key the toolbar does not own, so the caller knows
 *  not to preventDefault. */
export function nextToolbarIndex(current: number, key: string, count: number): number | null {
  if (count <= 0) return null;
  const cur = current < 0 || current >= count ? 0 : current;
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return (cur + 1) % count;
    case "ArrowLeft":
    case "ArrowUp":
      return (cur - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}
