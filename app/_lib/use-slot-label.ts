"use client";

import { useLocale } from "next-intl";
import { useCallback } from "react";

// SCH4 — format a slot's ISO datetime in the candidate's ACTIVE locale for
// display, instead of the server-minted English label ("Tue 10 Jun · 10:00")
// that reads wrong inside an otherwise-Czech page. The English label stays the
// canonical STORED value (recruiter feed + emails); this is display-only, the
// same split as use-enum-label.ts. Returns a `(iso, fallback?) => string`
// formatter: an unparsable/absent ISO degrades to the fallback (the stored
// label) so the booked slot never renders blank.

/**
 * One pair of formatters per locale, built once — the same shape as
 * `useTableSort`'s collator map, and for the same two reasons.
 *
 * The cheap one: `new Intl.DateTimeFormat(...)` is expensive, and this hook
 * built TWO of them per call, i.e. two per rendered slot. A schedule offering
 * 12 slots constructed 24 formatters on every render of the list, and the
 * `useCallback` around it hid that completely — the callback identity was
 * stable, the work inside it was not.
 *
 * The one that actually matters: keying the cache by locale makes the collation
 * locale a PARAMETER rather than the ambient default, so it cannot silently
 * become the server's during SSR and the browser's after hydration.
 */
const SLOT_FORMATTERS = new Map<string, { date: Intl.DateTimeFormat; time: Intl.DateTimeFormat }>();

export function slotFormatters(locale: string): { date: Intl.DateTimeFormat; time: Intl.DateTimeFormat } {
  let f = SLOT_FORMATTERS.get(locale);
  if (!f) {
    f = {
      date: new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short" }),
      time: new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hour12: false }),
    };
    SLOT_FORMATTERS.set(locale, f);
  }
  return f;
}

/** The pure formatter behind the hook — `locale` explicit, no React. */
export function formatSlotLabel(iso: string | null | undefined, locale: string, fallback?: string | null): string {
  if (!iso) return fallback ?? "";
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return fallback ?? "";
  const d = new Date(ms);
  const { date, time } = slotFormatters(locale);
  // Mirror the server label's "<date> · <time>" shape so the two read alike.
  return `${date.format(d)} · ${time.format(d)}`;
}

export function useSlotLabel(): (iso: string | null | undefined, fallback?: string | null) => string {
  const locale = useLocale();
  return useCallback((iso, fallback) => formatSlotLabel(iso, locale, fallback), [locale]);
}
