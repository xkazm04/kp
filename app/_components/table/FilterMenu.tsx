"use client";

// Internal menu pieces for the shared filter primitives (ColumnFilter,
// SearchSelect): the anchored/fixed-position popover shell and its searchable
// option-list body. Split out of ColumnFilter.tsx so that file stays under the
// 200-line cap. Copy resolves through `table.filters.*` in four locales.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { Check, Search } from "lucide-react";
import { FIELD } from "@/app/_components/ui/recipes";

export type Option = { value: string; label: string };

const optionRow = (isActive: boolean, isSelected: boolean) =>
  `focus-ring flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm ${
    isActive ? "bg-coral/10 text-coral" : isSelected ? "font-semibold text-ink" : "text-ink hover:bg-paper"
  }`;

// The menu body: an optional search box over a scrollable single-select list, with
// an optional "clear" row at the top.
//
// A11y: this is the APG listbox half of a combobox, built to the same shape as
// `Select` (its trigger is `role=combobox`, minted here's sibling — see ColumnFilter).
// It had NO roles at all: to a screen reader it was a div of buttons, and past Tab it
// had no keyboard at all. Focus stays in the filter box (it autofocuses on open) while
// the ACTIVE row moves by state, so `aria-activedescendant` is the only channel that
// says which row Arrow/Home/End reached and which one Enter will pick — the id must
// therefore always resolve, including after a filter narrows the list to nothing.
export function OptionList({
  options,
  value,
  onPick,
  searchable = true,
  clearLabel,
  listId,
}: {
  options: Option[];
  value: string;
  onPick: (value: string) => void;
  searchable?: boolean;
  /** When set, shows a top row that resets the filter to "" (e.g. "All roles"). */
  clearLabel?: string;
  /** Minted by the trigger, which points `aria-controls` at it. */
  listId: string;
}) {
  const t = useTranslations("table");
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const needle = q.trim().toLowerCase();
  const shown = needle ? options.filter((o) => o.label.toLowerCase().includes(needle)) : options;
  // ONE array for the rows a reader sees. The clear row used to live outside the map,
  // so any index-based navigation would have been off by one for exactly the menus that
  // have a clear row (every column filter).
  const rows: Option[] = clearLabel ? [{ value: "", label: clearLabel }, ...shown] : shown;
  const optionId = (idx: number) => `${listId}-opt-${idx}`;
  const activeDescendant = active >= 0 && active < rows.length ? optionId(active) : undefined;

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (rows.length > 0) setActive((i) => (i + 1) % rows.length);
        break;
      case "ArrowUp":
        e.preventDefault();
        if (rows.length > 0) setActive((i) => (i - 1 + rows.length) % rows.length);
        break;
      case "Home":
        e.preventDefault();
        setActive(0);
        break;
      case "End":
        e.preventDefault();
        setActive(rows.length - 1);
        break;
      case "Enter": {
        e.preventDefault();
        const row = rows[active];
        if (row) onPick(row.value);
        break;
      }
      default:
        break;
    }
  };

  return (
    <div>
      {searchable ? (
        <div className="relative border-b border-stone-100 p-1.5">
          <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-steel" aria-hidden />
          <input
            autoFocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            placeholder={t("filters.search")}
            aria-label={t("filters.searchOptions")}
            aria-controls={listId}
            aria-activedescendant={activeDescendant}
            className={`${FIELD} w-full py-1 pl-7 text-sm`}
          />
        </div>
      ) : null}
      <ul id={listId} ref={listRef} role="listbox" className="max-h-56 overflow-auto p-1">
        {rows.map((o, idx) => (
          <li key={`${o.value}-${idx}`} id={optionId(idx)} role="option" aria-selected={value === o.value} data-idx={idx}>
            <button
              type="button"
              onClick={() => onPick(o.value)}
              onMouseEnter={() => setActive(idx)}
              className={optionRow(idx === active, value === o.value)}
            >
              <Check size={13} className={value === o.value ? "opacity-100" : "opacity-0"} aria-hidden /> {o.label}
            </button>
          </li>
        ))}
        {shown.length === 0 ? <li className="px-2 py-2 text-sm text-steel">{t("filters.noMatches")}</li> : null}
      </ul>
    </div>
  );
}

// A menu pinned under a measured anchor rect, fixed to the viewport so it isn't
// clipped by a scrolling table. Renders a full-viewport backdrop that closes it.
//
// PORTALED TO document.body, for the same reason Modal is (see its header): the
// rect comes from getBoundingClientRect, i.e. VIEWPORT coordinates, but `position:
// fixed` resolves against the nearest ancestor that establishes a containing block
// — and a `transform` does exactly that. Any tab that fades its body in with a
// framer `motion.div` (the Archetypes projection switch, the Matrix mode switch)
// silently became that ancestor, so the menu landed offset by the wrapper's own
// origin — reading as "the popup opens in the middle of the table". Rendering into
// document.body means the coordinates and the containing block are the same space
// again, whatever the call site is nested in.
export function AnchoredMenu({
  anchor,
  onClose,
  width,
  children,
}: {
  anchor: DOMRect;
  /**
   * WHY the reason: the owner puts focus back on the trigger when the menu
   * closes (the reader dismissed it, or picked a row), and must NOT when the
   * anchor merely went stale. A scroll-close that also called `.focus()` would
   * scroll the header back under the reader, undoing the scroll that caused it.
   */
  onClose: (reason: "dismiss" | "reposition") => void;
  width: number;
  children: React.ReactNode;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  // The listeners are registered ONCE and read the latest onClose through a ref
  // (the `useEvent` shape). They used to depend on `onClose`, which every call
  // site passes as an inline arrow — so all four window listeners were torn down
  // and re-added on every render of the surrounding table, for the whole life of
  // the open menu.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  useEffect(() => {
    // Scroll closes the menu because the anchor rect is measured ONCE — scroll the
    // page or the table and a fixed-position menu would hang in mid-air over the
    // wrong header. Hence the capture listener: `scroll` does not bubble, and the
    // capture phase is the only way to see a scroll inside the table's own
    // overflow container.
    //
    // …which is also why the menu has to exempt ITSELF. The option list is
    // `max-h-56 overflow-auto` (about seven rows), so a Role filter with more
    // options than that — the Archetypes roster, the webhook role picker — fired
    // this same capture listener the moment the reader scrolled the list, closing
    // the menu under them and making every option past the seventh unreachable by
    // pointer. Nothing moves relative to the anchor when the list scrolls inside
    // itself, so that scroll is precisely the one that must NOT close.
    const onScroll = (e: Event) => {
      const target = e.target as Node | null;
      if (target && menuRef.current?.contains(target)) return;
      onCloseRef.current("reposition");
    };
    const close = () => onCloseRef.current("reposition");
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current("dismiss");
    };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKey);
    };
  }, []);
  // No document during SSR / the first render pass — nothing to portal into yet.
  if (typeof document === "undefined") return null;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const left = Math.max(8, Math.min(anchor.left, vw - width - 8));
  // Flip above the trigger when the menu would run off the bottom (a filter in the
  // last visible header row of a tall page). The option list caps at ~16rem, so
  // 280px is a safe worst-case height to reserve.
  const below = anchor.bottom + 4;
  const flip = below + 280 > vh && anchor.top > vh - anchor.bottom;
  const style = flip ? { bottom: vh - anchor.top + 4, left, width } : { top: below, left, width };
  return createPortal(
    <>
      {/* z above the Modal overlay (z-50) so the menu works inside the Add modal. */}
      <button
        type="button"
        aria-hidden
        tabIndex={-1}
        onClick={() => onClose("dismiss")}
        className="fixed inset-0 z-[60] cursor-default"
      />
      <div ref={menuRef} style={style} className="fixed z-[70] rounded-lg border border-stone-200 bg-white shadow-pop">
        {children}
      </div>
    </>,
    document.body
  );
}
