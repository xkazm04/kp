"use client";

// The Scoreboard variant's two pieces: the workspace summary row and the
// per-role micro-funnel. Extracted so the variant file stays table + state.
import { useTranslations } from "next-intl";
import type { forecastHires } from "@/app/_lib/analytics-forecast";
import { PANEL } from "@/app/_components/ui/recipes";
import { DeltaChip } from "../AnalyticsDeltaChip";
import type { Analytics } from "../AnalyticsTypes";

type Forecast = ReturnType<typeof forecastHires>;

/**
 * The workspace aggregate as ONE row above the table — the scoreboard's
 * "all teams" line. Deliberately a strip, not a panel grid: on this variant the
 * aggregate is context for the ranking, and giving it card weight would restate
 * the baseline's hierarchy inside a design that exists to reject it.
 */
export function ScoreboardSummary({ data, forecast }: { data: Analytics; forecast: Forecast }) {
  const t = useTranslations("analytics");
  const cells: { label: string; value: string | number; sub?: string; delta?: React.ReactNode; tone?: string }[] = [
    {
      label: t("statCandidates"),
      value: data.total,
      sub: t("activeSub", { count: data.active }),
      delta: data.deltas?.total ? <DeltaChip delta={data.deltas.total} /> : null,
    },
    {
      label: t("statHired"),
      value: data.hired,
      sub: data.total > 0 ? `${Math.round((data.hired / data.total) * 100)}%` : undefined,
      delta: data.deltas?.hireRatePct ? <DeltaChip delta={data.deltas.hireRatePct} unit="pts" /> : null,
      tone: "text-moss",
    },
    {
      label: t("statTimeToHire"),
      value: data.avgTimeToHireDays ?? "—",
      sub: data.avgTimeToHireDays != null ? t("daysAvg") : t("noHires"),
      delta: data.deltas?.avgTimeToHireDays ? <DeltaChip delta={data.deltas.avgTimeToHireDays} unit="days" lowerIsBetter /> : null,
    },
    {
      label: t("forecast.inFlight"),
      value: forecast.hasSignal ? forecast.inFlightExpectedHires : "—",
      sub: t("deckExpectedHires"),
    },
    {
      label: t("scoreboardOpenRoles"),
      value: data.byJobTotal,
      sub: t("scoreboardRanked", { count: data.byJob.length }),
    },
  ];
  return (
    <div className={`${PANEL} grid grid-cols-2 divide-stone-200 sm:grid-cols-3 lg:grid-cols-5 lg:divide-x`}>
      {cells.map((c) => (
        <div key={c.label} className="flex flex-col gap-0.5 p-4">
          <span className="text-meta uppercase text-steel">{c.label}</span>
          <span className={`font-serif text-h2 leading-none nums ${c.tone ?? "text-ink"}`}>{c.value}</span>
          <span className="flex flex-wrap items-center gap-1.5 text-sm text-steel">
            {c.sub ? <span>{c.sub}</span> : null}
            {c.delta}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * A role's funnel as one stacked bar: total width encodes VOLUME against the
 * busiest role (so a big role reads big), and the segments encode where that
 * role's candidates got to. Two roles' shapes are comparable at a glance, which
 * is the whole reason the ranking is worth having.
 */
export function RoleFunnelBar({
  row,
  peak,
}: {
  row: { jobTitle: string; total: number; reachedInterview: number; hired: number };
  peak: number;
}) {
  const t = useTranslations("analytics");
  if (row.total === 0) return <span className="text-sm text-steel">—</span>;
  const width = Math.max(6, Math.round((row.total / peak) * 100));
  const interviewed = Math.min(row.reachedInterview, row.total);
  const hired = Math.min(row.hired, interviewed);
  const pctOf = (n: number) => `${(n / row.total) * 100}%`;
  return (
    <span
      role="img"
      aria-label={t("scoreboardShapeAria", {
        role: row.jobTitle,
        total: row.total,
        interviewed: row.reachedInterview,
        hired: row.hired,
      })}
      className="flex h-4 items-center"
      style={{ width: `${width}%` }}
      title={t("scoreboardShapeAria", {
        role: row.jobTitle,
        total: row.total,
        interviewed: row.reachedInterview,
        hired: row.hired,
      })}
    >
      <span className="relative h-2.5 w-full overflow-hidden rounded-full bg-stone-200">
        <span className="absolute inset-y-0 left-0 bg-steel/40" style={{ width: pctOf(interviewed) }} />
        <span className="absolute inset-y-0 left-0 bg-moss" style={{ width: pctOf(hired) }} />
      </span>
    </span>
  );
}
