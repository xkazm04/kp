"use client";

import { ARCHETYPE_STYLE } from "../sub_pipeline/PipelineTypes";
import { useJsonFetch } from "@/app/_lib/useJsonFetch";

type Funnel = { stage: string; reached: number; current: number; conversionPct: number | null };
type Decision = {
  id: number;
  candidateLabel: string | null;
  jobTitle: string | null;
  kind: string;
  fromStage: string | null;
  toStage: string | null;
  detail: string | null;
  createdAt: string;
};
type Analytics = {
  total: number;
  active: number;
  hired: number;
  rejected: number;
  funnel: Funnel[];
  avgTimeToHireDays: number | null;
  avgAgeDays: number | null;
  bottleneck: { stage: string; avgDaysInStage: number } | null;
  byJob: { jobTitle: string; total: number; reachedInterview: number; hired: number; hireRatePct: number }[];
  byArchetype: { archetype: string; total: number; hired: number; advanceRatePct: number }[];
  recentDecisions: Decision[];
};

// Decode raw event kinds into a readable label + whether the system decided it
// (auto) or a human did. Powers the auditable decision log.
const DECISION_META: Record<string, { label: string; auto: boolean; tone: string }> = {
  advanced: { label: "Auto-advanced", auto: true, tone: "text-moss" },
  screening_hold: { label: "Held for human review", auto: true, tone: "text-ink" },
  interview_scorecard: { label: "Scorecard synthesized", auto: true, tone: "text-steel" },
  interview_prep_generated: { label: "Interview prep generated", auto: true, tone: "text-steel" },
  offer_drafted: { label: "Offer drafted", auto: true, tone: "text-steel" },
  rematched: { label: "Re-matched to another role", auto: true, tone: "text-steel" },
  outreach_sent: { label: "Outreach sent", auto: true, tone: "text-steel" },
  rejection_sent: { label: "Rejection sent", auto: true, tone: "text-coral" },
  rejected: { label: "Rejected", auto: false, tone: "text-coral" },
  scheduled: { label: "Interview slot set", auto: false, tone: "text-steel" },
  interview_scheduled: { label: "Interview confirmed", auto: false, tone: "text-moss" },
  offer_sent: { label: "Offer sent", auto: false, tone: "text-steel" },
  offer_accepted: { label: "Offer accepted", auto: false, tone: "text-moss" },
  offer_declined: { label: "Offer declined", auto: false, tone: "text-coral" },
  onboarding_started: { label: "Onboarding started", auto: false, tone: "text-moss" },
};

// Attribution is three-state on purpose. In an auditable log, defaulting an
// unrecognized kind to AUTO would misattribute accountability to the machine —
// the most damaging default. An unmapped kind renders a neutral UNKNOWN badge
// and warns in dev, so adding a backend event kind forces a conscious entry in
// DECISION_META above (the kinds here must track recordAutomationEvent callers).
function decisionMeta(kind: string): { label: string; attribution: "auto" | "human" | "unknown"; tone: string } {
  const meta = DECISION_META[kind];
  if (meta) return { label: meta.label, attribution: meta.auto ? "auto" : "human", tone: meta.tone };
  if (process.env.NODE_ENV !== "production") {
    console.warn(`[analytics] unmapped decision kind "${kind}" — add it to DECISION_META (rendering as UNKNOWN, not AUTO).`);
  }
  return { label: kind.replace(/_/g, " "), attribution: "unknown", tone: "text-steel" };
}

const ATTRIBUTION_BADGE = {
  auto: { text: "AUTO", cls: "bg-moss/10 text-moss" },
  human: { text: "HUMAN", cls: "bg-coral/10 text-coral" },
  unknown: { text: "UNKNOWN", cls: "bg-stone-100 text-steel" },
} as const;

function timeAgo(iso: string): string {
  const parsed = Date.parse(iso);
  // Guard against a blank/malformed timestamp rendering as "NaNm ago".
  if (!Number.isFinite(parsed)) return "—";
  const mins = Math.max(0, Math.round((Date.now() - parsed) / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export function AnalyticsTab() {
  const { data, error } = useJsonFetch<Analytics>("/api/analytics", "Couldn't load analytics.");

  if (error) return <p className="text-base text-coral">{error}</p>;
  if (!data) return <p className="text-base text-steel">Loading analytics…</p>;

  const maxReached = Math.max(1, ...data.funnel.map((f) => f.reached));

  return (
    <section className="space-y-6">
      <header className="border-b border-stone-200 pb-4">
        <p className="text-meta uppercase text-coral">Insights</p>
        <h2 className="mt-1 font-serif text-display text-ink">Pipeline analytics</h2>
        <p className="mt-2 max-w-3xl text-body text-steel">
          Funnel health across every job — where candidates are, how they convert stage to stage, and where they stall.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Candidates" value={data.total} sub={`${data.active} active`} />
        <Stat label="Hired" value={data.hired} sub={data.rejected ? `${data.rejected} rejected` : undefined} />
        <Stat label="Avg time-to-hire" value={data.avgTimeToHireDays ?? "—"} sub={data.avgTimeToHireDays != null ? "days" : "no hires yet"} />
        <Stat label="Avg age in pipeline" value={data.avgAgeDays ?? "—"} sub={data.avgAgeDays != null ? "days, active" : undefined} />
      </div>

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
            <span className="font-semibold">Bottleneck:</span> candidates in{" "}
            <span className="font-medium">{data.bottleneck.stage}</span> have waited{" "}
            <span className="font-medium">{data.bottleneck.avgDaysInStage} days</span> on average.
          </p>
        ) : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
          <h3 className="font-serif text-h2 text-ink">By role</h3>
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
          </ul>
        </div>
      </div>

      <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
        <div className="flex items-baseline justify-between">
          <h3 className="font-serif text-h2 text-ink">Decision log</h3>
          <p className="text-meta uppercase text-steel">every automated &amp; human decision, auditable</p>
        </div>
        {data.recentDecisions.length === 0 ? (
          <p className="mt-3 text-base text-steel">No decisions recorded yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-stone-100">
            {data.recentDecisions.map((d) => {
              const m = decisionMeta(d.kind);
              const badge = ATTRIBUTION_BADGE[m.attribution];
              return (
                <li key={d.id} className="flex items-center gap-3 py-2">
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-meta font-semibold ${badge.cls}`}>
                    {badge.text}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-base text-ink">
                      <span className={`font-medium ${m.tone}`}>{m.label}</span>
                      {d.candidateLabel ? <span className="text-steel"> · {d.candidateLabel}</span> : null}
                      {d.fromStage && d.toStage && d.fromStage !== d.toStage ? (
                        <span className="text-steel">
                          {" "}
                          · {d.fromStage} → {d.toStage}
                        </span>
                      ) : null}
                    </p>
                    {d.detail ? <p className="truncate text-sm text-steel">{d.detail}</p> : null}
                  </div>
                  <span className="shrink-0 text-sm text-steel">{timeAgo(d.createdAt)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-4 shadow-panel">
      <p className="text-meta uppercase text-steel">{label}</p>
      <p className="mt-1 font-serif text-display leading-none text-ink">{value}</p>
      {sub ? <p className="mt-1 text-sm text-steel">{sub}</p> : null}
    </div>
  );
}
