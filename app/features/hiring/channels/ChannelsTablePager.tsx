"use client";

// One pager for every table on the Channels surface (the comms ledger, the email
// and ad-form receiver tables).
//
// The ledger used to grow instead of page: a "Show more" button appended another
// 40 rows to the same DOM list, so a busy workspace ended up scrolling a
// thousand-row table with the column filters left far above it, and there was no
// way back to the top of the list except scrolling. A fixed window of 20 keeps the
// header, the rows and this control on one screen, and makes "where am I" a
// question the UI answers rather than one the scrollbar hints at.
//
// Deliberately client-side: these tables already hold their whole result set in
// memory (the comms read is capped at 200 rows server-side, receivers are a handful
// per channel), so paging is a slice — no fetch, no spinner, no cursor to keep.
//
// Renders nothing when everything fits on one page: a pager over a 6-row table is
// chrome that can only ever say "1–6 of 6".

import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight } from "lucide-react";

/** Rows per page for every Channels table. */
export const TABLE_PAGE_SIZE = 20;

/** Total pages for `total` rows — at least 1, so an empty table is "page 1 of 1". */
export function pageCount(total: number, pageSize = TABLE_PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

/** The page index actually safe to render. Filters shrink the result set under a
 *  reader who is on page 3, so every caller clamps rather than resetting from an
 *  effect — the clamp is derived state and cannot get out of step with the data. */
export function clampPage(page: number, total: number, pageSize = TABLE_PAGE_SIZE): number {
  return Math.min(Math.max(0, page), pageCount(total, pageSize) - 1);
}

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
  const t = useTranslations("channels.pager");
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
