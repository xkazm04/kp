"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { selectConsumesKeyWhileOpen } from "./select-keys";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
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
  placeholder,
  ariaLabel,
  id,
  name,
  className = "",
  sizeVariant = "md",
  disabled = false,
  searchable,
  clearable = false,
  clearLabel,
  searchPlaceholder,
  noMatchesLabel,
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
  /** Compact/standard height — the family-wide name, matching TextInput/TextArea.
   *  A `size` alias existed alongside it and was the spelling ALL 34 call sites
   *  that set a size reached for, so the primitive that owns the app's field
   *  sizing was the one disagreeing with its siblings about the prop's name.
   *  One name now: `size` on a Select is a tsc error, not a second spelling. */
  sizeVariant?: "sm" | "md";
  disabled?: boolean;
  /** Show a filter box above the list. Defaults to auto (on when > 8 options). */
  searchable?: boolean;
  /** Prepend a row that resets the value to "" (an explicit "no selection"). */
  clearable?: boolean;
  clearLabel?: string;
  /** Menu microcopy. Every one of these falls back to the `select.*` catalog, so a
   *  caller that passes nothing still reads in the reader's language. */
  searchPlaceholder?: string;
  noMatchesLabel?: string;
  invalid?: boolean;
}) {
  // ALL of this component's own copy resolves here, defaults included. The four
  // props above used to carry English DEFAULTS in the destructure — invisible to
  // every i18n gate (eslint reads JSX text, the i18n-check greps read JSX
  // attributes), and for `searchPlaceholder`/`noMatchesLabel` no caller overrode
  // them at all, so three locales read English on every searchable select in the
  // product. The props survive as overrides; the default is now a translation.
  // `scripts/i18n/primitive-copy-defaults.mjs` keeps them from coming back.
  const t = useTranslations("select");
  const placeholderText = placeholder ?? t("placeholder");
  const clearText = clearLabel ?? t("clear");
  const searchPlaceholderText = searchPlaceholder ?? t("searchPlaceholder");
  const noMatchesText = noMatchesLabel ?? t("noMatches");
  const listId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [active, setActive] = useState(0);
  const [query, setQuery] = useState("");
  const typeahead = useRef<{ buffer: string; timer: number | null }>({ buffer: "", timer: null });

  // The typeahead buffer's reset timer is the one thing here that outlives the
  // component: a 600ms window opened by the last keystroke before a tab switch or
  // a modal close fired into an unmounted tree. Harmless in effect (it only clears
  // a ref) but it is a live timer per Select on a page full of them, and the
  // pattern is the one that DOES bite when the callback later touches state.
  useEffect(
    () => () => {
      if (typeahead.current.timer) window.clearTimeout(typeahead.current.timer);
    },
    []
  );

  const withSearch = searchable ?? options.length > 8;
  const selected = options.find((o) => o.value === value) ?? null;

  // The rows the menu actually renders: an optional "clear" row, then the
  // (search-filtered) options. Active index addresses THIS array.
  const rows = useMemo<MenuRow[]>(() => {
    const needle = query.trim().toLowerCase();
    const shown = needle ? options.filter((o) => o.label.toLowerCase().includes(needle)) : options;
    return clearable ? [{ value: "", label: clearText, __clear: true }, ...shown] : shown;
  }, [options, query, clearable, clearText]);

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

  const sizeCls = sizeVariant === "sm" ? "h-9 px-2.5 text-sm" : "h-10 px-3 text-base";
  const TriggerIcon = selected?.icon;

  // Focus never leaves the trigger (or the filter box) — the "active" row is moved
  // by state, not by focus — so aria-activedescendant is the ONLY channel that tells
  // a screen reader which option Arrow/Home/End/typeahead just landed on, and which
  // one Enter will commit. Without it the module comment's APG claim was hollow: the
  // row highlighted visually and nothing was announced. Each row therefore needs a
  // stable id, and the id must resolve — point at nothing when the list is empty
  // (the "No matches" state) or the index is out of range after a filter narrowed it.
  const optionId = (idx: number) => `${listId}-opt-${idx}`;
  const activeDescendant = open && active >= 0 && active < rows.length ? optionId(active) : undefined;

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
        aria-activedescendant={activeDescendant}
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
          <span className="truncate">{selected ? selected.label : placeholderText}</span>
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
                      placeholder={searchPlaceholderText}
                      // The filter box holds focus while the arrows move the active
                      // row, so it carries the same pointer (and names the list it
                      // drives) — otherwise a searchable Select announces nothing.
                      aria-controls={listId}
                      aria-activedescendant={activeDescendant}
                      aria-label={ariaLabel ? t("filterFor", { label: ariaLabel }) : t("filterOptions")}
                      className="focus-ring w-full rounded-md border border-stone-200 bg-white py-1.5 pl-8 pr-2 text-sm text-ink placeholder:text-steel caret-coral"
                    />
                  </div>
                ) : null}
                <ul id={listId} role="listbox" aria-label={ariaLabel} className="max-h-64 overflow-auto p-1">
                  {rows.length === 0 ? (
                    <li className="px-2 py-2 text-sm text-steel">{noMatchesText}</li>
                  ) : (
                    rows.map((row, idx) => {
                      const isSelected = row.value === value;
                      const isActive = idx === active;
                      const RowIcon = row.icon;
                      return (
                        // aria-disabled on the OPTION, not just `disabled` on the inner
                        // button: aria-activedescendant points at the <li>, and Home/End
                        // (and the open-menu preselect) can land on a disabled row, where
                        // Enter is a deliberate no-op (see commit). Without this the row
                        // is announced as choosable and the silent no-op reads as a hang.
                        <li key={`${row.value}-${idx}`} id={optionId(idx)} role="option" aria-selected={isSelected} aria-disabled={row.disabled || undefined} data-idx={idx}>
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
