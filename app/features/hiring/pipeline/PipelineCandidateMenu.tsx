"use client";

// The candidate card's context menu — everything a row used to spend WIDTH on.
//
// A stage column is 280px. The old row carried a `w-28` "Move to…" combobox and an
// AI-actions button INSIDE its flex flow: `opacity-0` hides pixels but still
// reserves layout, so ~134px of every row was permanently spent on controls that
// were invisible until hover, and the candidate's name — the one thing the column
// exists to show — was truncated to about a third of the cell. Those controls live
// here now, and the row spends its width on the name and the score.
//
// Opened by right-click anywhere on the row (which is also how the keyboard reaches
// it: Shift+F10 and the Menu key both fire `contextmenu`) and by the row's own
// focusable trigger, so pointer, keyboard and touch all have a door. Portalled to
// <body> and `fixed`-positioned, because the board scrolls inside an
// `overflow-x-auto` container that would otherwise clip it — the same reason
// _components/Select portals its listbox.

import { useEffect, useLayoutEffect, useRef, useState, type ComponentType } from "react";
import { createPortal } from "react-dom";
import { clampMenuPosition, MENU_WIDTH } from "./pipelineMenuPosition";

type IconProps = { size?: number; className?: string; "aria-hidden"?: boolean };

export type CandidateMenuAction = {
  id: string;
  label: string;
  Icon?: ComponentType<IconProps>;
  onSelect: () => void;
};

/** A labelled run of actions. The label is a presentational group heading, never a
 *  focus stop — `Move to` heads the stage list the drag-and-drop twin offers. */
export type CandidateMenuSection = { id: string; label?: string; items: CandidateMenuAction[] };

export function PipelineCandidateMenu({
  at,
  ariaLabel,
  sections,
  onClose,
}: {
  /** Viewport coordinates of the opening gesture (the pointer, or the trigger's corner). */
  at: { x: number; y: number };
  ariaLabel: string;
  sections: CandidateMenuSection[];
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  // The dismissal subscription below must be armed EXACTLY ONCE per open. Keying it
  // on `onClose` would re-arm it (and restart its grace period) every time the parent
  // re-rendered — the board hands down a fresh closure on each 30s poll — so the
  // callback is read through a ref and the effect owns no dependency on its identity.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  const [pos, setPos] = useState(() =>
    typeof window === "undefined"
      ? at
      : clampMenuPosition(at, { width: MENU_WIDTH, height: 0 }, { width: window.innerWidth, height: window.innerHeight })
  );

  // Re-clamp against the REAL height once the items are laid out, before the
  // browser paints — so a menu opened near the bottom edge never flashes off-screen.
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPos(
      clampMenuPosition(
        at,
        { width: rect.width, height: rect.height },
        { width: window.innerWidth, height: window.innerHeight }
      )
    );
    // preventScroll is LOAD-BEARING, not a nicety. A plain focus() scrolls the item
    // into view, that scroll bubbles to the board's `overflow-x-auto` container, and
    // the capture-phase scroll listener below reads it as "the anchor moved" and
    // closes the menu the same tick it opened — the menu simply never appeared for a
    // real pointer click. There is nothing to scroll to anyway: clampMenuPosition has
    // already put the whole menu inside the viewport.
    el.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true });
  }, [at]);

  // Dismissal: an outside press, Escape, or anything that moves the anchor out from
  // under the menu (scroll, resize) — the menu is `fixed` at a point, so once the
  // board scrolls it is pointing at nothing.
  useEffect(() => {
    // Capture-phase pointerdown closes WITHOUT eating the press, so the click the
    // user actually aimed at still lands. Armed immediately: the press that opened
    // this menu is already over by the time React ran the click handler.
    const close = () => onCloseRef.current();
    const onPointer = (e: Event) => {
      if (e.target instanceof Node && menuRef.current?.contains(e.target)) return;
      close();
    };
    document.addEventListener("pointerdown", onPointer, true);

    // The anchor-moved dismissal is armed TWO FRAMES LATE, and that delay is
    // load-bearing. The gesture that opens the menu can itself scroll the page: a
    // click on a row hanging below the fold makes the browser bring it into view,
    // and that scroll event is dispatched at the next frame — i.e. AFTER the menu
    // has mounted and subscribed. Armed synchronously, the menu dismissed itself
    // inside the very gesture that opened it, and simply never appeared (measured
    // against a real pointer click on a below-the-fold card, 2026-08-05). A press
    // still dismisses instantly via the listener above; only the scroll heuristic
    // waits for the gesture to settle.
    let armed = false;
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        armed = true;
      });
    });
    const onAnchorMoved = (e: Event) => {
      if (!armed) return;
      // Scrolling the menu's OWN list must not close it (capture-phase scroll fires
      // for descendants too) — same carve-out as _components/Select.
      if (e.target instanceof Node && menuRef.current?.contains(e.target)) return;
      close();
    };
    window.addEventListener("scroll", onAnchorMoved, true);
    window.addEventListener("resize", onAnchorMoved);
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
      document.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("scroll", onAnchorMoved, true);
      window.removeEventListener("resize", onAnchorMoved);
    };
  }, []);

  // APG menu keys. The items are real buttons in DOM order, so "the next item" is
  // just the next node — no index bookkeeping to drift out of sync with the sections.
  const onKeyDown = (e: React.KeyboardEvent) => {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    if (items.length === 0) return;
    const here = items.indexOf(document.activeElement as HTMLElement);
    const focus = (i: number) => {
      e.preventDefault();
      items[(i + items.length) % items.length]?.focus({ preventScroll: true });
    };
    if (e.key === "ArrowDown") focus(here + 1);
    else if (e.key === "ArrowUp") focus(here - 1);
    else if (e.key === "Home") focus(0);
    else if (e.key === "End") focus(items.length - 1);
    // (focus() below is preventScroll for the same reason as the open focus — an
    // arrow key must not scroll the board out from under its own menu.)
    else if (e.key === "Escape" || e.key === "Tab") {
      e.preventDefault();
      onClose();
    }
  };

  if (typeof document === "undefined") return null;

  const item =
    "focus-ring flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-base text-ink hover:bg-paper";

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      style={{ left: pos.x, top: pos.y }}
      className="animate-fade-in fixed z-[61] w-56 max-w-[calc(100vw-1rem)] rounded-lg border border-stone-200 bg-white p-1 shadow-pop motion-reduce:animate-none"
    >
      {sections.map((section, i) => (
        <div key={section.id} className={i > 0 ? "mt-1 border-t border-stone-200 pt-1" : undefined}>
          {section.label ? (
            <p className="px-2 pb-0.5 pt-1 text-meta uppercase tracking-wide text-steel">{section.label}</p>
          ) : null}
          {section.items.map(({ id, label, Icon, onSelect }) => (
            <button
              key={id}
              role="menuitem"
              type="button"
              onClick={() => {
                onClose();
                onSelect();
              }}
              className={item}
            >
              {Icon ? <Icon size={14} className="shrink-0 text-steel" aria-hidden /> : null}
              <span className="min-w-0 truncate">{label}</span>
            </button>
          ))}
        </div>
      ))}
    </div>,
    document.body
  );
}
