"use client";

import { forwardRef, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Check, ChevronDown, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { nextMenuIndex } from "./jdsLedgerNav";

export type FilterOption = { value: string; label: string; count?: number; icon?: LucideIcon };

// A column-header enum filter: the title doubles as the dropdown trigger, with a
// coral dot when a value is active. Options are the (pre-sorted) enum values plus
// an "All" reset. Closes on outside-click or Escape.
//
// #4 — this is a MENU of single-select choices, not a listbox: the old markup
// announced `aria-haspopup="listbox"` + `role="option"` on focusable <button>s but
// implemented none of the listbox keyboard contract (no focus-in on open, no arrow
// navigation, no aria-activedescendant/controls), which misleads assistive tech.
// Rebuilt as an honest `role="menu"` of `role="menuitemradio"` buttons with real
// roving focus (focus the selected item on open, Arrow/Home/End move focus,
// aria-controls links trigger↔menu). bug-ui-scan-2026-07-09 (jd-authoring-library-templates #4)
// Extracted verbatim from LibrarySavedJdsLedger.tsx so that file stays under the
// 200-line split threshold.
export function ColumnHeaderFilter({
  title,
  options,
  selected,
  onSelect,
}: {
  title: string;
  options: FilterOption[];
  selected: string | null;
  onSelect: (value: string | null) => void;
}) {
  const t = useTranslations("library.tab");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();

  // The menu items in DOM order: the "All" reset (value null) then each option.
  const items: { value: string | null; label: string; count?: number; icon?: LucideIcon }[] = [
    { value: null, label: t("filterAll") },
    ...options,
  ];
  // Focus target on open: the currently-selected item, else "All" (index 0).
  const selectedIndex = Math.max(0, items.findIndex((it) => it.value === selected));

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus(); // return focus to the trigger, per menu semantics
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // On open, move focus INTO the menu (the selected item) so keyboard/SR users land
  // where the listbox contract promised but never delivered.
  useEffect(() => {
    if (open) itemRefs.current[selectedIndex]?.focus();
  }, [open, selectedIndex]);

  const activeLabel = selected ? options.find((o) => o.value === selected)?.label : null;

  const choose = (value: string | null) => {
    onSelect(value);
    setOpen(false);
    triggerRef.current?.focus();
  };

  // Roving focus: Arrow/Home/End move DOM focus between the (natively focusable)
  // menuitem buttons; the pure index math lives in ledger-nav (unit-tested).
  const onMenuKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const cur = itemRefs.current.findIndex((el) => el === document.activeElement);
    const next = nextMenuIndex(cur, e.key, items.length);
    if (next == null) return;
    e.preventDefault();
    itemRefs.current[next]?.focus();
  };

  return (
    <div ref={ref} className="relative inline-flex">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title={activeLabel ? t("filterActive", { name: title, value: activeLabel }) : t("filterBy", { name: title })}
        className={`focus-ring -mx-1 inline-flex items-center gap-1 rounded px-1 py-0.5 transition-colors hover:text-ink ${selected ? "text-coral" : ""}`}
      >
        <span>{title}</span>
        {selected ? <span className="h-1.5 w-1.5 rounded-full bg-coral" aria-hidden /> : null}
        <ChevronDown size={12} aria-hidden className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label={t("filterBy", { name: title })}
          onKeyDown={onMenuKeyDown}
          className="absolute left-0 top-full z-20 mt-1 max-h-72 min-w-[11rem] overflow-auto rounded-lg border border-stone-200 bg-white py-1 shadow-pop"
        >
          {items.map((it, idx) => (
            <FilterRow
              key={it.value ?? "__all__"}
              ref={(el) => { itemRefs.current[idx] = el; }}
              label={it.label}
              count={it.count}
              icon={it.icon}
              active={selected === it.value}
              onClick={() => choose(it.value)}
            />
          ))}
          {options.length === 0 ? <p className="px-3 py-2 text-sm normal-case tracking-normal text-steel">{t("filterNoValues")}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

// A single filter choice. `role="menuitemradio"` + `aria-checked` is honest about
// the single-select semantics (unlike the old `role="option"`, which promised
// listbox behaviour); the button stays natively focusable so the parent menu can
// rove focus with the arrow keys. bug-ui-scan-2026-07-09 (jd-authoring-library-templates #4)
const FilterRow = forwardRef<HTMLButtonElement, { label: string; count?: number; icon?: LucideIcon; active: boolean; onClick: () => void }>(
  function FilterRow({ label, count, icon: Icon, active, onClick }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        role="menuitemradio"
        aria-checked={active}
        onClick={onClick}
        className={`focus-ring flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm normal-case tracking-normal transition-colors hover:bg-paper ${active ? "font-semibold text-coral" : "text-ink"}`}
      >
        {Icon ? <Icon size={14} aria-hidden className="shrink-0 text-steel" /> : null}
        <span className="flex-1 truncate">{label}</span>
        {typeof count === "number" ? <span className="nums text-sm text-steel">{count}</span> : null}
        {active ? <Check size={13} aria-hidden className="shrink-0" /> : null}
      </button>
    );
  }
);
