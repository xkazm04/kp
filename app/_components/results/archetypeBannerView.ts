// Pure presentation logic for ArchetypeBanner, extracted so it is unit-testable
// under `node --test` (the .tsx cannot be loaded by the JSX-less runner).
import { formatFraction } from "@/app/_lib/format";

/**
 * bug-ui-scan-2026-07-09 (analysis-result-panels #2): format an OPTIONAL 0..1
 * fraction (archetype confidence / completeness) for a chip.
 *
 * Returns `null` when the field is absent or non-finite, so the UI can OMIT the
 * chip rather than render a definite "0%". The prior `Math.round((x ?? 0) * 100)`
 * conflated *absent* with a real zero — an analysis that simply never supplied a
 * confidence read as "confidence 0%", which a recruiter takes as "the engine is
 * sure this archetype is wrong". A present value routes through {@link formatFraction}
 * so an out-of-range value (a 0..100 number mistakenly fed as a fraction) clamps to
 * "100%" instead of rendering an absurd "8500%".
 */
export function formatOptionalFraction(value: unknown, label: string): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return formatFraction(value, { label });
}
