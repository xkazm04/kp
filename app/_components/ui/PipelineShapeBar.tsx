"use client";

// A role's pipeline as one stacked bar — volume in the bar's WIDTH, progress in
// its segments.
//
// Two roles' bars are comparable at a glance, which is what makes a list of roles
// rankable by eye: a wide bar with almost no fill is a big role that isn't moving;
// a narrow bar that is mostly moss is a small role that closed. Reading the same
// story out of four numeric columns takes real effort.
//
// Born in the Analytics "scoreboard" prototype and promoted here when that
// overview moved to the JD library, which is where a recruiter is already looking
// at their roles.
import { useTranslations } from "next-intl";

export function PipelineShapeBar({
  label,
  total,
  reachedInterview,
  hired,
  peak,
}: {
  /** The role this bar describes — used only for the accessible name. */
  label: string;
  total: number;
  reachedInterview: number;
  hired: number;
  /** The busiest role in the same list; the bar's width is total/peak. */
  peak: number;
}) {
  const t = useTranslations("pipelineShape");
  if (total === 0) return <span className="text-sm text-stone-400">—</span>;

  // A minimum width so the smallest role is still a visible mark rather than a
  // sliver that reads as "no data".
  const width = Math.max(6, Math.round((total / Math.max(1, peak)) * 100));
  // Clamp so a data anomaly (more hired than interviewed) can't draw a segment
  // wider than its parent instead of surfacing as an obviously odd bar.
  const interviewed = Math.min(reachedInterview, total);
  const hiredClamped = Math.min(hired, interviewed);
  const pctOf = (n: number) => `${(n / total) * 100}%`;
  const name = t("aria", { role: label, total, interviewed: reachedInterview, hired });

  return (
    <span role="img" aria-label={name} title={name} className="flex h-4 items-center" style={{ width: `${width}%` }}>
      <span className="relative h-2.5 w-full overflow-hidden rounded-full bg-stone-200">
        <span className="absolute inset-y-0 left-0 bg-steel/40" style={{ width: pctOf(interviewed) }} />
        <span className="absolute inset-y-0 left-0 bg-moss" style={{ width: pctOf(hiredClamped) }} />
      </span>
    </span>
  );
}
