"use client";

import { useTranslations } from "next-intl";

// The whole file's pager (GigsFile.tsx): the range shown, Previous / Next, and the page
// numbers around the current one with the ends kept.

export const PER_PAGE = 50;

export function FilePager({ at, pages, shown, total, onPage }: { at: number; pages: number; shown: number; total: number; onPage: (p: number) => void }) {
  const t = useTranslations("gigs");
  return (
    <nav className="pager" aria-label={t("file.pages")}>
      <span className="of t-meta">
        {shown ? t("file.range", { from: at * PER_PAGE + 1, to: Math.min(shown, at * PER_PAGE + PER_PAGE), total: shown }) : t("file.count", { shown: 0, total })}
      </span>
      <button type="button" disabled={at === 0} onClick={() => onPage(at - 1)}>
        {t("file.prev")}
      </button>
      {pageNumbers(at, pages).map((p, i) =>
        p === null ? (
          <span key={`gap-${i}`} className="dim" aria-hidden>
            …
          </span>
        ) : (
          <button key={p} type="button" aria-current={p === at ? "page" : undefined} onClick={() => onPage(p)}>
            {p + 1}
          </button>
        )
      )}
      <button type="button" disabled={at >= pages - 1} onClick={() => onPage(at + 1)}>
        {t("file.next")}
      </button>
    </nav>
  );
}

/** 1 … p-1 p p+1 … last, zero-based; null marks a gap. */
function pageNumbers(at: number, pages: number): (number | null)[] {
  const keep = [...new Set([0, pages - 1, at - 1, at, at + 1].filter((p) => p >= 0 && p < pages))].sort((a, b) => a - b);
  const out: (number | null)[] = [];
  let last = -1;
  for (const p of keep) {
    if (p - last > 1) out.push(null);
    out.push(p);
    last = p;
  }
  return out;
}
