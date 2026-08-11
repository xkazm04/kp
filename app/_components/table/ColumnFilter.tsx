"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, Search } from "lucide-react";
import { FIELD, META_LABEL } from "@/app/_components/ui/recipes";
import { AnchoredMenu, OptionList, type Option } from "./FilterMenu";

// The studio's table-filter primitives: a header-cell ColumnFilter (spreadsheet
// style — the column header IS the filter trigger) and a SearchSelect combobox (a
// searchable single-select field). Both hang their menu off a FIXED-positioned
// anchor so it escapes the table's overflow clip, and close on scroll / resize /
// Escape / backdrop. No third-party combobox in the repo, so this is the shared
// building block for the comms ledger, the webhook forms, the Archetypes roster and
// the Assignments outbox alike.
//
// i18n honesty: the column-scoped strings interpolate the column TITLE as given
// (never lower-cased) — a localized header may be a capitalized German noun, and
// "All {column}" / "Search {column}" are worded per locale so no gendered article
// has to be guessed.
//
// The popover shell + option list live in FilterMenu.tsx (200-line cap).

export type { Option };

// A column header that IS the filter trigger — click the header to filter that
// column. `mode="search"` gives a free-text box (Name); `mode="select"` gives a
// searchable option list (Role / Channel / Type). Active state tints the header.
export function ColumnFilter({
  title,
  value,
  onChange,
  mode = "select",
  options = [],
}: {
  title: string;
  value: string;
  onChange: (value: string) => void;
  mode?: "select" | "search";
  options?: Option[];
}) {
  const t = useTranslations("table");
  const ref = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const active = value.trim() !== "";
  return (
    <>
      <button
        ref={ref}
        type="button"
        onClick={() => setAnchor(anchor ? null : ref.current!.getBoundingClientRect())}
        aria-expanded={Boolean(anchor)}
        className={`focus-ring inline-flex items-center gap-1 rounded px-1 py-0.5 ${META_LABEL} ${active ? "text-coral" : "hover:text-ink"}`}
      >
        {title}
        {active ? (
          <span className="h-1.5 w-1.5 rounded-full bg-coral" aria-hidden />
        ) : (
          <ChevronDown size={12} className="opacity-50" aria-hidden />
        )}
      </button>
      {anchor ? (
        <AnchoredMenu anchor={anchor} width={224} onClose={() => setAnchor(null)}>
          {mode === "search" ? (
            <div className="relative p-2">
              <Search size={13} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-steel" aria-hidden />
              <input
                autoFocus
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={t("filters.searchColumn", { column: title })}
                aria-label={t("filters.searchColumn", { column: title })}
                className={`${FIELD} w-full py-1 pl-7 text-sm`}
              />
            </div>
          ) : (
            <OptionList
              options={options}
              value={value}
              clearLabel={t("filters.allOf", { column: title })}
              onPick={(v) => {
                onChange(v);
                setAnchor(null);
              }}
            />
          )}
        </AnchoredMenu>
      ) : null}
    </>
  );
}

// A searchable single-select field (combobox). Used where a plain <select> would
// be unwieldy — e.g. binding a webhook to one of many roles.
export function SearchSelect({
  value,
  options,
  onChange,
  placeholder,
  id,
}: {
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  placeholder?: string;
  id?: string;
}) {
  const t = useTranslations("table");
  const ref = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const selected = options.find((o) => o.value === value);
  return (
    <>
      <button
        id={id}
        ref={ref}
        type="button"
        onClick={() => setAnchor(anchor ? null : ref.current!.getBoundingClientRect())}
        aria-expanded={Boolean(anchor)}
        className={`${FIELD} flex w-full items-center justify-between gap-2 text-left`}
      >
        <span className={`truncate ${selected ? "text-ink" : "text-steel"}`}>{selected ? selected.label : placeholder ?? t("filters.select")}</span>
        <ChevronDown size={14} className="shrink-0 text-steel" aria-hidden />
      </button>
      {anchor ? (
        <AnchoredMenu anchor={anchor} width={Math.max(anchor.width, 224)} onClose={() => setAnchor(null)}>
          <OptionList
            options={options}
            value={value}
            searchable
            onPick={(v) => {
              onChange(v);
              setAnchor(null);
            }}
          />
        </AnchoredMenu>
      ) : null}
    </>
  );
}
