"use client";

import { Building2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useJsonFetch } from "@/app/_lib/useJsonFetch";
import { PANEL } from "@/app/_components/ui/recipes";

// Phase 2 (cross-company reference tier) — "how your team compares to the whole company".
// Reads /api/benchmarks: the team's own hiring stats + the org-wide AGGREGATE (org_id-join,
// k-anonymity-withheld below the floor). Everything shown is an aggregate — no candidate,
// row, or peer-team identity is ever fetched.

type Stats = { totalEntries: number; interviewRatePct: number; hireRatePct: number; medianTimeToHireDays: number | null };
type OrgBench = Stats & { available: boolean; contributingTeams: number };

const pct = (n: number) => `${n}%`;
const days = (n: number | null) => (n == null ? "—" : `${n}d`);

function Metric({
  label,
  teamVal,
  orgVal,
  diff,
  higherBetter,
  orgLabel,
  aheadLabel,
  behindLabel,
}: {
  label: string;
  teamVal: string;
  orgVal: string;
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
      <p className="mt-1 text-2xl font-bold tabular-nums text-ink">{teamVal}</p>
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
  // Secondary panel — stay silent (render nothing) until the payload lands, rather than
  // flashing a skeleton the way the primary funnel does.
  if (!data) return null;
  const { team, org } = data;
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

      {!org.available ? (
        <p className="mt-4 rounded-md bg-paper p-3 text-sm text-steel">{t("locked", { teams: org.contributingTeams })}</p>
      ) : (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <Metric
              label={t("interviewRate")}
              teamVal={pct(team.interviewRatePct)}
              orgVal={pct(org.interviewRatePct)}
              diff={team.interviewRatePct - org.interviewRatePct}
              higherBetter
              orgLabel={t("orgLabel", { value: pct(org.interviewRatePct) })}
              aheadLabel={t("ahead")}
              behindLabel={t("behind")}
            />
            <Metric
              label={t("hireRate")}
              teamVal={pct(team.hireRatePct)}
              orgVal={pct(org.hireRatePct)}
              diff={team.hireRatePct - org.hireRatePct}
              higherBetter
              orgLabel={t("orgLabel", { value: pct(org.hireRatePct) })}
              aheadLabel={t("ahead")}
              behindLabel={t("behind")}
            />
            <Metric
              label={t("timeToHire")}
              teamVal={days(team.medianTimeToHireDays)}
              orgVal={days(org.medianTimeToHireDays)}
              diff={tth}
              higherBetter={false}
              orgLabel={t("orgLabel", { value: days(org.medianTimeToHireDays) })}
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
