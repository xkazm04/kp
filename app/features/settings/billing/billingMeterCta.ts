// Pure decision for a usage-meter row: which recovery/upgrade affordance to
// show, if any. Extracted from MeterRow so node:test can pin it without loading
// a .tsx. The row used to CTA only a depleted interview_minutes pack, so hitting
// the last published role or AI-candidate unit was a dead badge even though
// that is the Starter upgrade moment.

export type MeterCta = "pack" | "upgrade" | "warn" | null;

/** Remaining at-or-below this is "approaching" on a numeric limit.
 *  20% of the allowance, floored, but never less than 1 so a 1-unit Free
 *  meter still warns before it empties. Unlimited (null) never warns. */
export function meterWarnAt(limit: number | null): number {
  return limit === null ? 0 : Math.max(1, Math.floor(limit * 0.2));
}

/** minutes+0 → pack; other limited meters at 0 → upgrade; remaining in
 *  (0, warnAt] → warn; unlimited or comfortable remaining → none. */
export function meterCta(
  meterId: string | undefined,
  remaining: number | null,
  limit: number | null
): MeterCta {
  if (limit === null) return null;
  const left = remaining ?? 0;
  if (left <= 0) return meterId === "interview_minutes" ? "pack" : "upgrade";
  return left <= meterWarnAt(limit) ? "warn" : null;
}
