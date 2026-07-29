"use client";

/*
 * Localized match vocabulary — the i18n resolvers every match surface shares
 * (card, results, compare, group-eval, recruiter list). Split out of
 * MatchPresentation.tsx: these are hooks over the match.* catalog with no JSX,
 * so they belong in a .ts module rather than a component file.
 */

import { useTranslations } from "next-intl";
import type { ConfidenceBandCopy, FitTierLabels } from "@/app/_components/Badge";
import type { Confidence, KoReason, LabelCode, ScoreDimension } from "@/app/features/shared/matchTypes";

// Localized confidence-band vocabulary for the shared Badge primitive, resolved
// HERE (in a consuming layer) from the match.band.* catalog and passed down — the
// Badge stays locale-dumb. One hook so every match surface (card, results,
// compare, group-eval, recruiter list) speaks the same band language.
export function useConfidenceBandCopy(): ConfidenceBandCopy {
  const t = useTranslations("match.band");
  return {
    tight: { label: t("tight.label"), ariaLabel: t("tight.aria") },
    moderate: { label: t("moderate.label"), ariaLabel: t("moderate.aria") },
    wide: { label: t("wide.label"), ariaLabel: t("wide.aria") },
    title: { prefix: t("titlePrefix"), fallback: t("titleFallback") },
  };
}

// Localized fit-tier vocabulary (match.fitTier.*) for FitTierBadge — the tier
// concept is the server's (matching.py fit_tier_for), the display words are the
// recruiter's language, resolved here and passed to the dumb primitive.
export function useFitTierLabels(): FitTierLabels {
  const t = useTranslations("match.fitTier");
  return {
    strong: t("strong"),
    promising: t("promising"),
    partial: t("partial"),
    unknown: t("unknown"),
  };
}

// Shared resolver for the four Python-emitted, code-carried labels (localize-python-
// seam): drivers, assumptions, KO clauses, and score-breakdown dimension names. Python
// is locale-blind and ships stable CODES + params (matching.py); this renders the
// session language from the match.* catalog, always with the legacy English string as
// the back-compat fallback so an older/codeless cached payload never renders blank.
// One hook so every match surface (card, results, compare) localizes identically.
// A code-keyed catalog is dynamic by nature (the key is a runtime string from the
// wire), so we read each scoped translator through a loose signature — has(code)
// then t(code, params) — rather than the literal-key type next-intl infers for
// static keys. i18n:check + the en.json Messages augmentation still guarantee the
// keys exist across locales; this only relaxes the compile-time key literal.
type LooseTranslator = { (key: string, values?: Record<string, string | number>): string; has: (key: string) => boolean };

export function useMatchLabels() {
  const tDrivers = useTranslations("match.drivers") as unknown as LooseTranslator;
  const tAssume = useTranslations("match.assumptions") as unknown as LooseTranslator;
  const tKo = useTranslations("match.koClause") as unknown as LooseTranslator;
  const tDims = useTranslations("match.dims") as unknown as LooseTranslator;

  // Zip parallel [codes] with their [englishFallback], localizing each code and
  // falling back index-for-index (then to the raw code) when a catalog lacks it.
  const zip = (t: LooseTranslator, codes: LabelCode[] | undefined, fallback: string[]): string[] => {
    if (!codes?.length) return fallback;
    return codes.map((c, i) => (t.has(c.code) ? t(c.code, c.params) : (fallback[i] ?? c.code)));
  };

  return {
    /** Localized confidence-band drivers (match.drivers.*), English drivers as fallback. */
    drivers: (c: Confidence): string[] => zip(tDrivers, c.driverCodes, c.drivers ?? []),
    /** Localized candidate assumptions (match.assumptions.*), English strings as fallback. */
    assumptions: (codes: LabelCode[] | undefined, fallback: string[]): string[] =>
      zip(tAssume, codes, fallback),
    /** Localized KO-clause label (match.koClause.<key>), server `label` as fallback. */
    koLabel: (r: KoReason): string => (tKo.has(r.key) ? tKo(r.key) : r.label),
    /** Localized score-breakdown dimension name (match.dims.<labelCode>), `label` fallback. */
    dimLabel: (d: ScoreDimension): string =>
      d.labelCode && tDims.has(d.labelCode) ? tDims(d.labelCode) : d.label,
  };
}
