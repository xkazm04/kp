/*
 * The pure half of the kit Menu (Menu.tsx): what a key means, how the virtual focus steps, and what
 * the closed trigger says. Recovered from the retired board's facet menu (pipelineFilterMenuKeys.ts,
 * deleted with the old Pipeline view at b7fde0c32) when the kit got its own menu part for the
 * Pipeline parity port. No React, no DOM, so node:test pins the contract.
 *
 * The menu is a combobox with VIRTUAL focus: DOM focus stays on the trigger and
 * aria-activedescendant names the current option, so the key handling is the part an innocent edit
 * breaks without anything throwing.
 */

export type MenuKeyAction =
  | { kind: "open"; preventDefault: true }
  | { kind: "move"; delta: 1 | -1; preventDefault: true }
  | { kind: "first"; preventDefault: true }
  | { kind: "last"; preventDefault: true }
  | { kind: "commit"; preventDefault: true }
  | { kind: "close"; returnFocus: boolean; preventDefault: boolean }
  | { kind: "ignore"; preventDefault: false };

const IGNORE = { kind: "ignore", preventDefault: false } as const;

/**
 * CLOSED: only the arrows and the two activation keys open it; Escape is left to whatever surrounds
 * the trigger (a closed menu that ate Escape would keep the pane or dialog above it open).
 * OPEN: arrows / Home / End move, Enter / Space commit, Escape closes and hands focus back to the
 * trigger, Tab closes WITHOUT reclaiming focus so the browser's tab order continues.
 */
export function menuKeyAction(key: string, open: boolean): MenuKeyAction {
  if (!open) {
    return key === "ArrowDown" || key === "ArrowUp" || key === "Enter" || key === " " ? { kind: "open", preventDefault: true } : IGNORE;
  }
  switch (key) {
    case "ArrowDown": return { kind: "move", delta: 1, preventDefault: true };
    case "ArrowUp": return { kind: "move", delta: -1, preventDefault: true };
    case "Home": return { kind: "first", preventDefault: true };
    case "End": return { kind: "last", preventDefault: true };
    case "Enter": case " ": return { kind: "commit", preventDefault: true };
    case "Escape": return { kind: "close", returnFocus: true, preventDefault: true };
    case "Tab": return { kind: "close", returnFocus: false, preventDefault: false };
    default: return IGNORE;
  }
}

/** Step the virtual focus, wrapping, skipping disabled options. An empty or all-disabled list answers
 *  the start index (never NaN: `% 0` is NaN and a NaN index names no option). */
export function nextActiveIndex(active: number, delta: number, disabled: readonly boolean[]): number {
  const n = disabled.length;
  if (n <= 0) return 0;
  for (let step = 1; step <= n; step++) {
    const i = (((active + delta * step) % n) + n) % n;
    if (!disabled[i]) return i;
  }
  return Math.max(0, Math.min(active, n - 1));
}

/** What a closed facet says beyond its name: the one value on, or the first plus "+N". Deliberately
 *  never a bare count: the first value is the one worth recognising at a glance. */
export function menuSummary(labels: readonly string[]): string | null {
  if (!labels.length) return null;
  return labels.length === 1 ? labels[0] : `${labels[0]} +${labels.length - 1}`;
}

/** Where the list sits: under the trigger, flipped above when it would leave the viewport, clamped
 *  inside it horizontally with an 8px margin. */
export function menuPlacement(
  trigger: { top: number; bottom: number; left: number; width: number },
  menu: { width: number; height: number },
  viewport: { width: number; height: number },
): { top: number; left: number; minWidth: number } {
  const minWidth = Math.max(trigger.width, 200);
  const width = Math.max(menu.width, minWidth);
  const below = trigger.bottom + 4;
  const top = below + menu.height > viewport.height - 8 && trigger.top - 4 - menu.height >= 8 ? trigger.top - 4 - menu.height : below;
  const left = Math.max(8, Math.min(trigger.left, viewport.width - width - 8));
  return { top, left, minWidth };
}
