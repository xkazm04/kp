"use client";

// The ONE pager for every long table in the studio — the Channels comms ledger and
// receiver tables, the Archetypes candidate roster, the Assignments outbox.
//
// It started life on Channels, where the ledger used to grow instead of page: a
// "Show more" button appended another 40 rows to the same DOM list, so a busy
// workspace ended up scrolling a thousand-row table with the column filters left far
// above it, and there was no way back to the top except scrolling. A fixed window of
// 20 keeps the header, the rows and this control on one screen, and makes "where am
// I" a question the UI answers rather than one the scrollbar hints at. It lives here
// rather than under a feature because the next table to need paging should reach for
// this one, not re-derive the arithmetic (the roster and the outbox both did — the
// outbox's version of "paging" was a silent .slice(0, 50) that dropped row 51
// without ever saying so).
//
// Deliberately client-side: the tables using it already hold their whole result set
// in memory (server reads are capped well under a thousand rows), so paging is a
// slice — no fetch, no spinner, no cursor to keep. A table whose result set does NOT
// fit in memory needs a cursor, not this.
//
// Renders nothing when everything fits on one page: a pager over a 6-row table is
// chrome that can only ever say "1–6 of 6".

import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight } from "lucide-react";

// The arithmetic lives in pageWindow.ts (pure, and therefore testable — this
// file is JSX and the unit runner cannot import it). Re-exported here so the
// seven consumers keep one import for the pager and its maths.
export { clampPage, pageCount, pageSlice, TABLE_PAGE_SIZE } from "./pageWindow";
import { pageCount, TABLE_PAGE_SIZE } from "./pageWindow";

export function TablePager({
  page,
  total,
  onPage,
  pageSize = TABLE_PAGE_SIZE,
}: {
  /** Zero-based, already clamped by the caller (see clampPage). */
  page: number;
  total: number;
  onPage: (page: number) => void;
  pageSize?: number;
}) {
  const t = useTranslations("table.pager");
  const pages = pageCount(total, pageSize);
  if (total <= pageSize) return null;

  const from = page * pageSize + 1;
  const to = Math.min(total, (page + 1) * pageSize);
  const btn =
    "focus-ring inline-flex h-8 w-8 items-center justify-center rounded-md border border-stone-200 bg-white text-steel transition-colors hover:border-coral/40 hover:text-ink disabled:opacity-40 disabled:hover:border-stone-200 disabled:hover:text-steel";

  return (
    <nav aria-label={t("label")} className="flex flex-wrap items-center justify-between gap-2">
      {/* The range, not just the page number: "21–40 of 47" answers "how much is
          left" without arithmetic. aria-live so a page change is announced. */}
      <p className="text-sm text-steel nums" aria-live="polite">
        {t("range", { from, to, total })}
      </p>
      <div className="flex items-center gap-1.5">
        <button type="button" onClick={() => onPage(page - 1)} disabled={page <= 0} aria-label={t("prev")} className={btn}>
          <ChevronLeft size={16} aria-hidden />
        </button>
        <span className="px-1 text-sm text-steel nums">{t("page", { page: page + 1, pages })}</span>
        <button type="button" onClick={() => onPage(page + 1)} disabled={page >= pages - 1} aria-label={t("next")} className={btn}>
          <ChevronRight size={16} aria-hidden />
        </button>
      </div>
    </nav>
  );
}
