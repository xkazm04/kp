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
export function useSlotLabel(): (iso: string | null | undefined, fallback?: string | null) => string {
  const locale = useLocale();
  return useCallback(
    (iso, fallback) => {
      if (!iso) return fallback ?? "";
      const ms = Date.parse(iso);
      if (Number.isNaN(ms)) return fallback ?? "";
      const d = new Date(ms);
      const date = new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short" }).format(d);
      const time = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
      // Mirror the server label's "<date> · <time>" shape so the two read alike.
      return `${date} · ${time}`;
    },
    [locale]
  );
}
