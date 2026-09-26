// The designed CV's page budget - pure, so `node --test` holds it.
//
// Registry recruiting/cv-presentation-and-parseability, technique
// type-scale-density-and-page-budget: length follows relevant content. One page up to
// about three years of experience, two otherwise; a second page is at least a third full
// or the content is trimmed; and over budget the FIX is the content - an older role set
// as one line - never a smaller type (cv.css holds the four sizes fixed). This module
// measures and says; the designer shows it to the seeker with the compaction it can offer.

import type { CvDocument } from "./cvDocument";

/** The A4 `@page cv` text heights (cv.css): page one bleeds to the top edge and keeps a
 *  10mm foot; a continuation page keeps a 10mm head and foot. */
export const CV_FIRST_PAGE_MM = 287;
export const CV_NEXT_PAGE_MM = 277;

/** Below this share, a last page reads as spill ("three orphaned lines"). */
export const CV_SPARSE_LAST_PAGE = 1 / 3;

const PRESENT = /present|now|current|today|dosud|současnost|nyní|heute|aktuell|aujourd|présent|actuel/i;
const POINT = /(?:(0?[1-9]|1[0-2])[./])?((?:19|20)\d\d)/g;

/** A date string as [start, end] in fractional years; null when it names no year. A range
 *  ending in "present" (in the CV's language) ends now; a lone year is that year. */
export function cvIntervalOf(dates: string | null, now: Date = new Date()): [number, number] | null {
  if (!dates) return null;
  const points = [...dates.matchAll(POINT)].map((m) => Number(m[2]) + (m[1] ? (Number(m[1]) - 1) / 12 : 0));
  if (!points.length) return null;
  const start = points[0]!;
  const nowYears = now.getFullYear() + now.getMonth() / 12;
  const end = PRESENT.test(dates) ? nowYears : points.length > 1 ? points[points.length - 1]! + (/[./]\d{4}\s*$/.test(dates) ? 1 / 12 : 0) : start + 1;
  return end > start ? [start, end] : null;
}

/** Years of experience the CV's roles cover: the UNION of their intervals (an overlap
 *  counts once), or null when no role carries a date. */
export function cvYearsOf(doc: Pick<CvDocument, "experience">, now: Date = new Date()): number | null {
  const spans = doc.experience
    .map((r) => cvIntervalOf(r.dates, now))
    .filter((x): x is [number, number] => !!x)
    .sort((a, b) => a[0] - b[0]);
  if (!spans.length) return null;
  let total = 0;
  let [s, e] = spans[0]!;
  for (const [a, b] of spans.slice(1)) {
    if (a <= e) e = Math.max(e, b);
    else {
      total += e - s;
      [s, e] = [a, b];
    }
  }
  return Math.round((total + (e - s)) * 10) / 10;
}

/** One page under about three years of experience, two otherwise; unknown years (no dated
 *  role) claim nothing about the page count and allow two. */
export function cvPageBudget(years: number | null): 1 | 2 {
  return years !== null && years < 3 ? 1 : 2;
}

export type CvPageVerdict = {
  /** Pages the sheet prints on. */
  pages: number;
  budget: 1 | 2;
  years: number | null;
  /** How full the last page is, 0-1 (1 for a single page). */
  lastFill: number;
  /** More pages than the budget. */
  over: boolean;
  /** A last page after the first holding less than a third. */
  sparse: boolean;
};

/** The verdict for a sheet whose printed length is `lengthMm` (the sheet's own box, its
 *  padding included, without the on-screen A4 minimum height). */
export function cvPageVerdict(lengthMm: number, years: number | null): CvPageVerdict {
  const budget = cvPageBudget(years);
  const rest = Math.max(0, lengthMm - CV_FIRST_PAGE_MM);
  // A millimetre of rounding is not a page.
  const extra = rest > 1 ? Math.ceil((rest - 1) / CV_NEXT_PAGE_MM) : 0;
  const pages = 1 + extra;
  const lastFill = pages === 1 ? 1 : Math.min(1, (rest - (extra - 1) * CV_NEXT_PAGE_MM) / CV_NEXT_PAGE_MM);
  return { pages, budget, years, lastFill, over: pages > budget, sparse: pages > 1 && lastFill < CV_SPARSE_LAST_PAGE };
}

/** The sheet's printed length in its own millimetres: from its top to the lowest heading
 *  or section, plus the foot padding. Scale-free (a transformed preview measures the same),
 *  and blind to the on-screen A4 minimum height. Self-contained on purpose: the round trip
 *  (scripts/cv/roundtrip.mjs) runs this very function inside headless Chromium to hold the
 *  designer's page count against the PDF's. */
export function measureSheetLengthMm(sheet: Element, footMm: number): number {
  const rect = sheet.getBoundingClientRect();
  let bottom = rect.top;
  sheet.querySelectorAll(".cv-head, .cv-sec").forEach((el) => {
    bottom = Math.max(bottom, el.getBoundingClientRect().bottom);
  });
  return rect.width > 0 ? ((bottom - rect.top) * 210) / rect.width + footMm : 0;
}
