"use client";

import { Boxes, ClipboardList, GitBranch, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { formatFraction } from "@/app/_lib/format";
import { PANEL } from "@/app/_components/ui/recipes";
import { DevAnalysisReflectionCard } from "./DevAnalysisReflectionCard";
import { DevAnalysisDesignCard } from "./DevAnalysisDesignCard";
import type { Design, NeedAnalysis, RepoSnapshot, Result } from "./DevTypes";
import type { Task } from "@/app/features/shell/tasks/TasksProvider";

export function AnalysisView({
  viewed,
  running,
  result,
  analysis,
  snapshots,
  design,
  designing,
  startDesign,
  approve,
  approving,
  approvedId,
}: {
  viewed: Task | null;
  running: boolean;
  result: Result | null;
  analysis: NeedAnalysis;
  snapshots: RepoSnapshot[];
  design: Design | null;
  designing: boolean;
  startDesign: () => void;
  approve: () => void;
  approving: boolean;
  approvedId: string | null;
}) {
  const t = useTranslations("devcase.studio.analysis");
  return (
    <section className="min-w-0">
      {viewed == null ? (
        <div className="rounded-lg border border-dashed border-stone-200 p-8 text-center text-base text-steel">
          {t("empty")}
        </div>
      ) : running ? (
        <div className={`${PANEL} p-8 text-center`}>
          <Loader2 className="mx-auto animate-spin text-coral" size={26} />
          <p className="mt-2 text-base font-semibold text-ink">{t("running")}</p>
          <p className="text-sm text-steel">{t("runningHint")}</p>
        </div>
      ) : result ? (
        <div className="space-y-4">
          <DevAnalysisReflectionCard result={result} analysis={analysis} />

          {snapshots.length > 0 ? (
            // One card per grounded codebase (multi-repo: the role can span up to 3).
            snapshots.map((snapshot, i) => (
              <div key={snapshot.ref ?? i} className={`${PANEL} p-4`}>
                <div className="mb-2 flex items-center gap-1.5">
                  <Boxes size={14} className="text-steel" />
                  <span className="text-meta uppercase tracking-wide text-steel">
                    {snapshots.length > 1
                      ? t("snapshotIndexed", { index: i + 1, total: snapshots.length })
                      : t("snapshot")}
                  </span>
                  {snapshot.ref ? <span className="min-w-0 truncate text-micro text-steel">{snapshot.ref}</span> : null}
                  <span className="ml-auto shrink-0 text-micro text-steel">
                    {t("loc", { loc: (snapshot.loc ?? 0).toLocaleString() })}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(snapshot.languages ?? {}).slice(0, 6).map(([k, v]) => (
                    <span key={k} className="rounded-md border border-stone-200 px-2 py-0.5 text-micro text-ink">
                      {k} <span className="text-steel">{formatFraction(v, { label: "language share" })}</span>
                    </span>
                  ))}
                </div>
                {(snapshot.topDirs ?? []).length > 0 ? (
                  <p className="mt-2 text-micro text-steel">
                    {t("topDirs", { dirs: (snapshot.topDirs ?? []).slice(0, 10).join(" / ") })}
                  </p>
                ) : null}
                {(snapshot.recentCommitSummaries ?? []).length > 0 ? (
                  <p className="mt-1 flex items-center gap-1 text-micro text-steel">
                    <GitBranch size={11} /> {t("commitsRead", { count: (snapshot.recentCommitSummaries ?? []).length })}
                  </p>
                ) : null}
              </div>
            ))
          ) : (
            <p className="rounded-md border border-dashed border-stone-200 p-3 text-sm text-steel">{t("noSnapshot")}</p>
          )}

          {/* D3 — artifact design + human gate */}
          {!design && !designing ? (
            <button type="button" onClick={startDesign}
              className="focus-ring inline-flex h-10 items-center gap-1.5 rounded-md border border-coral/40 bg-coral/5 px-3 text-base font-semibold text-coral hover:bg-coral/10">
              <ClipboardList size={15} /> {t("designCta")}
            </button>
          ) : null}
          {designing ? (
            <div className={`${PANEL} p-6 text-center`}>
              <Loader2 className="mx-auto animate-spin text-coral" size={22} />
              <p className="mt-2 text-base font-semibold text-ink">{t("designing")}</p>
              <p className="text-sm text-steel">{t("designingHint")}</p>
            </div>
          ) : null}
          {design ? (
            <DevAnalysisDesignCard design={design} approve={approve} approving={approving} approvedId={approvedId} />
          ) : null}
        </div>
      ) : (
        <div className="rounded-lg border border-stone-200 bg-red-50 p-4 text-base text-red-700">
          {/* Reaching this branch with a SUCCEEDED task means the run finished and its
              full record could not be read (useTaskResult gave up after
              RESULT_FETCH_MAX_ATTEMPTS, or the record carries no result) — saying
              "did not complete" over that would blame the analysis for a fetch that
              failed, and hide the fact that a retry is a re-fetch, not a re-run.
              `viewed.error` is the engine's own English string (same class as the
              engine-authored reasons[] known gap in docs/features/dev-case) — it is
              shown as-is when present, and the localized message is what a reader
              gets when it is not. */}
          {viewed.status === "succeeded" ? t("resultUnreadable") : viewed.error ?? t("failed")}
        </div>
      )}
    </section>
  );
}
