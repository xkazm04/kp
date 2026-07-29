"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, ChevronDown, Search } from "lucide-react";
import { FIELD, META_LABEL } from "@/app/_components/ui/recipes";

// Small self-contained filter primitives for the Channels surface: a header-cell
// ColumnFilter (spreadsheet-style, filter initiated from the column header) and a
// SearchSelect combobox (a searchable single-select field). Both hang their menu
// off a FIXED-positioned anchor so it escapes the table's overflow clip, and close
// on scroll / resize / Escape / backdrop. No third-party combobox in the repo, so
// this is the shared building block for both the comms table and the webhook forms.
//
// channels-i18n-honesty: the column-scoped strings interpolate the column TITLE as
// given (never lower-cased) — a localized header may be a capitalized German noun, and
// "All {column}" / "Search {column}" are worded per locale so no gendered article has
// to be guessed.

export type Option = { value: string; label: string };

const optionRow = (active: boolean) =>
  `focus-ring flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm ${
    active ? "bg-coral/10 font-semibold text-coral" : "text-ink hover:bg-paper"
  }`;

// The menu body: an optional search box over a scrollable single-select list, with
// an optional "clear" row at the top.
function OptionList({
  options,
  value,
  onPick,
  searchable = true,
  clearLabel,
}: {
  options: Option[];
  value: string;
  onPick: (value: string) => void;
  searchable?: boolean;
  /** When set, shows a top row that resets the filter to "" (e.g. "All roles"). */
  clearLabel?: string;
}) {
  const t = useTranslations("channels");
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const shown = needle ? options.filter((o) => o.label.toLowerCase().includes(needle)) : options;
  return (
    <div>
      {searchable ? (
        <div className="relative border-b border-stone-100 p-1.5">
          <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-steel" aria-hidden />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("filters.search")}
            aria-label={t("filters.searchOptions")}
            className={`${FIELD} w-full py-1 pl-7 text-sm`}
          />
        </div>
      ) : null}
      <ul className="max-h-56 overflow-auto p-1">
        {clearLabel ? (
          <li>
            <button type="button" onClick={() => onPick("")} className={optionRow(value === "")}>
              <Check size={13} className={value === "" ? "opacity-100" : "opacity-0"} aria-hidden /> {clearLabel}
            </button>
          </li>
        ) : null}
        {shown.map((o) => (
          <li key={o.value}>
            <button type="button" onClick={() => onPick(o.value)} className={optionRow(value === o.value)}>
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
function AnchoredMenu({
  anchor,
  onClose,
  width,
  children,
}: {
  anchor: DOMRect;
  onClose: () => void;
  width: number;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const close = () => onClose();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);
  const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
  const left = Math.max(8, Math.min(anchor.left, vw - width - 8));
  return (
    <>
      {/* z above the Modal overlay (z-50) so the menu works inside the Add modal. */}
      <button type="button" aria-hidden tabIndex={-1} onClick={onClose} className="fixed inset-0 z-[60] cursor-default" />
      <div style={{ top: anchor.bottom + 4, left, width }} className="fixed z-[70] rounded-lg border border-stone-200 bg-white shadow-pop">
        {children}
      </div>
    </>
  );
}

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
  const t = useTranslations("channels");
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
  const t = useTranslations("channels");
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
