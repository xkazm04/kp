"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useJsonFetch } from "@/app/_lib/useJsonFetch";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import type { MomentumWeek } from "@/app/_lib/analytics-momentum";
import { buildUrl, clearedTabScopedParams } from "@/app/features/tabs";
import { DecisionLog } from "./DecisionLog";

type Funnel = { stage: string; reached: number; current: number; conversionPct: number | null };
type Analytics = {
  total: number;
  active: number;
  hired: number;
  // Distinct terminal closes: company-side reject vs. candidate-side decline.
  rejected: number;
  declined: number;
  funnel: Funnel[];
  avgTimeToHireDays: number | null;
  avgAgeDays: number | null;
  bottleneck: { stage: string; avgDaysInStage: number; entryCount: number } | null;
  byJob: { jobTitle: string; total: number; reachedInterview: number; hired: number; hireRatePct: number }[];
  byJobTotal: number;
  byArchetype: { archetype: string; total: number; hired: number; advanceRatePct: number }[];
  windowDays: number | null;
  momentum: MomentumWeek[];
};

// ANA2 — the selectable windows. null = all time (the server default).
const WINDOW_CHOICES = [null, 30, 90] as const;

export function AnalyticsTab() {
  const t = useTranslations("analytics");
  const enumLabel = useEnumLabel();
  const search = useSearchParams();
  // ANA2 — cohort window. Changing it swaps the fetch URL; useJsonFetch refires
  // on the change (prior data stays visible until the new payload lands).
  const [days, setDays] = useState<number | null>(null);
  const { data, error, reload } = useJsonFetch<Analytics>(
    days ? `/api/analytics?days=${days}` : "/api/analytics",
    t("loadFailed")
  );

  // ANA1 — every chart links to the candidates behind it: a board deep link
  // carrying the matching filter (?stage= funnel stage, ?q= role title), with
  // the other tab-scoped params cleared so the board opens on exactly this
  // cohort. PipelineTab hydrates its filter bar from these at mount.
  const boardHref = (filter: { q?: string; stage?: string }) =>
    buildUrl({ ...clearedTabScopedParams(), tab: "pipeline", ...filter }, search.toString());

  if (error)
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3 text-base text-coral">
        <span>{error}</span>
        <button
          type="button"
          onClick={reload}
          className="focus-ring inline-flex h-8 items-center rounded-md border border-stone-200 px-3 text-sm font-semibold text-ink hover:border-coral/40"
        >
          {t("retry")}
        </button>
      </div>
    );
  if (!data) return <p className="text-base text-steel">{t("loading")}</p>;

  const maxReached = Math.max(1, ...data.funnel.map((f) => f.reached));

  return (
    <section className="space-y-6">
      <header className="flex flex-col gap-5 border-b border-stone-200 pb-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-meta uppercase text-coral">{t("eyebrow")}</p>
          <h2 className="mt-1 font-serif text-display text-ink">{t("title")}</h2>
          <p className="mt-2 max-w-3xl text-body text-steel">{t("intro")}</p>
          {/* ANA2: cohort window — every figure below scopes to entries created
              in the period (all-time stays the default). */}
          <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label={t("windowLabel")}>
            {WINDOW_CHOICES.map((w) => (
              <button
                key={w ?? "all"}
                type="button"
                onClick={() => setDays(w)}
                aria-pressed={days === w}
                className={`focus-ring rounded-full border px-3 py-1 text-sm font-semibold transition-colors ${
                  days === w ? "border-coral bg-coral/10 text-coral" : "border-stone-200 text-steel hover:border-coral/40"
                }`}
              >
                {w == null ? t("windowAll") : t("windowDays", { days: w })}
              </button>
            ))}
          </div>
        </div>

        {/* Compact key-stat cluster pinned to the top-right; hairline dividers
            keep four figures in the space one full-size card used to take. */}
        <div className="grid shrink-0 grid-cols-2 gap-px overflow-hidden rounded-lg border border-stone-200 bg-stone-200 shadow-panel lg:w-[22rem]">
          <Stat label={t("statCandidates")} value={data.total} sub={t("activeSub", { count: data.active })} />
          <Stat
            label={t("statHired")}
            value={data.hired}
            // Reject and decline read separately so the offer-acceptance signal
            // (candidates who turned us down) isn't hidden inside "rejected".
            sub={
              [data.rejected ? t("rejectedSub", { count: data.rejected }) : null, data.declined ? t("declinedSub", { count: data.declined }) : null]
                .filter(Boolean)
                .join(" · ") || undefined
            }
          />
          <Stat label={t("statTimeToHire")} value={data.avgTimeToHireDays ?? "—"} sub={data.avgTimeToHireDays != null ? t("daysAvg") : t("noHires")} />
          <Stat label={t("statAge")} value={data.avgAgeDays ?? "—"} sub={data.avgAgeDays != null ? t("daysActive") : undefined} />
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
          <div className="flex items-baseline justify-between">
            <h3 className="font-serif text-h2 text-ink">{t("funnel")}</h3>
            <p className="text-meta uppercase text-steel">{t("funnelLegend")}</p>
          </div>
          {data.total === 0 ? (
            <p className="mt-4 rounded-md bg-paper p-3 text-base text-steel">{t("funnelEmpty")}</p>
          ) : (
          <ul className="mt-4 space-y-2.5">
            {data.funnel.map((f) => (
              <li key={f.stage}>
                <Link
                  href={boardHref({ stage: f.stage })}
                  title={t("viewInBoard")}
                  className="focus-ring -mx-1.5 flex items-center gap-3 rounded-md px-1.5 py-0.5 hover:bg-paper/70"
                >
                <span className="w-28 shrink-0 text-base font-medium text-ink">{enumLabel("stage", f.stage)}</span>
                <div
                  className="relative h-7 flex-1 overflow-hidden rounded-md bg-paper"
                  role="progressbar"
                  aria-valuenow={f.reached}
                  aria-valuemin={0}
                  aria-valuemax={maxReached}
                  aria-label={t("funnelBarAria", {
                    stage: enumLabel("stage", f.stage),
                    reached: f.reached,
                    conv: f.conversionPct != null ? t("funnelConvSuffix", { pct: f.conversionPct }) : "",
                  })}
                >
                  <div
                    className="h-full rounded-md bg-moss/25"
                    style={{ width: `${Math.round((f.reached / maxReached) * 100)}%` }}
                  />
                  <div className="absolute inset-0 flex items-center gap-2 px-2.5 text-sm text-ink">
                    <span className="font-semibold">{f.reached}</span>
                    {f.current > 0 ? <span className="text-steel">{t("hereNow", { count: f.current })}</span> : null}
                  </div>
                </div>
                <span className="w-16 shrink-0 text-right text-sm">
                  {f.conversionPct != null ? (
                    <span className={f.conversionPct < 50 ? "text-coral" : "text-moss"}>{f.conversionPct}%</span>
                  ) : (
                    <span className="text-steel">—</span>
                  )}
                </span>
                </Link>
              </li>
            ))}
          </ul>
          )}
          {data.bottleneck ? (
            <p className="mt-4 rounded-md border border-dial-amber/40 bg-dial-amber/10 px-3 py-2 text-base text-ink">
              {t.rich("bottleneck", {
                count: data.bottleneck.entryCount,
                stage: enumLabel("stage", data.bottleneck.stage),
                days: data.bottleneck.avgDaysInStage,
                b: (chunks) => <span className="font-semibold">{chunks}</span>,
                m: (chunks) => <span className="font-medium">{chunks}</span>,
              })}{" "}
              <Link
                href={boardHref({ stage: data.bottleneck.stage })}
                className="focus-ring rounded font-semibold text-coral underline-offset-2 hover:underline"
              >
                {t("viewCandidates")}
              </Link>
            </p>
          ) : null}
        </div>

        <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
          <h3 className="font-serif text-h2 text-ink">{t("byArchetype")}</h3>
          <ul className="mt-3 space-y-3">
            {data.byArchetype.map((a) => (
              <li key={a.archetype}>
                <div className="flex items-baseline justify-between text-base">
                  <span className="font-medium text-ink">{enumLabel("archetype", a.archetype)}</span>
                  <span className="text-steel">{t("totalHired", { total: a.total, hired: a.hired })}</span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-paper">
                  <div className="h-full rounded-full bg-steel/40" style={{ width: `${a.advanceRatePct}%` }} />
                </div>
                <p className="mt-0.5 text-sm text-steel">{t("advancedPct", { pct: a.advanceRatePct })}</p>
              </li>
            ))}
            {data.byArchetype.length === 0 ? (
              <li className="text-base text-steel">{t("noArchetypeData")}</li>
            ) : null}
          </ul>
        </div>
      </div>

      <MomentumPanel weeks={data.momentum} />

      <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="font-serif text-h2 text-ink">{t("byRole")}</h3>
          {/* The table is capped to the highest-volume roles; say so explicitly when
              there are more, so it never reads as the complete list of open roles. */}
          {data.byJobTotal > data.byJob.length ? (
            <p className="text-meta uppercase text-steel">{t("topByVolume", { shown: data.byJob.length, total: data.byJobTotal })}</p>
          ) : null}
        </div>
        <table className="mt-3 w-full text-base">
          <thead>
            <tr className="border-b border-stone-200 text-left text-meta uppercase text-steel">
              <th className="pb-2 font-semibold">{t("colJob")}</th>
              <th className="pb-2 text-right font-semibold">{t("colInPipeline")}</th>
              <th className="pb-2 text-right font-semibold">{t("colReachedInterview")}</th>
              <th className="pb-2 text-right font-semibold">{t("colHired")}</th>
              <th className="pb-2 text-right font-semibold">{t("colHireRate")}</th>
            </tr>
          </thead>
          <tbody>
            {data.byJob.map((j) => (
              <tr key={j.jobTitle} className="border-b border-stone-100 last:border-0">
                {/* The title cell links (a tr can't be a Link): the board's free-text
                    filter matches on jobTitle, so ?q=<title> isolates this role. */}
                <td className="py-2 pr-2 text-ink">
                  <Link
                    href={boardHref({ q: j.jobTitle })}
                    title={t("viewInBoard")}
                    className="focus-ring rounded underline-offset-2 hover:text-coral hover:underline"
                  >
                    {j.jobTitle}
                  </Link>
                </td>
                <td className="py-2 text-right text-steel">{j.total}</td>
                <td className="py-2 text-right text-steel">{j.reachedInterview}</td>
                <td className="py-2 text-right text-ink">{j.hired}</td>
                <td className="py-2 text-right font-medium text-moss">{j.hireRatePct}%</td>
              </tr>
            ))}
            {data.byJob.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-3 text-steel">
                  {t("noPipelineEntries")}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <DecisionLog />
    </section>
  );
}

// ANA2 — the weekly trend: grouped mini-bars per rolling week (newest right),
// one bar per series. Heights normalize against the single largest weekly count
// so weeks compare honestly across the whole span.
const MOMENTUM_SERIES = [
  { key: "added", legend: "legendAdded", bar: "bg-steel/50" },
  { key: "advanced", legend: "legendAdvanced", bar: "bg-moss/70" },
  { key: "rejected", legend: "legendRejected", bar: "bg-coral/70" },
  { key: "hired", legend: "legendHired", bar: "bg-ink" },
] as const;

function MomentumPanel({ weeks }: { weeks: MomentumWeek[] }) {
  const t = useTranslations("analytics");
  const format = useFormatter();
  const max = Math.max(1, ...weeks.flatMap((w) => MOMENTUM_SERIES.map((s) => w[s.key])));
  const quiet = weeks.every((w) => MOMENTUM_SERIES.every((s) => w[s.key] === 0));
  const weekLabel = (iso: string) =>
    format.dateTime(new Date(`${iso}T00:00:00`), { day: "numeric", month: "short" });
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-serif text-h2 text-ink">{t("momentum")}</h3>
        <ul className="flex flex-wrap items-center gap-3 text-sm text-steel">
          {MOMENTUM_SERIES.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5">
              <span aria-hidden className={`h-2.5 w-2.5 rounded-sm ${s.bar}`} />
              {t(s.legend)}
            </li>
          ))}
        </ul>
      </div>
      {quiet ? (
        <p className="mt-4 rounded-md bg-paper p-3 text-base text-steel">{t("momentumEmpty")}</p>
      ) : (
        <ol className="mt-4 flex items-end gap-2">
          {weeks.map((w) => (
            <li
              key={w.weekStart}
              className="flex min-w-0 flex-1 flex-col items-center gap-1"
              aria-label={t("momentumWeekAria", {
                date: weekLabel(w.weekStart),
                added: w.added,
                advanced: w.advanced,
                rejected: w.rejected,
                hired: w.hired,
              })}
            >
              <div aria-hidden className="flex h-20 w-full items-end justify-center gap-0.5 rounded-md bg-paper px-1 pt-1">
                {MOMENTUM_SERIES.map((s) => (
                  <div
                    key={s.key}
                    title={`${t(s.legend)}: ${w[s.key]}`}
                    className={`w-1/5 max-w-3 rounded-t-sm ${s.bar}`}
                    style={{ height: `${Math.round((w[s.key] / max) * 100)}%` }}
                  />
                ))}
              </div>
              <span aria-hidden className="truncate text-sm text-steel">{weekLabel(w.weekStart)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-white px-4 py-2.5">
      <p className="text-meta uppercase text-steel">{label}</p>
      <p className="mt-0.5 font-serif text-h2 leading-none text-ink">{value}</p>
      {sub ? <p className="mt-0.5 text-sm text-steel">{sub}</p> : null}
    </div>
  );
}
