"use client";

// The Flight-deck variant's two instruments, extracted so the variant file stays
// a layout + derivation file and these stay independently reusable (a vital tile
// and a stage-flow are both things other surfaces could want).
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ChevronRight } from "lucide-react";
import type { Delta } from "@/app/_lib/analytics-deltas";
import { PANEL } from "@/app/_components/ui/recipes";
import { DeltaChip } from "../AnalyticsDeltaChip";
import { GoalsEditor } from "../AnalyticsGoalsEditor";
import type { Funnel } from "../AnalyticsTypes";

export type DeckAlert = { key: string; tone: "caution" | "critical"; text: string; href?: string };

/**
 * One station on the vitals strip. Unlike the baseline `Stat`, a target is drawn
 * as a track marker rather than as a separate goal chip: the point of an
 * instrument is that you read the deviation, not the number and then the goal.
 */
export function DeckVital({
  label,
  value,
  sub,
  delta,
  unit,
  lowerIsBetter,
  target,
  actual,
  tone,
}: {
  label: string;
  value: number | string;
  sub?: string;
  delta?: Delta | null;
  unit?: "pts" | "days";
  lowerIsBetter?: boolean;
  /** Draw the target track when both this and `actual` are known. */
  target?: number | null;
  actual?: number | null;
  tone?: "moss";
}) {
  const hasTrack = target != null && actual != null && target > 0;
  // How far along the track the actual sits, with the target pinned at 60% so
  // both "under" and "over" have room to read.
  const pct = hasTrack ? Math.min(100, Math.round((actual / target) * 60)) : 0;
  const missed = hasTrack ? (lowerIsBetter ? actual > target : actual < target) : false;
  return (
    <div className="flex flex-col gap-1 bg-white p-3">
      <span className="text-meta uppercase text-steel">{label}</span>
      <span className={`font-serif text-h2 leading-none nums ${tone === "moss" ? "text-moss" : "text-ink"}`}>{value}</span>
      {hasTrack ? (
        <div className="relative mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-paper" aria-hidden>
          <div className={`h-full rounded-full ${missed ? "bg-coral/60" : "bg-moss/60"}`} style={{ width: `${pct}%` }} />
          <div className="absolute inset-y-0 w-px bg-ink/40" style={{ left: "60%" }} />
        </div>
      ) : null}
      <span className="flex flex-wrap items-center gap-1.5 text-sm text-steel">
        {sub ? <span>{sub}</span> : null}
        {delta ? <DeltaChip delta={delta} unit={unit} lowerIsBetter={lowerIsBetter} /> : null}
      </span>
    </div>
  );
}

/**
 * The funnel as a left-to-right FLOW rather than a bar ranking: each stage is a
 * station, and the gap between two stations carries the conversion (and the drop)
 * that happens there. A funnel is a sequence — the baseline's vertical bar list
 * renders it as a leaderboard, which is the wrong shape for the question
 * "where do people fall out".
 */
export function DeckFlow({
  funnel,
  targets,
  convDeltaByStage,
  enumLabel,
  boardHref,
  koDeclined,
  empty,
  onGoalsSaved,
}: {
  funnel: Funnel[];
  targets: { conversion: Record<string, number>; timeToHireDays: number | null };
  convDeltaByStage: Map<string, Delta>;
  enumLabel: (kind: string, value: string) => string;
  boardHref: (filter: { q?: string; stage?: string }) => string;
  koDeclined: number;
  empty: boolean;
  onGoalsSaved: () => void;
}) {
  const t = useTranslations("analytics");
  const peak = Math.max(1, ...funnel.map((f) => f.reached));
  return (
    <div className={`${PANEL} p-4`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-serif text-h2 text-ink">{t("funnel")}</h3>
        {koDeclined > 0 ? <p className="text-sm text-steel">{t("koDeclinedLine", { count: koDeclined })}</p> : null}
      </div>

      {empty ? (
        <p className="mt-4 rounded-md bg-paper p-3 text-base text-steel">{t("funnelEmpty")}</p>
      ) : (
        // The whole flow has to fit the card: a station that scrolls out of view
        // takes the last stage — Hired, the one the funnel exists to explain —
        // off screen. Columns flex, the connectors are fixed and narrow, and the
        // row only scrolls once even the minimums can't fit.
        <ol className="mt-4 flex w-full items-stretch overflow-x-auto pb-1">
          {funnel.map((f, i) => {
            const goal = targets.conversion[f.stage];
            const missed = f.conversionPct != null && f.conversionPct < (goal ?? 50);
            const height = Math.max(8, Math.round((f.reached / peak) * 100));
            return (
              <li key={f.stage} className="flex min-w-0 flex-1 items-stretch">
                {/* The gap between two stations is where the conversion lives. */}
                {i > 0 ? (
                  <div className="flex w-11 shrink-0 flex-col items-center justify-center gap-0.5">
                    <ChevronRight size={14} className="text-stone-300" aria-hidden />
                    {f.conversionPct != null ? (
                      <span className={`text-sm font-semibold nums ${missed ? "text-coral" : "text-moss"}`}>{f.conversionPct}%</span>
                    ) : (
                      <span className="text-sm text-steel">—</span>
                    )}
                    {convDeltaByStage.get(f.stage) ? <DeltaChip delta={convDeltaByStage.get(f.stage)!} unit="pts" /> : null}
                  </div>
                ) : null}

                <Link
                  href={boardHref({ stage: f.stage })}
                  title={t("viewInBoard")}
                  className="focus-ring flex min-w-[5.5rem] flex-1 flex-col justify-end gap-1.5 rounded-md p-1.5 transition-colors hover:bg-paper/70"
                >
                  {/* The column height IS the volume — read the silhouette, not
                      the digits, and the funnel's shape is the first thing seen. */}
                  <div className="flex h-24 items-end">
                    <div
                      className={`w-full rounded-t-md ${missed ? "bg-coral/25" : "bg-moss/25"}`}
                      style={{ height: `${height}%` }}
                      role="img"
                      aria-label={t("funnelBarAria", {
                        stage: enumLabel("stage", f.stage),
                        reached: f.reached,
                        conv: f.conversionPct != null ? t("funnelConvSuffix", { pct: f.conversionPct }) : "",
                      })}
                    />
                  </div>
                  <span className="text-base font-semibold text-ink nums">{f.reached}</span>
                  <span className="truncate text-sm font-medium text-ink">{enumLabel("stage", f.stage)}</span>
                  {f.current > 0 ? (
                    <span className="truncate text-sm text-steel">{t("hereNow", { count: f.current })}</span>
                  ) : (
                    <span className="text-sm text-transparent" aria-hidden>·</span>
                  )}
                </Link>
              </li>
            );
          })}
        </ol>
      )}

      <GoalsEditor
        stages={funnel.map((f) => f.stage)}
        conversion={targets.conversion}
        timeToHireDays={targets.timeToHireDays}
        onSaved={onGoalsSaved}
      />
    </div>
  );
}
