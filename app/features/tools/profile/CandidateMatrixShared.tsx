"use client";

// Pieces both candidate-matrix variants render: the score-distribution bar that
// summarizes a group at a glance, and the retired-archetype flag.
//
// Hoisted the moment the second variant needed it (the prototype rule) so a tweak
// to how a cohort's shape reads lands once, in both directions.

import { useTranslations } from "next-intl";
import { BANDS, type ArchetypeGroup, type Band } from "./candidateMatrixView";

// Band → token. These are the SAME `--color-score-*` tokens ScoreBadge maps to, so
// a bar segment and the badges beneath it always agree on who is strong; `unscored`
// borrows the neutral score-null token rather than inventing a fourth colour.
const BAND_FILL: Record<Band, string> = {
  strong: "bg-score-strong",
  mid: "bg-score-mid",
  weak: "bg-score-weak",
  unscored: "bg-score-null/40",
};

/**
 * One archetype's cohort shape as a single stacked bar: how many strong / mid /
 * weak / not-yet-assessed candidates routed to it.
 *
 * This is what lets a recruiter orient WITHOUT opening a group — "12 candidates,
 * mostly weak" and "12 candidates, half strong" are the same number in the baseline
 * table and completely different situations. The bar is decorative for AT (the
 * counts are in the accessible label), so it carries aria-hidden and the label does
 * the talking.
 */
export function DistributionBar({ group, className = "" }: { group: ArchetypeGroup; className?: string }) {
  const t = useTranslations("profile.matrix");
  const total = group.candidates.length;
  if (total === 0) return null;
  const label = BANDS.filter((b) => group.bands[b] > 0)
    .map((b) => t(`band_${b}` as "band_strong", { count: group.bands[b] }))
    .join(", ");
  return (
    <span
      className={`flex h-1.5 w-full overflow-hidden rounded-full bg-stone-100 ${className}`}
      role="img"
      aria-label={t("distributionAria", { archetype: group.label, bands: label })}
    >
      {BANDS.map((band) =>
        group.bands[band] > 0 ? (
          <span
            key={band}
            aria-hidden
            className={BAND_FILL[band]}
            style={{ width: `${(group.bands[band] / total) * 100}%` }}
          />
        ) : null
      )}
    </span>
  );
}

/** The "this archetype was retired" flag. Same vocabulary as the roster's, so the
 *  marking reads identically across both candidate projections. */
export function RetiredFlag() {
  const t = useTranslations("profile.roster");
  return (
    <span
      className="rounded-full bg-stone-200 px-1.5 py-0.5 text-micro font-semibold uppercase tracking-wide text-steel"
      title={t("retiredArchetypeTitle")}
    >
      {t("retiredArchetype")}
    </span>
  );
}
