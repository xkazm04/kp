"use client";

/*
 * The APG tablist keyboard contract, once.
 *
 * `role="tablist"` is a promise: the whole strip is ONE tab stop and the arrow
 * keys move within it. Declaring the roles without the keyboard is worse than
 * declaring nothing — a screen-reader user is told to press arrows, presses
 * them, and nothing happens, while every tab stays its own Tab stop.
 *
 * Four surfaces had hand-rolled the movement (two of them with byte-identical
 * copies of the arithmetic, each carrying a note asking for exactly this
 * promotion on the third caller) and three more declared the roles with no
 * keyboard at all. This hook is the shared implementation: roving tabindex,
 * arrows/Home/End with wrap, the aria-controls / aria-labelledby pair wired
 * from one `useId`, and focus following selection.
 *
 * Controlled on purpose. Every call site already owns its active tab — it is
 * a union id in a modal's logic hook, a channel section, a candidate identity —
 * so the hook takes `active` + `onSelect` rather than holding a second copy
 * that could disagree with the one the panel renders from.
 */

import { useCallback, useId, useRef } from "react";
import type { KeyboardEvent } from "react";

/** The index a tablist key press should move focus + selection to, or null when
 *  the key is not ours (so the event keeps its default — Tab must still leave
 *  the strip, Escape must still reach the dialog). Wraps at both ends, per APG.
 *
 *  Exported as a pure function so the movement rule is testable without a DOM. */
export function nextTabIndex(key: string, index: number, count: number): number | null {
  if (count <= 0) return null;
  const wrap = (n: number) => ((n % count) + count) % count;
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return wrap(index + 1);
    case "ArrowLeft":
    case "ArrowUp":
      return wrap(index - 1);
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

export interface TablistOptions<T extends string> {
  /** The tab ids, in visual order. The strip must render them in this order —
   *  the arrow keys move through the array, not through the DOM. */
  ids: readonly T[];
  /** The selected id. May be off-taxonomy (a tab that just disappeared); the
   *  hook then treats index 0 as current so the arrows still work. */
  active: T;
  onSelect: (id: T) => void;
  /** Set false when the panel this strip drives is rendered by an ancestor and
   *  has no id the tabs can point at. The roving tabindex and the keyboard
   *  still apply; only the aria-controls/labelledby pair is dropped, because a
   *  dangling idref is a worse lie than an absent optional attribute. */
  controlsPanel?: boolean;
}

export interface TabProps {
  role: "tab";
  id: string | undefined;
  "aria-selected": boolean;
  "aria-controls": string | undefined;
  tabIndex: 0 | -1;
  ref: (el: HTMLElement | null) => void;
  onClick: () => void;
}

export interface TablistApi<T extends string> {
  /** Spread on the strip container. Owns the keyboard for the whole strip, so
   *  a per-button handler is never needed. */
  tablistProps: { role: "tablist"; onKeyDown: (e: KeyboardEvent<HTMLElement>) => void };
  /** Spread on each tab button, in `ids` order. */
  tabProps: (id: T) => TabProps;
  /** Spread on the panel. `tabIndex: 0` so the reader who arrowed to a tab can
   *  Tab straight into its content. Undefined when `controlsPanel` is false. */
  panelProps: { role: "tabpanel"; id: string; "aria-labelledby": string; tabIndex: 0 } | undefined;
}

export function useTablist<T extends string>({ ids, active, onSelect, controlsPanel = true }: TablistOptions<T>): TablistApi<T> {
  const uid = useId();
  const refs = useRef<Map<T, HTMLElement | null>>(new Map());

  const found = ids.indexOf(active);
  // An off-taxonomy `active` (the selected tab was removed under us) must not
  // make the arrows dead: fall back to the first tab as the movement origin.
  const index = found >= 0 ? found : 0;

  const tabId = useCallback((id: T) => `${uid}-tab-${id}`, [uid]);
  const panelId = `${uid}-panel`;

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLElement>) => {
      const next = nextTabIndex(e.key, index, ids.length);
      if (next == null) return;
      e.preventDefault();
      const id = ids[next];
      onSelect(id);
      // Focus follows selection (APG's automatic-activation tablist), which is
      // what every one of these strips already did.
      refs.current.get(id)?.focus();
    },
    [ids, index, onSelect]
  );

  const tabProps = useCallback(
    (id: T): TabProps => ({
      role: "tab",
      id: controlsPanel ? tabId(id) : undefined,
      "aria-selected": id === active,
      "aria-controls": controlsPanel ? panelId : undefined,
      tabIndex: id === ids[index] ? 0 : -1,
      ref: (el: HTMLElement | null) => {
        if (el) refs.current.set(id, el);
        else refs.current.delete(id);
      },
      onClick: () => onSelect(id),
    }),
    [active, controlsPanel, ids, index, onSelect, panelId, tabId]
  );

  return {
    tablistProps: { role: "tablist", onKeyDown },
    tabProps,
    panelProps: controlsPanel ? { role: "tabpanel", id: panelId, "aria-labelledby": tabId(ids[index]), tabIndex: 0 } : undefined,
  };
}
