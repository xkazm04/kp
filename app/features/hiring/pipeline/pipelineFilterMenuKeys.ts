// The board filter menu's keyboard DECISION, lifted out of the component.
//
// PipelineFilterMenu is a combobox with virtual focus (DOM focus stays on the
// trigger; `aria-activedescendant` names the current option), which makes its key
// handling the part most likely to be broken by an innocent edit and the part
// hardest to notice when it is: nothing throws, the menu just stops answering a key,
// or starts swallowing one that belonged to the drawer around it.
//
// Splitting the switch out makes that contract runnable without a DOM — the same
// move `pipelineMenuPosition.ts` and `pipelineMoveTargets.ts` made for their own
// halves of this bar. The component keeps the effects (focus, portal, commit); this
// module only says WHAT a key means.
//
// Pure: no React, no DOM, no next-intl.

/** What a key press means. `preventDefault` rides along because it is part of the
 *  decision, not of the wiring: Space must not scroll while the menu is open, and
 *  Tab must NOT be prevented or the reader is trapped in the facet bar. */
export type FilterMenuKeyAction =
  | { kind: "open"; preventDefault: true }
  | { kind: "move"; delta: 1 | -1; preventDefault: true }
  | { kind: "first"; preventDefault: true }
  | { kind: "last"; preventDefault: true }
  | { kind: "commit"; preventDefault: true }
  | { kind: "close"; returnFocus: boolean; preventDefault: boolean }
  | { kind: "ignore"; preventDefault: false };

const IGNORE = { kind: "ignore", preventDefault: false } as const;

/**
 * Resolve a key press against the menu's open state.
 *
 * CLOSED: only the four keys that open a listbox do anything — both arrows and both
 * activation keys. Everything else, Escape included, is left to whatever surrounds
 * the bar; a closed facet that ate Escape would keep the drawer above it open.
 *
 * OPEN: arrows/Home/End move the virtual focus, Enter/Space commit the active
 * option, Escape closes AND hands focus back to the trigger (the only element
 * listening for these keys), and Tab closes WITHOUT reclaiming focus, so the
 * browser's own tab order continues.
 */
export function filterMenuKeyAction(key: string, open: boolean): FilterMenuKeyAction {
  if (!open) {
    return key === "ArrowDown" || key === "ArrowUp" || key === "Enter" || key === " "
      ? { kind: "open", preventDefault: true }
      : IGNORE;
  }
  switch (key) {
    case "ArrowDown":
      return { kind: "move", delta: 1, preventDefault: true };
    case "ArrowUp":
      return { kind: "move", delta: -1, preventDefault: true };
    case "Home":
      return { kind: "first", preventDefault: true };
    case "End":
      return { kind: "last", preventDefault: true };
    case "Enter":
    case " ":
      return { kind: "commit", preventDefault: true };
    case "Escape":
      return { kind: "close", returnFocus: true, preventDefault: true };
    case "Tab":
      return { kind: "close", returnFocus: false, preventDefault: false };
    default:
      return IGNORE;
  }
}

/** Step the virtual focus, wrapping at both ends. An EMPTY facet answers 0 rather
 *  than `NaN`: `% 0` is NaN, and a NaN index names no option, so
 *  `aria-activedescendant` would point at nothing while the trigger claimed a value. */
export function nextActiveIndex(active: number, delta: number, length: number): number {
  if (length <= 0) return 0;
  return (active + delta + length) % length;
}
