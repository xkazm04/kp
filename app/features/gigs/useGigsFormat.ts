"use client";

import { useMemo } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { useDateFormat } from "@/app/_components/ui/useDateFormat";

// The Gigs tab's formatters and closed-vocabulary labels, in the reader's language.
// One hook so every screen says "reward not stated", "$0.42" and "Security" the same way.

export function useGigsFormat() {
  const t = useTranslations("gigs");
  const format = useFormatter();
  const dates = useDateFormat();

  return useMemo(() => {
    type Key = Parameters<typeof t>[0];
    /** A catalog label for a closed-vocabulary value, falling back to the raw value
     *  (a key the catalog has not learned yet reads as itself, never as blank). */
    const label = (ns: string, value: string): string => {
      const key = `${ns}.${value}` as Key;
      return t.has(key) ? t(key) : value.replace(/_/g, " ");
    };

    /** An amount in its own currency. A token symbol Intl does not know ("USDC") keeps
     *  its code beside the number instead of throwing. */
    const money = (amount: number, currency: string | null): string => {
      if (currency && /^[A-Z]{3}$/.test(currency)) {
        try {
          return format.number(amount, { style: "currency", currency, maximumFractionDigits: 2 });
        } catch {
          // An ISO-shaped code Intl rejects: fall through to the plain form below.
        }
      }
      const n = format.number(amount, { maximumFractionDigits: 2 });
      return currency ? `${n} ${currency}` : n;
    };

    const usd = (amount: number): string => format.number(amount, { style: "currency", currency: "USD", maximumFractionDigits: 2 });

    const percent = (whole: number): string => format.number(whole / 100, { style: "percent", maximumFractionDigits: 0 });

    const relative = (iso: string | null, now: Date): string | null => {
      if (!iso) return null;
      const d = new Date(iso);
      if (!Number.isFinite(d.getTime())) return null;
      return format.relativeTime(d, now);
    };

    return {
      arena: (a: string) => label("arena", a),
      status: (s: string) => label("status", s),
      attemptStatus: (s: string) => label("attemptStatus", s),
      suspect: (r: string) => label("suspect", r),
      paused: (r: string) => label("paused", r),
      check: (k: string) => label("check", k),
      verdict: (v: string) => label("verdict", v),
      hireStatus: (s: string) => label("hireStatus", s),
      money,
      usd,
      percent,
      relative,
      date: (iso: string | null) => dates.date(iso),
      dateTime: (iso: string | null) => dates.dateTime(iso),
    };
  }, [t, format, dates]);
}

export type GigsFormat = ReturnType<typeof useGigsFormat>;
