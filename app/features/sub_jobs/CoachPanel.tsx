"use client";

import { AlertTriangle, CheckCircle2, Coins, Languages, SlidersHorizontal, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { useJsonFetch } from "@/app/_lib/useJsonFetch";
import { EmptyState } from "./JobsShared";
// bug-ui-scan-2026-07-09 (sourcing-campaigns-rediscovery #5): the salary band is
// formatted through the shared APP_CURRENCY helper (see coach-salary.ts) instead of a
// local cs-CZ + hardcoded "CZK" template, so the coach can't mislabel the currency.
import { fmtBand } from "./coach-salary";

type Gate = { kind: "language" | "education"; value: string; eligibleDelta: number };
type MustHave = { skill: string; missingAmongEligible: number; qualifiedDelta: number };
type Salary = {
  family: string;
  seniority: string;
  jobBand: [number, number] | null;
  marketBand: [number, number] | null;
  // null = verdict honestly silenced (job band and benchmark band are in
  // different currencies; the pipeline does no FX — winnability.py mirror).
  belowMarket: boolean | null;
  currencyComparable?: boolean;
  topVsMarketFloorPct?: number;
};
type Winnability = {
  poolSize: number;
  eligible?: number;
  qualified?: number;
  fitThreshold?: number;
  looseGates?: Gate[];
  looseMustHaves?: MustHave[];
  salary?: Salary;
  // bug-ui-scan-2026-07-09 (pipeline-clis-script-bridges #4): candidates the CLI
  // couldn't score (a malformed/partially-extracted profile). Surfaced so the
  // recruiter sees the counts were computed over a reduced denominator.
  skipped?: { id: string; label: string; reason: string }[];
  note?: string;
};

// idea-aa039d0c — pre-publish winnability coach. Reuses the production scorers via
// /api/jobs/[id]/winnability to answer "will this JD actually fill?" BEFORE the
// recruiter sources: how many candidates clear the gates, which requirement is
// silently emptying the pipeline, and whether the salary undercuts the market.
export function CoachPanel({ jobId, jobTitle }: { jobId: string; jobTitle: string }) {
  const t = useTranslations("jobs.coach");
  const { data, error, reload } = useJsonFetch<Winnability>(
    `/api/jobs/${encodeURIComponent(jobId)}/winnability`,
    t("loadFailed")
  );

  if (error) {
    return (
      <div className="text-base text-coral">
        {error}{" "}
        <button type="button" onClick={reload} className="focus-ring underline hover:text-ink">
          {t("retry")}
        </button>
      </div>
    );
  }
  if (!data) return <p className="text-base text-steel">{t("grading")}</p>;
  if (data.poolSize === 0) {
    return <EmptyState icon={Users} title={t("emptyPoolTitle")} body={t("emptyPoolBody")} />;
  }

  const eligible = data.eligible ?? 0;
  const qualified = data.qualified ?? 0;
  const gates = (data.looseGates ?? []).filter((g) => g.eligibleDelta > 0);
  // Only must-haves that actually cost candidates are worth surfacing as a lever.
  const musts = (data.looseMustHaves ?? []).filter((m) => m.qualifiedDelta > 0 || m.missingAmongEligible > 0);
  const salary = data.salary;
  // bug-ui-scan-2026-07-09 (pipeline-clis-script-bridges #4): the stat tiles below
  // count only the candidates the CLI could score. If it dropped any, say so — an
  // "eligible 3 of 10" verdict is dishonest when 2 were never assessed.
  const skippedCount = data.skipped?.length ?? 0;

  // Verdict: zero qualified is an unfillable JD; a thin pipeline (qualified is a
  // small slice of the pool) is a caution; otherwise it's healthy. Keep the t()
  // keys literal (next-intl types reject template-literal keys), so resolve the
  // message + style through explicit maps rather than `verdict.${...}`.
  const verdict: "unfillable" | "thin" | "healthy" =
    qualified === 0 ? "unfillable" : qualified <= 2 ? "thin" : "healthy";
  const verdictMessage = {
    unfillable: "verdict.unfillable",
    thin: "verdict.thin",
    healthy: "verdict.healthy",
  } as const;
  const verdictStyle =
    verdict === "unfillable"
      ? "border-coral/40 bg-coral/5 text-coral"
      : verdict === "thin"
        ? "border-dial-amber/40 bg-dial-amber/10 text-ink"
        : "border-moss/40 bg-moss/10 text-ink";
  const statTiles = [
    { key: "stat.pool", n: data.poolSize },
    { key: "stat.eligible", n: eligible },
    { key: "stat.qualified", n: qualified },
  ] as const;

  return (
    <div className="space-y-4">
      <div className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 ${verdictStyle}`}>
        {verdict === "healthy" ? (
          <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-moss" />
        ) : (
          <AlertTriangle size={18} className="mt-0.5 shrink-0" />
        )}
        <p className="text-base font-medium">
          {t.rich(verdictMessage[verdict], {
            jobTitle,
            qualified,
            eligible,
            pool: data.poolSize,
            b: (chunks) => <span className="font-semibold">{chunks}</span>,
          })}
        </p>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {statTiles.map((tile) => (
          <div key={tile.key} className="rounded-lg border border-stone-200 bg-white px-3 py-2 text-center">
            <p className="text-2xl font-semibold text-ink">{tile.n}</p>
            <p className="text-meta uppercase text-steel">{t(tile.key)}</p>
          </div>
        ))}
      </div>

      {skippedCount > 0 ? (
        <div className="flex items-start gap-2 rounded-lg border border-dial-amber/40 bg-dial-amber/10 px-3 py-2 text-base text-ink">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-dial-amber" />
          <p>{t("notAssessed", { n: skippedCount })}</p>
        </div>
      ) : null}

      {gates.length > 0 || musts.length > 0 ? (
        <div>
          <h4 className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-steel">
            <SlidersHorizontal size={14} /> {t("loosenHeading")}
          </h4>
          <ul className="space-y-1.5">
            {gates.map((g) => (
              <li key={`g-${g.value}`} className="flex items-center gap-2 rounded-md border border-stone-200 bg-white px-3 py-2 text-base">
                <Languages size={15} className="shrink-0 text-coral" />
                <span className="flex-1 text-ink">
                  {t.rich(g.kind === "language" ? "gateLanguage" : "gateEducation", {
                    value: g.value,
                    n: g.eligibleDelta,
                    b: (chunks) => <span className="font-semibold">{chunks}</span>,
                  })}
                </span>
                <span className="shrink-0 rounded-full bg-moss/10 px-2 py-0.5 text-sm font-semibold text-moss">
                  +{g.eligibleDelta}
                </span>
              </li>
            ))}
            {musts.map((m) => (
              <li key={`m-${m.skill}`} className="flex items-center gap-2 rounded-md border border-stone-200 bg-white px-3 py-2 text-base">
                <SlidersHorizontal size={15} className="shrink-0 text-coral" />
                <span className="flex-1 text-ink">
                  {t.rich("mustHave", {
                    skill: m.skill,
                    missing: m.missingAmongEligible,
                    b: (chunks) => <span className="font-semibold">{chunks}</span>,
                  })}
                </span>
                {m.qualifiedDelta > 0 ? (
                  <span className="shrink-0 rounded-full bg-moss/10 px-2 py-0.5 text-sm font-semibold text-moss">
                    +{m.qualifiedDelta}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* A silenced verdict (belowMarket === null: cross-currency bands, no FX)
          renders NOTHING — "salaryOk" would be a confident-but-wrong claim, and
          fmtBand would relabel the job's figures in APP_CURRENCY. */}
      {salary && salary.marketBand && salary.belowMarket !== null ? (
        <div
          className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 ${
            salary.belowMarket ? "border-coral/40 bg-coral/5" : "border-stone-200 bg-white"
          }`}
        >
          <Coins size={16} className={`mt-0.5 shrink-0 ${salary.belowMarket ? "text-coral" : "text-steel"}`} />
          <p className="text-base text-ink">
            {salary.belowMarket
              ? t.rich("salaryBelow", {
                  job: fmtBand(salary.jobBand) ?? t("salaryUnset"),
                  market: fmtBand(salary.marketBand) ?? "",
                  b: (chunks) => <span className="font-semibold text-coral">{chunks}</span>,
                })
              : t.rich("salaryOk", {
                  market: fmtBand(salary.marketBand) ?? "",
                  b: (chunks) => <span className="font-semibold">{chunks}</span>,
                })}
          </p>
        </div>
      ) : null}

      <p className="text-meta text-steel">{t("footnote")}</p>
    </div>
  );
}
