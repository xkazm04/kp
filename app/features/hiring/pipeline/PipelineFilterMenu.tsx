"use client";

// One board facet, as a dropdown — State / Score / Source / Sort.
//
// These were four labelled rows of always-visible chips (the `PipelineFacetRow`
// chip grid, deleted once this replaced it): every
// possible value of every dimension on screen at all times, roughly fifteen pills
// stacked under the search box, most of them off. The board they filter got what
// was left. A facet only needs to say TWO things at rest — which dimension it is
// and what is currently on — and the full vocabulary only when you go looking for
// it. So: a closed trigger carrying the active value(s), and the options one click
// away.
//
// Two selection modes behind one trigger, because the four facets are not the same
// kind of control: State/Score/Source are multi-select (OR within a facet, AND
// across — `multiple`, menu stays open, checkbox semantics), Sort is a single
// choice that always has a value (commits and closes, radio semantics).
//
// The menu is PORTALLED and fixed to the trigger's measured rect, the same
// construction as app/_components/Select.tsx and for the same reason here: this bar
// is the top layer of a `${PANEL} overflow-hidden` section, so an absolutely
// positioned menu would be clipped by its own header.

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import { selectConsumesKeyWhileOpen } from "@/app/_components/select-keys";
import { filterMenuKeyAction, nextActiveIndex } from "./pipelineFilterMenuKeys";

export type FilterMenuOption = { value: string; label: string };

export function PipelineFilterMenu({
  label,
  options,
  selected,
  onSelect,
  multiple = false,
  className = "",
}: {
  /** The dimension's name — always visible on the trigger ("State", "Sort"). */
  label: string;
  options: readonly FilterMenuOption[];
  /** Values currently on. Single-select facets pass exactly one. */
  selected: readonly string[];
  /** Toggle (multiple) or set (single) — the caller owns the state shape. */
  onSelect: (value: string) => void;
  multiple?: boolean;
  className?: string;
}) {
  const listId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [active, setActive] = useState(0);

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  // What the closed trigger says beyond its label: the single active value, or the
  // first one plus a count. Deliberately not a bare "(2)" — the first value is the
  // one worth recognizing at a glance, the count only says "and more".
  const chosen = options.filter((o) => selectedSet.has(o.value));
  const summary = chosen.length === 0 ? null : chosen.length === 1 ? chosen[0]!.label : `${chosen[0]!.label} +${chosen.length - 1}`;
  // Multi-select facets are FILTERS: any selection narrows the board, so they carry
  // the coral "something is on" treatment. Sort always has a value and never hides a
  // row, so it stays neutral — a permanently coral control would cry wolf.
  const isFiltering = multiple && chosen.length > 0;

  const openMenu = () => {
    setRect(triggerRef.current?.getBoundingClientRect() ?? null);
    const idx = options.findIndex((o) => selectedSet.has(o.value));
    setActive(Math.max(0, idx));
    setOpen(true);
  };

  const close = (returnFocus = true) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  };

  const commit = (option: FilterMenuOption | undefined) => {
    if (!option) return;
    onSelect(option.value);
    // A multi-select facet is normally used in runs ("interview AND aging"), so the
    // menu stays open; a single choice is done the moment it's made.
    if (!multiple) close();
  };

  // Pin to the trigger and dismiss on outside interaction — same contract as Select.
  useEffect(() => {
    if (!open) return;
    const onScroll = (e: Event) => {
      if (menuRef.current && e.target instanceof Node && menuRef.current.contains(e.target)) return;
      close(false);
    };
    const onResize = () => close(false);
    const onDocDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close(false);
    };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    document.addEventListener("mousedown", onDocDown);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("mousedown", onDocDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  // WHAT a key means lives in pipelineFilterMenuKeys.ts (pure, unit-pinned); this
  // handler only performs it. An open menu still eats the keys it handles, so one
  // Escape can't also close a surrounding dialog (the Select precedent — shared-ui
  // bug #1).
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (open && selectConsumesKeyWhileOpen(e.key)) e.stopPropagation();
    const action = filterMenuKeyAction(e.key, open);
    if (action.preventDefault) e.preventDefault();
    switch (action.kind) {
      case "open":
        openMenu();
        break;
      case "move":
        setActive((a) => nextActiveIndex(a, action.delta, options.length));
        break;
      case "first":
        setActive(0);
        break;
      case "last":
        setActive(Math.max(0, options.length - 1));
        break;
      case "commit":
        commit(options[active]);
        break;
      case "close":
        close(action.returnFocus);
        break;
      default:
        break;
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && options[active] ? `${listId}-${active}` : undefined}
        aria-label={summary ? `${label}: ${summary}` : label}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={onKeyDown}
        className={`focus-ring inline-flex h-10 max-w-[16rem] items-center justify-between gap-2 rounded-md border px-3 text-base transition-colors ${
          isFiltering ? "border-coral bg-coral/10 text-coral" : "border-stone-200 bg-white text-ink hover:border-coral/40"
        } ${className}`}
      >
        <span className="flex min-w-0 items-center gap-1.5 truncate">
          <span className={isFiltering ? "text-coral/80" : "text-steel"}>{label}</span>
          {summary ? <span className="truncate font-semibold">{summary}</span> : null}
        </span>
        <ChevronDown
          size={15}
          aria-hidden
          className={`shrink-0 transition-transform ${isFiltering ? "text-coral" : "text-steel"} ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && rect && typeof document !== "undefined"
        ? createPortal(
            <>
              <div aria-hidden className="fixed inset-0 z-[60]" onMouseDown={() => close(false)} />
              <div
                ref={menuRef}
                style={{
                  top: rect.bottom + 4,
                  left: Math.max(
                    8,
                    Math.min(rect.left, (typeof window !== "undefined" ? window.innerWidth : 1280) - rect.width - 8)
                  ),
                  minWidth: Math.max(rect.width, 200),
                }}
                className="animate-fade-in fixed z-[61] max-w-[calc(100vw-1rem)] rounded-lg border border-stone-200 bg-white shadow-pop motion-reduce:animate-none"
              >
                <ul
                  id={listId}
                  role="listbox"
                  aria-label={label}
                  aria-multiselectable={multiple || undefined}
                  className="max-h-72 overflow-auto p-1"
                >
                  {options.map((option, idx) => {
                    const isSelected = selectedSet.has(option.value);
                    const isActive = idx === active;
                    return (
                      <li key={option.value} id={`${listId}-${idx}`} role="option" aria-selected={isSelected} data-idx={idx}>
                        <button
                          type="button"
                          tabIndex={-1}
                          // Keep DOM focus on the trigger (virtual focus via
                          // aria-activedescendant): a mouse click would otherwise
                          // move it here, and the next Escape/Arrow — which only the
                          // trigger listens for — would go nowhere. Load-bearing for
                          // multi-select, where the menu stays open after a click.
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => commit(option)}
                          onMouseEnter={() => setActive(idx)}
                          className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-base transition-colors ${
                            isActive ? "bg-coral/10 text-coral" : isSelected ? "font-semibold text-ink" : "text-ink hover:bg-paper"
                          }`}
                        >
                          <Check size={15} aria-hidden className={`shrink-0 ${isSelected ? "text-coral opacity-100" : "opacity-0"}`} />
                          <span className="truncate">{option.label}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </>,
            document.body
          )
        : null}
    </>
  );
}
