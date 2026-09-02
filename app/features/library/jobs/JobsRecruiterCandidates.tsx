"use client";

import { Scale, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { SkippedCandidatesNote } from "./JobsShared";
import { useRecruiterCandidatesLogic } from "./jobsRecruiterCandidatesLogic";
import { CandidateColumn } from "./JobsRecruiterCandidatesColumn";
import { FairnessAuditPanel, NotEligibleSection } from "./JobsRecruiterCandidatesFairness";

export function RecruiterCandidates({
  jobId,
  jobTitle,
  roleFamily,
  autoLoad = false,
}: {
  jobId: string;
  jobTitle: string;
  roleFamily: string | null;
  autoLoad?: boolean;
}) {
  const t = useTranslations("jobs.candidates");
  const {
    data,
    loading,
    error,
    load,
    fairRank,
    poolFitOnly,
    setPoolFitOnly,
    setFairRank,
    added,
    adding,
    cardError,
    announce,
    reached,
    reaching,
    reachError,
    reachAnnounce,
    addToPipeline,
    reachOut,
    poolFitCount,
    earlyCareer,
    experienced,
    notEligibleRows,
    notEligible,
    skipped,
    poolTruncated,
    fairness,
    fairById,
    hasFairness,
    fairActive,
    orderRows,
    exportFairness,
  } = useRecruiterCandidatesLogic({ jobId, jobTitle, roleFamily, autoLoad });

  if (!data) {
    return (
      <div className="rounded-md border border-dashed border-stone-300 p-3">
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="focus-ring rounded-md bg-ink px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
        >
          {loading ? t("scoring") : t("scoreCandidates")}
        </button>
        {error ? <span className="ml-2 text-sm text-red-700">{error}</span> : null}
      </div>
    );
  }

  return (
    <div className="rounded-md border border-stone-200 p-3">
      <p role="status" aria-live="polite" className="sr-only">
        {[announce, reachAnnounce].filter(Boolean).join(" ")}
      </p>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold uppercase tracking-wide text-coral">
          {t("title")}
        </p>
        <div className="flex items-center gap-2">
          {poolFitCount > 0 ? (
            <button
              type="button"
              onClick={() => setPoolFitOnly((v) => !v)}
              aria-pressed={poolFitOnly}
              title={t("poolFitTitle")}
              className={`focus-ring inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-sm font-semibold ${
                poolFitOnly ? "border-coral bg-coral/10 text-coral" : "border-stone-200 bg-white text-steel hover:border-coral/40 hover:text-ink"
              }`}
            >
              <Users size={13} /> {t("poolFit", { count: poolFitCount })}
            </button>
          ) : null}
          {hasFairness ? (
            <button
              type="button"
              onClick={() => setFairRank((v) => !v)}
              aria-pressed={fairRank}
              title={t("fairRankTitle")}
              className={`focus-ring inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-sm font-semibold ${
                fairActive ? "border-coral bg-coral/10 text-coral" : "border-stone-200 bg-white text-steel hover:border-coral/40 hover:text-ink"
              }`}
            >
              <Scale size={13} /> {t("fairRank")}
            </button>
          ) : null}
          <span className="text-sm text-steel">{t("notEligible", { count: notEligible })}</span>
        </div>
      </div>
      <p className="mt-1 text-sm text-steel">{t("earlyCareerNote")}</p>
      {poolFitOnly ? <p className="mt-1 text-sm text-steel">{t("poolFitNote")}</p> : null}
      {fairActive ? <p className="mt-1 text-sm text-steel">{t("fairRankNote")}</p> : null}
      <SkippedCandidatesNote skipped={skipped} />
      {/* The pool was capped (route's `poolTruncated`): say so where the ranking,
          the KO count and the Pool-Fit count are read, in the same advisory
          amber the skipped-candidates note wears — a cut slice presented as the
          whole pool is the shape this tab must never take. */}
      {poolTruncated ? (
        <p role="note" className="mt-2 rounded-md border border-amber-200 bg-amber-50/60 px-2.5 py-1.5 text-sm text-amber-800">
          {t("poolTruncatedNote")}
        </p>
      ) : null}
      <div className="mt-3 grid gap-4 lg:grid-cols-2">
        <CandidateColumn
          title={t("experienced")}
          rows={orderRows(experienced)}
          added={added}
          adding={adding}
          error={cardError}
          onAdd={addToPipeline}
          reached={reached}
          reaching={reaching}
          reachError={reachError}
          onReach={reachOut}
          fair={fairActive ? (id) => fairById.get(id) : undefined}
        />
        <CandidateColumn
          title={t("earlyCareerPipeline")}
          rows={orderRows(earlyCareer)}
          highlight
          added={added}
          adding={adding}
          error={cardError}
          onAdd={addToPipeline}
          reached={reached}
          reaching={reaching}
          reachError={reachError}
          onReach={reachOut}
          fair={fairActive ? (id) => fairById.get(id) : undefined}
        />
      </div>
      {hasFairness ? (
        <FairnessAuditPanel fairness={fairness!} fairById={fairById} onExport={exportFairness} />
      ) : null}
      <NotEligibleSection rows={notEligibleRows} />
    </div>
  );
}
