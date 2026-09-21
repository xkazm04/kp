"use client";

// Money on the map, in the ORGANIZATION's currency and the READER's typography:
// "CZK 45–50k" in English, "45–50k Kč" in Czech, "45–50k EUR" in German.

import { useMemo, useState } from "react";
import { useLocale } from "next-intl";
import { readClientOrgCurrency, withCurrency, type OrgCurrency } from "@/app/_lib/org-settings";
import { kAmount, kRange } from "./mapSalary";

export type MapMoney = {
  currency: OrgCurrency;
  /** One amount, e.g. "CZK 52k". */
  point: (n: number) => string;
  /** A bucket, e.g. "CZK 45–50k". */
  range: (lo: number, hi: number) => string;
};

export function useMapMoney(): MapMoney {
  const locale = useLocale();
  // The map's overlays mount on a click, never during SSR, so the cookie is
  // readable in the initializer — and a setting does not change under an open one.
  const [currency] = useState(readClientOrgCurrency);
  return useMemo(
    () => ({
      currency,
      point: (n) => withCurrency(kAmount(n, locale), currency, locale),
      range: (lo, hi) => withCurrency(kRange(lo, hi, locale), currency, locale),
    }),
    [currency, locale],
  );
}
