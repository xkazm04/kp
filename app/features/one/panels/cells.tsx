"use client";

// Small shared pieces of the panels' tables: the age figure and the per-look row limit.
import { useMemo } from "react";
import { useLocale } from "next-intl";
import { ABSENT } from "@/app/_components/kit";
import type { PanelLook } from "./types";

/** How many rows a look draws before it says "showing the first N of M". The insight
 *  draws no rows (its reading is computed from the whole read). */
export function rowLimit(look: PanelLook | undefined): number {
  if (look === "table") return 60;
  return 8;
}

/** Whole days as the narrow unit ("3d"); an unknown age is a dash. */
export function useDays(): (days: number | null) => string {
  const locale = useLocale();
  const fmt = useMemo(() => new Intl.NumberFormat(locale, { style: "unit", unit: "day", unitDisplay: "narrow" }), [locale]);
  return (days) => (days === null ? ABSENT : fmt.format(days));
}
