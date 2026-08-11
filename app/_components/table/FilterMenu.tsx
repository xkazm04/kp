"use client";

// Internal menu pieces for the shared filter primitives (ColumnFilter,
// SearchSelect): the anchored/fixed-position popover shell and its searchable
// option-list body. Split out of ColumnFilter.tsx so that file stays under the
// 200-line cap. Copy resolves through `table.filters.*` in four locales.

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Search } from "lucide-react";
import { FIELD } from "@/app/_components/ui/recipes";

export type Option = { value: string; label: string };

const optionRow = (active: boolean) =>
  `focus-ring flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm ${
    active ? "bg-coral/10 font-semibold text-coral" : "text-ink hover:bg-paper"
  }`;

// The menu body: an optional search box over a scrollable single-select list, with
// an optional "clear" row at the top.
export function OptionList({
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
  const t = useTranslations("table");
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
export function AnchoredMenu({
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
