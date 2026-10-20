"use client";

import { useTranslations } from "next-intl";
import type { MatchResult } from "@/app/features/shared/matchTypes";
import { matchReasons, type MatchReasonsTranslator } from "./matchReasons";

/** The default, deterministic "why" under every match card — composed from the
 *  result's own fields, so it is there before anyone clicks "Explain fit". */
export function MatchReasonsLine({ m }: { m: MatchResult }) {
  const t = useTranslations("match") as unknown as MatchReasonsTranslator;
  const reasons = matchReasons(m, t);
  if (!reasons) return null;
  return <p className="mt-1.5 text-body text-ink">{reasons.line}</p>;
}
