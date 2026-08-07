"use client";

import { useLocale } from "next-intl";
import { useMemo } from "react";
import { formatGrouped, formatMoney, formatSalaryRange } from "@/app/_lib/format";

/** The active-locale binding of the number/money formatters — see {@link useNumberFormat}. */
export type NumberFormatters = {
  /** {@link formatGrouped} in the active locale. */
  grouped: (value: number) => string;
  /** {@link formatMoney} in the active locale (currency still defaults to APP_CURRENCY). */
  money: (value: number, currency?: string) => string;
  /** {@link formatSalaryRange} in the active locale; `options` keeps currency/period. */
  salaryRange: (
    minimum: number,
    maximum: number,
    options?: { currency?: string; period?: string }
  ) => string;
};

/**
 * The active-locale binding of format.ts's number/money helpers for client
 * components: `const n = useNumberFormat(); … n.salaryRange(min, max)`. The exact
 * sibling of {@link useRelativeTime} (app/_lib/use-relative-time.ts) — the
 * locale-aware work lives in `Intl.NumberFormat` inside format.ts, and this hook
 * only threads next-intl's active locale into it, so there is ONE mechanism for
 * "render this in the reader's language" rather than two.
 *
 * Why a hook rather than `formatGrouped(x, useLocale())` at each call site: the
 * money surfaces call these several times per render (SalaryGauge alone formats
 * six figures), and a single bound object keeps a caller from threading the
 * locale into four of them and forgetting the fifth.
 *
 * Server components skip the hook and pass `await getLocale()` to the underlying
 * helpers directly.
 */
export function useNumberFormat(): NumberFormatters {
  const locale = useLocale();
  return useMemo(
    () => ({
      grouped: (value) => formatGrouped(value, locale),
      money: (value, currency) => formatMoney(value, currency, locale),
      salaryRange: (minimum, maximum, options) =>
        formatSalaryRange(minimum, maximum, { ...options, locale }),
    }),
    [locale]
  );
}
