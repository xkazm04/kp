"use client";

import { Building2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useJsonFetch } from "@/app/_lib/useJsonFetch";
import { useNumberFormat } from "@/app/_lib/use-number-format";
import { PANEL, STAT_VALUE } from "@/app/_components/ui/recipes";

import { LoadingGap } from "@/app/_components/ui/LoadingGap";
// Phase 2 (cross-company reference tier) — "how your team compares to the whole company".
// Reads /api/benchmarks: the team's own hiring stats + the org-wide AGGREGATE (org_id-join,
// k-anonymity-withheld below the floor). Everything shown is an aggregate — no candidate,
// row, or peer-team identity is ever fetched.

type Stats = { totalEntries: number; interviewRatePct: number; hireRatePct: number; medianTimeToHireDays: number | null };
type OrgBench = Stats & { available: boolean; contributingTeams: number };

// Null is "not measured" for BOTH of these, and it renders as the same em-dash the
// median already used — never as a zero (see the denominator note in the panel body).
//
// Both used to be template literals: `${n}%` and `${n}d`. The percent skipped the
// locale's number formatter (harmless at two digits, wrong the moment a figure
// grows), and the `d` was a hard-coded ENGLISH day suffix on a surface that ships in
// four languages — the one abbreviation on this panel a `cs`/`de`/`fr` reader had to
// decode. Both now run through the shared formatter + catalog, built as a factory so
// the hook is called once in the component rather than per figure.
type Fmt = { grouped: (n: number) => string; unit: (key: "pctValue" | "dayValue", value: string) => string };
const pct = (f: Fmt) => (n: number | null) => (n == null ? "—" : f.unit("pctValue", f.grouped(n)));
const days = (f: Fmt) => (n: number | null) => (n == null ? "—" : f.unit("dayValue", f.grouped(n)));

// `orgVal` used to ride alongside `orgLabel` here: destructured, typed, and never
// rendered, while each of the three call sites computed a second formatted copy of
// the org figure to feed it. The org number DOES reach the screen — through
// `orgLabel`, which is `t("orgLabel", { value })` -> "Org: 42%". So this was dead
// weight, not a missing benchmark; the distinction is the only reason the prop was
// worth reading the render for rather than deleting on the lint warning alone.
function Metric({
  label,
  teamVal,
  diff,
  higherBetter,
  orgLabel,
  aheadLabel,
  behindLabel,
}: {
  label: string;
  teamVal: string;
  diff: number | null;
  higherBetter: boolean;
  orgLabel: string;
  aheadLabel: string;
  behindLabel: string;
}) {
  // null diff (a missing time-to-hire on either side) shows no verdict chip.
  const better = diff == null || diff === 0 ? null : higherBetter ? diff > 0 : diff < 0;
  return (
    <div className="rounded-md border border-stone-200 bg-paper p-3">
      <p className="text-micro font-semibold uppercase tracking-wide text-steel">{label}</p>
      <p className={`mt-1 ${STAT_VALUE} text-ink`}>{teamVal}</p>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-micro">
        <span className="text-steel">{orgLabel}</span>
        {better === null ? null : (
          <span className={`font-semibold ${better ? "text-moss" : "text-coral"}`}>{better ? aheadLabel : behindLabel}</span>
        )}
      </div>
    </div>
  );
}

export function OrgBenchmarkPanel() {
  const t = useTranslations("analytics.orgBenchmark");
  const { grouped } = useNumberFormat();
  const fmt: Fmt = { grouped, unit: (key, value) => t(key, { value }) };
  const pctOf = pct(fmt);
  const daysOf = days(fmt);
  const { data, error, reload } = useJsonFetch<{ team: Stats; org: OrgBench }>("/api/benchmarks", t("loadFailed"));
  // bug-ui-scan-2026-07-09 (analytics-calibration-dashboards #5): a fetch FAILURE used to
  // be indistinguishable from "still loading" and from the by-design locked state — the
  // panel just vanished (if (!data) return null). Surface the error explicitly, with a
  // retry, so the three states are separable and a transient 500 is recoverable.
  if (error) {
    return (
      <section className={`${PANEL} p-5`}>
        <div className="flex items-center gap-2">
          <Building2 size={16} className="text-steel" />
          <h3 className="text-sm font-semibold uppercase tracking-wide text-steel">{t("title")}</h3>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-steel" role="alert">
          <span>{error}</span>
          <button
            type="button"
            onClick={reload}
            className="focus-ring inline-flex h-8 items-center rounded-md border border-stone-300 bg-white px-3 text-sm font-medium text-ink hover:bg-paper"
          >
            {t("retry")}
          </button>
        </div>
      </section>
    );
  }
  // Loading choreography (docs/design/loading-choreography.md, tier 2): a quiet reserved
  // box while the fetch is in flight — invisible for 150ms, so a fast response
  // never flashes it — instead of the skeleton the primary funnel doesn't use either.
  if (!data) return <LoadingGap className={`${PANEL} min-h-[10rem] p-5`} />;
  const { team, org } = data;
  // A DENOMINATOR, not a zero. `statsFrom()` (db/org-benchmarks.ts) short-circuits an
  // empty team to `{ totalEntries: 0, interviewRatePct: 0, hireRatePct: 0,
  // medianTimeToHireDays: null }` — only the median is honestly null. So a team that
  // has never run a single candidate arrived here indistinguishable from a team that
  // ran many and converted none, and the Metric chip below turned that into a coral
  // „behind" verdict against the company on both rates. A new team joining an
  // established org (the exact case this panel unlocks for) read it on its first visit.
  // Rates are read only once there is something behind them; the median already was.
  const measured = team.totalEntries > 0;
  const teamInterviewPct = measured ? team.interviewRatePct : null;
  const teamHirePct = measured ? team.hireRatePct : null;
  const tth =
    team.medianTimeToHireDays == null || org.medianTimeToHireDays == null
      ? null
      : team.medianTimeToHireDays - org.medianTimeToHireDays;

  return (
    <section className={`${PANEL} p-5`}>
      <div className="flex items-center gap-2">
        <Building2 size={16} className="text-steel" />
        <h3 className="text-sm font-semibold uppercase tracking-wide text-steel">{t("title")}</h3>
      </div>
      <p className="mt-1 text-sm text-steel">{t("subtitle")}</p>
      {/* UAT KAT-ANA-5 — this panel lives in the Performance section, UNDER the
          30/90-day switcher, and /api/benchmarks takes no window at all: it is
          all-time by design (see the route + org-benchmarks.ts for why a windowed
          benchmark would be both withheld and biased). So it names its own scope
          where the numbers are read, the way the compute panel's manualAllTime /
          manualWindowed line already does for the CZK leg. */}
      <p className="mt-1 text-micro text-steel">{t("scopeAllTime")}</p>

      {!org.available ? (
        <p className="mt-4 rounded-md bg-paper p-3 text-sm text-steel">{t("locked", { teams: org.contributingTeams })}</p>
      ) : (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <Metric
              label={t("interviewRate")}
              teamVal={pctOf(teamInterviewPct)}
              diff={teamInterviewPct == null ? null : teamInterviewPct - org.interviewRatePct}
              higherBetter
              orgLabel={t("orgLabel", { value: pctOf(org.interviewRatePct) })}
              aheadLabel={t("ahead")}
              behindLabel={t("behind")}
            />
            <Metric
              label={t("hireRate")}
              teamVal={pctOf(teamHirePct)}
              diff={teamHirePct == null ? null : teamHirePct - org.hireRatePct}
              higherBetter
              orgLabel={t("orgLabel", { value: pctOf(org.hireRatePct) })}
              aheadLabel={t("ahead")}
              behindLabel={t("behind")}
            />
            <Metric
              label={t("timeToHire")}
              teamVal={daysOf(team.medianTimeToHireDays)}
              diff={tth}
              higherBetter={false}
              orgLabel={t("orgLabel", { value: daysOf(org.medianTimeToHireDays) })}
              aheadLabel={t("ahead")}
              behindLabel={t("behind")}
            />
          </div>
          <p className="mt-3 text-micro text-steel">{t("footnote", { teams: org.contributingTeams })}</p>
        </>
      )}
    </section>
  );
}
