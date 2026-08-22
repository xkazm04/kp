"use client";

import { Boxes, ClipboardList, GitBranch, Loader2 } from "lucide-react";
import { formatFraction } from "@/app/_lib/format";
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
  return (
    <section className="min-w-0">
      {viewed == null ? (
        <div className="rounded-lg border border-dashed border-stone-200 p-8 text-center text-base text-steel">
          Define a need and analyze it — the reality reflection appears here.
        </div>
      ) : running ? (
        <div className="rounded-lg border border-stone-200 bg-white p-8 text-center shadow-panel">
          <Loader2 className="mx-auto animate-spin text-coral" size={26} />
          <p className="mt-2 text-base font-semibold text-ink">Pulling the codebase + reflecting…</p>
          <p className="text-sm text-steel">This runs as a background task — you can leave this tab.</p>
        </div>
      ) : result ? (
        <div className="space-y-4">
          <DevAnalysisReflectionCard result={result} analysis={analysis} />

          {snapshots.length > 0 ? (
            // One card per grounded codebase (multi-repo: the role can span up to 3).
            snapshots.map((snapshot, i) => (
              <div key={snapshot.ref ?? i} className="rounded-lg border border-stone-200 bg-white p-4 shadow-panel">
                <div className="mb-2 flex items-center gap-1.5">
                  <Boxes size={14} className="text-steel" />
                  <span className="text-meta uppercase tracking-wide text-steel">
                    Codebase snapshot{snapshots.length > 1 ? ` ${i + 1}/${snapshots.length}` : ""}
                  </span>
                  {snapshot.ref ? <span className="min-w-0 truncate text-micro text-steel">{snapshot.ref}</span> : null}
                  <span className="ml-auto shrink-0 text-micro text-steel">~{(snapshot.loc ?? 0).toLocaleString()} LOC</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(snapshot.languages ?? {}).slice(0, 6).map(([k, v]) => (
                    <span key={k} className="rounded-md border border-stone-200 px-2 py-0.5 text-micro text-ink">
                      {k} <span className="text-steel">{formatFraction(v, { label: "language share" })}</span>
                    </span>
                  ))}
                </div>
                {(snapshot.topDirs ?? []).length > 0 ? (
                  <p className="mt-2 text-micro text-steel">Top dirs: {(snapshot.topDirs ?? []).slice(0, 10).join(" / ")}</p>
                ) : null}
                {(snapshot.recentCommitSummaries ?? []).length > 0 ? (
                  <p className="mt-1 flex items-center gap-1 text-micro text-steel">
                    <GitBranch size={11} /> {(snapshot.recentCommitSummaries ?? []).length} recent commits read
                  </p>
                ) : null}
              </div>
            ))
          ) : (
            <p className="rounded-md border border-dashed border-stone-200 p-3 text-sm text-steel">
              No codebase snapshot — analysis is ungrounded. Add a public GitHub URL to ground it in reality.
            </p>
          )}

          {/* D3 — artifact design + human gate */}
          {!design && !designing ? (
            <button type="button" onClick={startDesign}
              className="focus-ring inline-flex h-10 items-center gap-1.5 rounded-md border border-coral/40 bg-coral/5 px-3 text-base font-semibold text-coral hover:bg-coral/10">
              <ClipboardList size={15} /> Design role &amp; assignment
            </button>
          ) : null}
          {designing ? (
            <div className="rounded-lg border border-stone-200 bg-white p-6 text-center shadow-panel">
              <Loader2 className="mx-auto animate-spin text-coral" size={22} />
              <p className="mt-2 text-base font-semibold text-ink">Designing the role + assignment…</p>
              <p className="text-sm text-steel">Background task — leave any time.</p>
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
              failed, and hide the fact that a retry is a re-fetch, not a re-run. */}
          {viewed.status === "succeeded"
            ? "The analysis finished, but its result could not be loaded. Reopen it from the Tasks tab, or run the analysis again."
            : viewed.error ?? "Analysis did not complete."}
        </div>
      )}
    </section>
  );
}
