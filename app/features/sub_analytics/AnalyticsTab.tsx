"use client";

import { ARCHETYPE_STYLE } from "../sub_pipeline/PipelineTypes";
import { useJsonFetch } from "@/app/_lib/useJsonFetch";
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
};

export function AnalyticsTab() {
  const { data, error, reload } = useJsonFetch<Analytics>("/api/analytics", "Couldn't load analytics.");

  if (error)
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3 text-base text-coral">
        <span>{error}</span>
        <button
          type="button"
          onClick={reload}
          className="focus-ring inline-flex h-8 items-center rounded-md border border-stone-200 px-3 text-sm font-semibold text-ink hover:border-coral/40"
        >
          Retry
        </button>
      </div>
    );
  if (!data) return <p className="text-base text-steel">Loading analytics…</p>;

  const maxReached = Math.max(1, ...data.funnel.map((f) => f.reached));

  return (
    <section className="space-y-6">
      <header className="flex flex-col gap-5 border-b border-stone-200 pb-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-meta uppercase text-coral">Insights</p>
          <h2 className="mt-1 font-serif text-display text-ink">Pipeline analytics</h2>
          <p className="mt-2 max-w-3xl text-body text-steel">
            Funnel health across every job — where candidates are, how they convert stage to stage, and where they stall.
          </p>
        </div>

        {/* Compact key-stat cluster pinned to the top-right; hairline dividers
            keep four figures in the space one full-size card used to take. */}
        <div className="grid shrink-0 grid-cols-2 gap-px overflow-hidden rounded-lg border border-stone-200 bg-stone-200 shadow-panel lg:w-[22rem]">
          <Stat label="Candidates" value={data.total} sub={`${data.active} active`} />
          <Stat
            label="Hired"
            value={data.hired}
            // Reject and decline read separately so the offer-acceptance signal
            // (candidates who turned us down) isn't hidden inside "rejected".
            sub={
              [data.rejected ? `${data.rejected} rejected` : null, data.declined ? `${data.declined} declined` : null]
                .filter(Boolean)
                .join(" · ") || undefined
            }
          />
          <Stat label="Time-to-hire" value={data.avgTimeToHireDays ?? "—"} sub={data.avgTimeToHireDays != null ? "days avg" : "no hires yet"} />
          <Stat label="Age in pipeline" value={data.avgAgeDays ?? "—"} sub={data.avgAgeDays != null ? "days, active" : undefined} />
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
          <div className="flex items-baseline justify-between">
            <h3 className="font-serif text-h2 text-ink">Funnel</h3>
            <p className="text-meta uppercase text-steel">reached · conversion · active now</p>
          </div>
          <ul className="mt-4 space-y-2.5">
            {data.funnel.map((f) => (
              <li key={f.stage} className="flex items-center gap-3">
                <span className="w-28 shrink-0 text-base font-medium text-ink">{f.stage}</span>
                <div className="relative h-7 flex-1 overflow-hidden rounded-md bg-paper">
                  <div
                    className="h-full rounded-md bg-moss/25"
                    style={{ width: `${Math.round((f.reached / maxReached) * 100)}%` }}
                  />
                  <div className="absolute inset-0 flex items-center gap-2 px-2.5 text-sm text-ink">
                    <span className="font-semibold">{f.reached}</span>
                    {f.current > 0 ? <span className="text-steel">· {f.current} here now</span> : null}
                  </div>
                </div>
                <span className="w-16 shrink-0 text-right text-sm">
                  {f.conversionPct != null ? (
                    <span className={f.conversionPct < 50 ? "text-coral" : "text-moss"}>{f.conversionPct}%</span>
                  ) : (
                    <span className="text-steel">—</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
          {data.bottleneck ? (
            <p className="mt-4 rounded-md border border-dial-amber/40 bg-dial-amber/10 px-3 py-2 text-base text-ink">
              <span className="font-semibold">Bottleneck:</span> the{" "}
              <span className="font-medium">{data.bottleneck.entryCount}</span> active candidates in{" "}
              <span className="font-medium">{data.bottleneck.stage}</span> have waited{" "}
              <span className="font-medium">{data.bottleneck.avgDaysInStage} days</span> on average.
            </p>
          ) : null}
        </div>

        <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
          <h3 className="font-serif text-h2 text-ink">By archetype</h3>
          <ul className="mt-3 space-y-3">
            {data.byArchetype.map((a) => (
              <li key={a.archetype}>
                <div className="flex items-baseline justify-between text-base">
                  <span className="font-medium text-ink">{ARCHETYPE_STYLE[a.archetype]?.label ?? a.archetype}</span>
                  <span className="text-steel">{a.total} · {a.hired} hired</span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-paper">
                  <div className="h-full rounded-full bg-steel/40" style={{ width: `${a.advanceRatePct}%` }} />
                </div>
                <p className="mt-0.5 text-sm text-steel">{a.advanceRatePct}% advanced past screening</p>
              </li>
            ))}
            {data.byArchetype.length === 0 ? (
              <li className="text-base text-steel">No archetype data yet.</li>
            ) : null}
          </ul>
        </div>
      </div>

      <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="font-serif text-h2 text-ink">By role</h3>
          {/* The table is capped to the highest-volume roles; say so explicitly when
              there are more, so it never reads as the complete list of open roles. */}
          {data.byJobTotal > data.byJob.length ? (
            <p className="text-meta uppercase text-steel">Top {data.byJob.length} of {data.byJobTotal} by volume</p>
          ) : null}
        </div>
        <table className="mt-3 w-full text-base">
          <thead>
            <tr className="border-b border-stone-200 text-left text-meta uppercase text-steel">
              <th className="pb-2 font-semibold">Job</th>
              <th className="pb-2 text-right font-semibold">In pipeline</th>
              <th className="pb-2 text-right font-semibold">Reached interview</th>
              <th className="pb-2 text-right font-semibold">Hired</th>
              <th className="pb-2 text-right font-semibold">Hire rate</th>
            </tr>
          </thead>
          <tbody>
            {data.byJob.map((j) => (
              <tr key={j.jobTitle} className="border-b border-stone-100 last:border-0">
                <td className="py-2 pr-2 text-ink">{j.jobTitle}</td>
                <td className="py-2 text-right text-steel">{j.total}</td>
                <td className="py-2 text-right text-steel">{j.reachedInterview}</td>
                <td className="py-2 text-right text-ink">{j.hired}</td>
                <td className="py-2 text-right font-medium text-moss">{j.hireRatePct}%</td>
              </tr>
            ))}
            {data.byJob.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-3 text-steel">
                  No pipeline entries yet.
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

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-white px-4 py-2.5">
      <p className="text-meta uppercase text-steel">{label}</p>
      <p className="mt-0.5 font-serif text-h2 leading-none text-ink">{value}</p>
      {sub ? <p className="mt-0.5 text-sm text-steel">{sub}</p> : null}
    </div>
  );
}
