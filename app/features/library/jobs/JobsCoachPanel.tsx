"use client";

import { AlertTriangle, CheckCircle2, Coins, Users } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useJsonFetch } from "@/app/_lib/useJsonFetch";
import { PANEL_SUNKEN, STAT, STAT_LABEL, STAT_VALUE } from "@/app/_components/ui/recipes";
import { jdSlugOfJobId } from "@/app/_lib/jd-limits";
import { buildUrl, clearedTabScopedParams } from "@/app/features/shell/tabs";
import { EmptyState } from "./JobsShared";
import { buildCoachEditParam, COACH_EDIT_PARAM, type CoachEditKind } from "./jobsCoachApply";
// bug-ui-scan-2026-07-09 (sourcing-campaigns-rediscovery #5): the salary band is
// formatted through the shared APP_CURRENCY helper (see coach-salary.ts) instead of a
// local cs-CZ + hardcoded "CZK" template, so the coach can't mislabel the currency.
import { fmtBand } from "./jobsCoachSalary";
import type { Winnability } from "./jobsCoachPanelTypes";
import { JobsCoachPanelLoosenList } from "./JobsCoachPanelLoosenList";

// idea-aa039d0c — pre-publish winnability coach. Reuses the production scorers via
// /api/jobs/[id]/winnability to answer "will this JD actually fill?" BEFORE the
// recruiter sources: how many candidates clear the gates, which requirement is
// silently emptying the pipeline, and whether the salary undercuts the market.
export function CoachPanel({ jobId, jobTitle }: { jobId: string; jobTitle: string }) {
  const t = useTranslations("jobs.coach");
  // The cap admission is the candidates ranking's sentence, read from ITS namespace
  // rather than copied into this one: the coach grades the same capped pool, so the
  // two surfaces must never drift into two different accounts of the same cap.
  const tc = useTranslations("jobs.candidates");
  // Reader-locale digit grouping for the coach's bands (format.ts number-locale contract).
  const locale = useLocale();
  const router = useRouter();
  const search = useSearchParams();
  const { data, error, reload } = useJsonFetch<Winnability>(
    `/api/jobs/${encodeURIComponent(jobId)}/winnability`,
    t("loadFailed")
  );

  // winnability-apply — the coach never mutates the job (it stays read-only), but a
  // loosen-gate / demote-must-have recommendation can hand off into the EXISTING JD
  // editor with the change STAGED for the recruiter to confirm. Only JD-backed jobs
  // (id `jd-<slug>`) have an editable description in the Library; a seeded/corpus job
  // has no slug, so the affordance is honestly absent there. Salary rows never carry
  // it — the matchable band is fixed to the grounded market analysis.
  const jdSlug = jdSlugOfJobId(jobId);
  const stageEdit = (kind: CoachEditKind, value: string, delta: number) => {
    if (!jdSlug) return;
    const param = buildCoachEditParam({ kind, slug: jdSlug, delta, value });
    if (!param) return;
    // Land in the Library ledger with a clean slice (clear other tab-scoped params)
    // plus the one-shot staged edit; the ledger opens the JD in edit mode and paints
    // a dismissible suggestion banner. Nothing auto-saves.
    router.push(buildUrl({ tab: "library", ...clearedTabScopedParams(), [COACH_EDIT_PARAM]: param }, search.toString()));
  };

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
  if (!data)
    // Multi-second CLI winnability grade: reserve the verdict + stat-tile
    // shape quietly (no skeleton bars) — the short copy line is the only
    // signal, per docs/design/loading-choreography.md (a long-expected LLM/CLI wait
    // is the one case that earns a line of real copy over bare silence).
    return (
      <div className="reveal-quiet min-h-[14rem] space-y-3" aria-busy="true">
        <p className="text-sm text-steel">{t("grading")}</p>
      </div>
    );
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
          <div key={tile.key} className={`${STAT} items-center px-3 py-2`}>
            <p className={`${STAT_VALUE} text-ink`}>{tile.n}</p>
            <p className={STAT_LABEL}>{t(tile.key)}</p>
          </div>
        ))}
      </div>

      {data.poolTruncated ? (
        <p className={`${PANEL_SUNKEN} px-3 py-2 text-sm text-steel`}>
          {tc("poolTruncatedNote")}
        </p>
      ) : null}

      {skippedCount > 0 ? (
        <div className="flex items-start gap-2 rounded-lg border border-dial-amber/40 bg-dial-amber/10 px-3 py-2 text-base text-ink">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-dial-amber" />
          <p>{t("notAssessed", { n: skippedCount })}</p>
        </div>
      ) : null}

      <JobsCoachPanelLoosenList gates={gates} musts={musts} jdSlug={jdSlug} stageEdit={stageEdit} t={t} />

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
                  job: fmtBand(salary.jobBand, locale) ?? t("salaryUnset"),
                  market: fmtBand(salary.marketBand, locale) ?? "",
                  b: (chunks) => <span className="font-semibold text-coral">{chunks}</span>,
                })
              : t.rich("salaryOk", {
                  market: fmtBand(salary.marketBand, locale) ?? "",
                  b: (chunks) => <span className="font-semibold">{chunks}</span>,
                })}
          </p>
        </div>
      ) : null}

      <p className="text-meta text-steel">{t("footnote")}</p>
    </div>
  );
}
