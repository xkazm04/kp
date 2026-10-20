"use client";

import { useMemo } from "react";
import { useLocale } from "next-intl";
import { useRelativeTime } from "@/app/_lib/use-relative-time";
import { fmtUsd } from "./agentsWorkforceLogic";

/** The reader's-locale formatting every level shares: money (the provider's figure, never an invoice), counts,
 *  UTC times (the server stamps UTC, and a card says so) and "x ago". */
export function useWorkforceFormat() {
  const locale = useLocale();
  const ago = useRelativeTime();
  return useMemo(() => {
    const dateTime = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC" });
    const dateShort = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" });
    const count = new Intl.NumberFormat(locale);
    return {
      locale,
      usd: (v: number) => fmtUsd(v, locale),
      /** Whole dollars, for a drawer's summed budgets. */
      whole: (v: number) => new Intl.NumberFormat(locale, { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(v),
      num: (v: number) => count.format(v),
      dateTime: (iso: string) => dateTime.format(new Date(iso)),
      dateShort: (iso: string) => dateShort.format(new Date(iso)),
      ago,
    };
  }, [locale, ago]);
}

export type WorkforceFormat = ReturnType<typeof useWorkforceFormat>;
