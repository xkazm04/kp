"use client";

import { useLocale } from "next-intl";
import { useCallback } from "react";
import { slotFormatters } from "./date-format.ts";
import { resolveTimeZone, timeZoneShortLabel } from "./timezone.ts";

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
 *
 * The registry itself now lives in `date-format.ts` — this module is "use client",
 * and the letter writers that need the same memoization run on the server. It is
 * re-exported here because that is where every existing caller imports it from.
 */
export { slotFormatters } from "./date-format.ts";

/** The pure formatter behind the hook — `locale` explicit, no React.
 *  Optional `timeZone` (IANA) appends a short zone (` · GMT+2`) when
 *  {@link timeZoneShortLabel} can name it, so a remote candidate does not
 *  read a shifted "16:00" as the recruiter's 16:00. */
export function formatSlotLabel(
  iso: string | null | undefined,
  locale: string,
  fallback?: string | null,
  opts?: { timeZone?: string | null }
): string {
  if (!iso) return fallback ?? "";
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return fallback ?? "";
  const d = new Date(ms);
  const { date, time } = slotFormatters(locale);
  // Mirror the server label's "<date> · <time>" shape so the two read alike.
  const label = `${date.format(d)} · ${time.format(d)}`;
  const requested = opts?.timeZone;
  if (!requested) return label;
  const zone = timeZoneShortLabel(iso, locale, requested);
  return zone ? `${label} · ${zone}` : label;
}

export function useSlotLabel(): (iso: string | null | undefined, fallback?: string | null) => string {
  const locale = useLocale();
  const timeZone = resolveTimeZone();
  return useCallback((iso, fallback) => formatSlotLabel(iso, locale, fallback, { timeZone }), [locale, timeZone]);
}
