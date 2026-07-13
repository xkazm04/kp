"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { selectConsumesKeyWhileOpen } from "./select-keys";
import { createPortal } from "react-dom";
import { Check, ChevronDown, type LucideIcon, Search } from "lucide-react";

// Canonical single-select — the dual-theme replacement for a native <select>.
//
// A native <select> renders its option popup through the OS, which ignores the
// app's theme tokens: in Spark Dark the closed control re-skins but the open
// option list stays a light OS menu (or a generic grey via color-scheme), never
// the app's ink canvas. This is a fully custom listbox instead — trigger + a
// portalled, fixed-positioned menu — so both the control AND its options resolve
// through the same tokens (bg-white/text-ink/border-stone-*), correct in both
// themes by construction.
//
// The menu is portalled to <body> and fixed to the trigger's measured rect so it
// escapes any `overflow-hidden`/`overflow-x-auto` ancestor (dense tables) and
// stacks above the Modal (z-50) — the exact clip/stack traps a naive absolute
// menu hits on this app's surfaces. Keyboard + a11y match the APG listbox
// pattern: role=combobox trigger, role=listbox menu, arrow/Home/End/Enter/Esc,
// typeahead, and aria-activedescendant. Reduced motion is honored (fade only).

export type SelectOption = {
  value: string;
  label: string;
  /** Optional leading glyph (e.g. a seniority mark) shown in the row and trigger. */
  icon?: LucideIcon;
  disabled?: boolean;
};

type MenuRow = SelectOption & { __clear?: boolean };

export function Select({
  value,
  onChange,
  options,
  placeholder = "Select…",
  ariaLabel,
  id,
  name,
  className = "",
  size = "md",
  sizeVariant,
  disabled = false,
  searchable,
  clearable = false,
  clearLabel = "Clear",
  searchPlaceholder = "Search…",
  noMatchesLabel = "No matches",
  invalid = false,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  /** Accessible name — required when there's no associated visible <label htmlFor>. */
  ariaLabel?: string;
  id?: string;
  name?: string;
  className?: string;
  /** Compact/standard height. `sizeVariant` is the family-wide name (matches
   *  TextInput/TextArea); `size` is kept as a back-compat alias. */
  size?: "sm" | "md";
  sizeVariant?: "sm" | "md";
  disabled?: boolean;
  /** Show a filter box above the list. Defaults to auto (on when > 8 options). */
  searchable?: boolean;
  /** Prepend a row that resets the value to "" (an explicit "no selection"). */
  clearable?: boolean;
  clearLabel?: string;
  /** Localizable menu microcopy (English defaults). */
  searchPlaceholder?: string;
  noMatchesLabel?: string;
  invalid?: boolean;
}) {
  const listId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [active, setActive] = useState(0);
  const [query, setQuery] = useState("");
  const typeahead = useRef<{ buffer: string; timer: number | null }>({ buffer: "", timer: null });

  const withSearch = searchable ?? options.length > 8;
  const selected = options.find((o) => o.value === value) ?? null;

  // The rows the menu actually renders: an optional "clear" row, then the
  // (search-filtered) options. Active index addresses THIS array.
  const rows = useMemo<MenuRow[]>(() => {
    const needle = query.trim().toLowerCase();
    const shown = needle ? options.filter((o) => o.label.toLowerCase().includes(needle)) : options;
    return clearable ? [{ value: "", label: clearLabel, __clear: true }, ...shown] : shown;
  }, [options, query, clearable, clearLabel]);

  const openMenu = () => {
    if (disabled) return;
    const r = triggerRef.current?.getBoundingClientRect() ?? null;
    setRect(r);
    setQuery("");
    // Preselect the current value's row (or the first enabled row) so the arrow
    // keys start from a sensible place.
    const idx = options.findIndex((o) => o.value === value);
    setActive(clearable ? (idx >= 0 ? idx + 1 : 0) : Math.max(0, idx));
    setOpen(true);
  };

  const close = (returnFocus = true) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  };

  const commit = (row: MenuRow | undefined) => {
    if (!row || row.disabled) return;
    onChange(row.value);
    close();
  };

  // Keep the menu pinned to the trigger and dismiss on outside interaction. Scroll
  // inside the menu's own list must NOT close it (capture-phase scroll fires for
  // descendants too), so those are filtered out.
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

  // Focus the search box on open; scroll the active row into view as it changes so
  // keyboard navigation never runs off-screen. (open only flips on a user click, so
  // useEffect timing is fine and avoids the SSR useLayoutEffect warning.)
  useEffect(() => {
    if (open && withSearch) searchRef.current?.focus();
  }, [open, withSearch]);
  useEffect(() => {
    if (!open) return;
    const el = menuRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const moveActive = (delta: number) => {
    if (rows.length === 0) return;
    let next = active;
    for (let i = 0; i < rows.length; i += 1) {
      next = (next + delta + rows.length) % rows.length;
      if (!rows[next]?.disabled) break;
    }
    setActive(next);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openMenu();
      }
      return;
    }
    // While OPEN, keys the Select consumes must not bubble to a parent dialog's key
    // handler: an open Select inside a useDialogA11y trap must eat its own Escape/Enter,
    // or one Escape closes BOTH the dropdown and the surrounding dialog (bug-ui shared-ui
    // #1). A CLOSED Select (handled above) lets Escape bubble so it can close the dialog.
    if (selectConsumesKeyWhileOpen(e.key)) e.stopPropagation();
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        moveActive(1);
        break;
      case "ArrowUp":
        e.preventDefault();
        moveActive(-1);
        break;
      case "Home":
        e.preventDefault();
        setActive(0);
        break;
      case "End":
        e.preventDefault();
        setActive(rows.length - 1);
        break;
      case "Enter":
        e.preventDefault();
        commit(rows[active]);
        break;
      case "Escape":
        e.preventDefault();
        close();
        break;
      case "Tab":
        close(false);
        break;
      default:
        // Typeahead only when there's no search box to type into.
        if (!withSearch && e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
          const ta = typeahead.current;
          ta.buffer += e.key.toLowerCase();
          if (ta.timer) window.clearTimeout(ta.timer);
          ta.timer = window.setTimeout(() => (ta.buffer = ""), 600);
          const hit = rows.findIndex((r) => !r.disabled && r.label.toLowerCase().startsWith(ta.buffer));
          if (hit >= 0) setActive(hit);
        }
        break;
    }
  };

  const sizeCls = (sizeVariant ?? size) === "sm" ? "h-9 px-2.5 text-sm" : "h-10 px-3 text-base";
  const TriggerIcon = selected?.icon;

  return (
    <>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        disabled={disabled}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={onKeyDown}
        className={`focus-ring inline-flex items-center justify-between gap-2 rounded-md border bg-white text-left text-ink transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
          invalid ? "border-red-400" : "border-stone-200 hover:border-coral/40"
        } ${sizeCls} ${className}`}
      >
        <span className={`flex min-w-0 items-center gap-2 truncate ${selected ? "text-ink" : "text-steel"}`}>
          {TriggerIcon ? <TriggerIcon size={15} className="shrink-0 text-steel" aria-hidden /> : null}
          <span className="truncate">{selected ? selected.label : placeholder}</span>
        </span>
        <ChevronDown size={15} aria-hidden className={`shrink-0 text-steel transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {name ? <input type="hidden" name={name} value={value} /> : null}

      {open && rect && typeof document !== "undefined"
        ? createPortal(
            <>
              {/* Backdrop below the menu, above the Modal (z-50) so a Select inside a
                  dialog still dismisses on outside click. */}
              <div aria-hidden className="fixed inset-0 z-[60]" onMouseDown={() => close(false)} />
              <div
                ref={menuRef}
                style={{
                  top: rect.bottom + 4,
                  left: Math.max(8, Math.min(rect.left, (typeof window !== "undefined" ? window.innerWidth : 1280) - rect.width - 8)),
                  minWidth: rect.width,
                }}
                className="animate-fade-in fixed z-[61] max-w-[calc(100vw-1rem)] rounded-lg border border-stone-200 bg-white shadow-pop motion-reduce:animate-none"
              >
                {withSearch ? (
                  <div className="relative border-b border-stone-100 p-1.5">
                    <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-steel" aria-hidden />
                    <input
                      ref={searchRef}
                      value={query}
                      onChange={(e) => {
                        setQuery(e.target.value);
                        setActive(0);
                      }}
                      onKeyDown={onKeyDown}
                      placeholder={searchPlaceholder}
                      aria-label={ariaLabel ? `${ariaLabel} — filter` : "Filter options"}
                      className="focus-ring w-full rounded-md border border-stone-200 bg-white py-1.5 pl-8 pr-2 text-sm text-ink placeholder:text-steel caret-coral"
                    />
                  </div>
                ) : null}
                <ul id={listId} role="listbox" aria-label={ariaLabel} className="max-h-64 overflow-auto p-1">
                  {rows.length === 0 ? (
                    <li className="px-2 py-2 text-sm text-steel">{noMatchesLabel}</li>
                  ) : (
                    rows.map((row, idx) => {
                      const isSelected = row.value === value;
                      const isActive = idx === active;
                      const RowIcon = row.icon;
                      return (
                        <li key={`${row.value}-${idx}`} role="option" aria-selected={isSelected} data-idx={idx}>
                          <button
                            type="button"
                            disabled={row.disabled}
                            onClick={() => commit(row)}
                            onMouseEnter={() => setActive(idx)}
                            className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors disabled:opacity-40 ${
                              isActive ? "bg-coral/10 text-coral" : isSelected ? "font-semibold text-ink" : "text-ink hover:bg-paper"
                            }`}
                          >
                            <Check size={14} aria-hidden className={`shrink-0 ${isSelected ? "opacity-100 text-coral" : "opacity-0"}`} />
                            {RowIcon ? <RowIcon size={14} aria-hidden className="shrink-0 text-steel" /> : null}
                            <span className={`truncate ${row.__clear ? "text-steel" : ""}`}>{row.label}</span>
                          </button>
                        </li>
                      );
                    })
                  )}
                </ul>
              </div>
            </>,
            document.body
          )
        : null}
    </>
  );
}
