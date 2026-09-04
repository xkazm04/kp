// The two-layer control dock's FIRST level: the taxonomy of layer-2 panels and
// the pure interaction math behind the icon row. Side-effect-free `.ts` so both
// are unit-testable without rendering the dock (the bare `node --test` runner
// strips `.ts` types but cannot load a `.tsx`).
//
// The one import is TYPE-ONLY and therefore erased before the test runner sees
// it: which shape the companion wears is the companion's taxonomy, and copying
// its union in here would be a second place for it to be wrong.
import type { CompanionUiMode } from "@/app/features/shell/companion/companionPrefs";

/** Every panel that can occupy the dock's ONE layer-2 slot.
 *
 *  Round 3 added "schedule": the automation clock used to be a DeckTile inside
 *  the ops panel that unrolled `SchedulerControl` under the other tiles, on an
 *  independent `scheduleOpen` boolean. That was the last surface in the dock
 *  that could be open beside another one, so promoting it to a first-class
 *  panel is what makes strict one-surface-at-a-time hold INSIDE the panel too.
 *
 *  Round V3 added "candi", and it is the interesting one: until V3 "Ask Candi"
 *  was deliberately NOT a panel — it was an action that raised a competing
 *  floating window, so the two closed each other by hand. In VOICE mode there is
 *  no competing window any more: her answer is a strip at the top of the screen
 *  and typing to her is an input the footer should own, so the input becomes a
 *  panel and the exclusivity rule covers it for free. In WINDOW mode nothing
 *  changed — see `candiControl()`, which is the whole of the difference. */
export const DOCK_PANEL_IDS = ["sim", "ops", "command", "schedule", "candi"] as const;
export type DockPanelId = (typeof DOCK_PANEL_IDS)[number];

/** The subset of those panels the layer-1 icon row itself offers.
 *
 *  "sim" is absent by construction: round 3 consolidated the guided demo's two
 *  entry points (a layer-1 slot AND a "Guided tour" tile inside the ops panel,
 *  both of which reached the SAME `sim.start()`) into the ONE guide button that
 *  sits outside the panel's right border. The console is still a layer-2 panel —
 *  it is just no longer reachable from the row. */
export const DOCK_TOOLBAR_PANEL_IDS = ["ops", "command", "schedule"] as const;

/** What the row's Candi control IS right now.
 *
 *  Three answers, and the mode is the only thing that decides between the first
 *  two. In `voice` the companion has no window to raise — her answer is a strip
 *  at the top of the screen — so the control TOGGLES the `candi` panel like any
 *  other layer-1 option, with the same exclusivity and the same `aria-expanded`.
 *  In `dock` it stays the round-3 ACTION: it empties the slot and raises the
 *  left window, which is the competing surface, so the two close each other.
 *  `absent` is the deep-link pages, which render no companion at all — the
 *  control is omitted rather than drawn as a button that cannot work, in EITHER
 *  mode, so the row never carries a dead member.
 *
 *  Pure and unit-tested because it is what makes the panel id conditional, and a
 *  conditional member is what the roving-focus count has to agree with. */
export type CandiControl = "panel" | "action" | "absent";
export function candiControl(hasCompanion: boolean, mode: CompanionUiMode): CandiControl {
  if (!hasCompanion) return "absent";
  return mode === "voice" ? "panel" : "action";
}

/** How many members the roving-focus row has. The Candi control is the only
 *  conditional one, and it is LAST — so its presence or absence never renumbers
 *  the three fixed panels under an index the operator is standing on. */
export const CANDI_TOOLBAR_INDEX = DOCK_TOOLBAR_PANEL_IDS.length;
export function toolbarMemberCount(candi: CandiControl): number {
  return DOCK_TOOLBAR_PANEL_IDS.length + (candi === "absent" ? 0 : 1);
}

/** Stable DOM ids for the layer-1 button ↔ layer-2 region association. Exactly
 *  one dock mounts per document (SimBar in Workspace), so this needs no useId
 *  plumbing — and living here rather than in the toolbar lets the guide button
 *  outside the panel's border label the "sim" region without importing the row
 *  it is no longer part of. */
export const DOCK_PANEL_DOM_ID = "sim-dock-layer2";
export const dockTabDomId = (id: DockPanelId): string => `sim-dock-tab-${id}`;

/** The panel the operator can actually SEE, joining the stored slot with the
 *  companion's own open state.
 *
 *  The candi panel is not stored — `companion.open` is its state, and it already
 *  had to exist (the strip reads it, and the command palette sets it from a
 *  surface that has never heard of this dock). So the join is a one-line render
 *  derivation instead of a second copy kept in step by an effect, and every
 *  transition in `dockPanelSlot` reasons about the answer this returns rather
 *  than about what happens to be in the useState.
 *
 *  SHE WINS the tie deliberately. When something outside the row raises her —
 *  the palette's "Ask Candi", a deep link — her input must be on screen with her
 *  answer, so it covers whatever the row had open. Selecting any other option
 *  lowers her in the same transition, which is what makes the cover temporary
 *  rather than a stuck state. */
export function effectiveDockPanel(
  stored: DockPanelId | null,
  candi: CandiControl,
  companionOpen: boolean
): DockPanelId | null {
  return candi === "panel" && companionOpen ? "candi" : stored;
}

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

/** What ONE Escape keypress does to the dock — the whole decision, pure, because
 *  the dock is not the only surface listening for that key.
 *
 *  TWO SURFACES, ONE KEY. The companion window is stacked ABOVE the deck (it
 *  floats at `bottom: calc(var(--sim-bar-h) + 8px)`, i.e. on top of the footer
 *  row) and it is the more recent intent whenever it is up, so it is the one
 *  Escape dismisses first. It listens on `document`; this dock listens on
 *  `window`, so the companion's handler always runs first by propagation order
 *  — and it now marks the event handled. Reading `defaultPrevented` here is
 *  therefore what stops one keypress from closing two surfaces. The dock marks
 *  its own for the same reason in the other direction: anything above it that
 *  listens later (a future overlay on `window`) gets the same courtesy.
 *
 *  `focusId` is where focus goes afterwards. The dock is chrome, not a modal —
 *  there is no trap to release — but a panel dismissed by keyboard must not drop
 *  focus onto the body, so it returns to the layer-1 control that opened it
 *  (`dockTabDomId`, which the guide button outside the border carries too). */
export type DockEscape = { closeCompanion: boolean; focusId: string };
export function dockEscapeAction({
  key,
  defaultPrevented,
  collapsed,
  shown,
  modalUp,
}: {
  key: string;
  defaultPrevented: boolean;
  collapsed: boolean;
  shown: DockPanelId | null;
  modalUp: boolean;
}): DockEscape | null {
  if (key !== "Escape" || defaultPrevented) return null;
  // Nothing to dismiss (deck down, slot empty), or the dock's own modal owns the
  // key — a dialog the operator opened is always the more recent intent.
  if (collapsed || shown === null || modalUp) return null;
  // Her panel's state is her own `open`, so emptying the slot is not enough:
  // without this, Escape would hide the input and leave the strip on screen with
  // nothing to type into. Reached only when she did NOT handle the key herself.
  return { closeCompanion: shown === "candi", focusId: dockTabDomId(shown) };
}
