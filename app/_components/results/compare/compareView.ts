/** Pure derivations behind the Compare tab. Extracted from CompareTab.tsx (an
 *  IIFE and a closure over `t`, neither reachable by a test) — see
 *  compareView.test.ts beside it. */

import type { CompareDriver } from "@/app/_lib/comparison";

/** Per-column disambiguation badge, or null.
 *
 *  Variant labels are not unique — two CV variants can share a filename, or
 *  both fall back to "CV" — and two identically-labelled columns are otherwise
 *  indistinguishable except by the winner's crown. Number ONLY the colliding
 *  ones ("1", "2" among same-labelled columns) so a report whose labels are
 *  already unique stays noise-free. */
export function collidingLabelBadges(labels: readonly string[]): (number | null)[] {
  const totals = new Map<string, number>();
  for (const label of labels) totals.set(label, (totals.get(label) ?? 0) + 1);
  const seen = new Map<string, number>();
  return labels.map((label) => {
    if ((totals.get(label) ?? 0) < 2) return null;
    const n = (seen.get(label) ?? 0) + 1;
    seen.set(label, n);
    return n;
  });
}

/** Localized words this module cannot produce itself: the score-component and
 *  metric names live in the report catalog, so the caller passes bound
 *  resolvers rather than this module reaching for a hook. */
export interface DriverLabelResolvers {
  component: (component: string) => string;
  metric: (metric: "overall" | "jobFit") => string;
}

/** A catalog key plus its ICU values — everything `t()` needs and nothing more. */
export interface DriverMessage {
  key: string;
  values: Record<string, string | number>;
}

/** One structured driver insight → the line the Compare tab renders. Keeping the
 *  key/values choice out of the component is what makes "does a `driver` insight
 *  name its component, in the reader's language?" a testable question. */
export function driverMessage(item: CompareDriver, labels: DriverLabelResolvers): DriverMessage {
  switch (item.kind) {
    case "tie":
      return {
        key: "compare.narrativeTie",
        values: { best: item.best, other: item.other, metric: labels.metric(item.metric), score: item.score },
      };
    case "delta":
      return {
        key: "compare.narrativeDelta",
        values: {
          best: item.best,
          other: item.other,
          dir: item.dir,
          amount: item.amount,
          metric: labels.metric(item.metric),
          bestScore: item.bestScore,
          otherScore: item.otherScore,
        },
      };
    case "driver":
      return {
        key: "compare.narrativeDriver",
        values: { component: labels.component(item.component), dir: item.dir, amount: item.amount, other: item.other },
      };
    case "uniqueBest":
      return { key: "compare.narrativeUniqueBest", values: { best: item.best, skills: item.skills.join(", ") } };
    case "uniqueOther":
      return { key: "compare.narrativeUniqueOther", values: { other: item.other, skills: item.skills.join(", ") } };
  }
}
