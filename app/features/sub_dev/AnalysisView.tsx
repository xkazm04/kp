"use client";

import { Boxes, Check, ClipboardList, GitBranch, Loader2, Lock, ShieldCheck } from "lucide-react";
import { formatPercent } from "@/app/_lib/format";
import { sourceLabel } from "./DevHelpers";
import { MiniList } from "./DevShared";
import { COMPLEXITY } from "./DevTypes";
import type { Design, NeedAnalysis, RepoSnapshot, Result } from "./DevTypes";
import type { Task } from "@/app/features/tasks/TasksProvider";

export function AnalysisView({
  viewed,
  running,
  result,
  analysis,
  snapshot,
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
  snapshot: RepoSnapshot | null;
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
        <div className="rounded-lg border border-dashed border-stone-200 p-8 text-center text-sm text-steel">
          Define a need and analyze it — the reality reflection appears here.
        </div>
      ) : running ? (
        <div className="rounded-lg border border-stone-200 bg-white p-8 text-center shadow-panel">
          <Loader2 className="mx-auto animate-spin text-coral" size={26} />
          <p className="mt-2 text-sm font-semibold text-ink">Pulling the codebase + reflecting…</p>
          <p className="text-xs text-steel">This runs as a background task — you can leave this tab.</p>
        </div>
      ) : result ? (
        <div className="space-y-4">
          <div className="rounded-lg border border-stone-200 bg-white p-4 shadow-panel">
            <div className="mb-2 flex items-center gap-2">
              <span className="text-meta uppercase tracking-wide text-steel">Reality reflection</span>
              {analysis.trueComplexity ? (
                <span className={`rounded-full px-2 py-0.5 text-micro font-semibold uppercase ${COMPLEXITY[analysis.trueComplexity] ?? "bg-stone-100 text-steel"}`}>
                  {analysis.trueComplexity} complexity
                </span>
              ) : null}
              <span className="ml-auto text-micro uppercase text-steel">
                {sourceLabel(result.source)} · conf {formatPercent(analysis.confidence ?? 0, { fraction: true })}
              </span>
            </div>
            <p className="text-sm text-ink">{analysis.reflection}</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {(analysis.realStack ?? []).map((s) => (
                <span key={s} className="rounded-full bg-paper px-2 py-0.5 text-micro text-ink">{s}</span>
              ))}
            </div>
            {(analysis.statedVsRealGaps ?? []).length > 0 ? (
              <div className="mt-3">
                <p className="text-micro font-semibold uppercase tracking-wide text-coral">Stated vs. real gaps</p>
                <ul className="mt-1 space-y-0.5">
                  {(analysis.statedVsRealGaps ?? []).map((g, i) => (
                    <li key={i} className="flex gap-1.5 text-xs text-ink"><span className="text-coral">•</span>{g}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {(analysis.riskAreas ?? []).length > 0 ? (
              <p className="mt-2 text-micro text-steel">Risk areas: {(analysis.riskAreas ?? []).join(" · ")}</p>
            ) : null}
          </div>

          {snapshot ? (
            <div className="rounded-lg border border-stone-200 bg-white p-4 shadow-panel">
              <div className="mb-2 flex items-center gap-1.5">
                <Boxes size={14} className="text-steel" />
                <span className="text-meta uppercase tracking-wide text-steel">Codebase snapshot</span>
                <span className="ml-auto text-micro text-steel">~{(snapshot.loc ?? 0).toLocaleString()} LOC</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(snapshot.languages ?? {}).slice(0, 6).map(([k, v]) => (
                  <span key={k} className="rounded-md border border-stone-200 px-2 py-0.5 text-micro text-ink">
                    {k} <span className="text-steel">{formatPercent(v, { fraction: true })}</span>
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
          ) : (
            <p className="rounded-md border border-dashed border-stone-200 p-3 text-xs text-steel">
              No codebase snapshot — analysis is ungrounded. Add a public GitHub URL to ground it in reality.
            </p>
          )}

          {/* D3 — artifact design + human gate */}
          {!design && !designing ? (
            <button type="button" onClick={startDesign}
              className="focus-ring inline-flex h-10 items-center gap-1.5 rounded-md border border-coral/40 bg-coral/5 px-3 text-sm font-semibold text-coral hover:bg-coral/10">
              <ClipboardList size={15} /> Design role &amp; assignment
            </button>
          ) : null}
          {designing ? (
            <div className="rounded-lg border border-stone-200 bg-white p-6 text-center shadow-panel">
              <Loader2 className="mx-auto animate-spin text-coral" size={22} />
              <p className="mt-2 text-sm font-semibold text-ink">Designing the role + assignment…</p>
              <p className="text-xs text-steel">Background task — leave any time.</p>
            </div>
          ) : null}
          {design ? (
            <div className="space-y-4">
              <div className="rounded-lg border border-stone-200 bg-white p-4 shadow-panel">
                <div className="mb-2 flex items-center gap-2">
                  <span className="text-meta uppercase tracking-wide text-steel">Role</span>
                  <span className="ml-auto text-micro uppercase text-steel">{sourceLabel(design.source)}</span>
                </div>
                <p className="font-serif text-h3 text-ink">{design.role?.title}</p>
                <p className="text-xs uppercase text-steel">{design.role?.seniority}</p>
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  <MiniList title="Must-haves" items={design.role?.mustHaves ?? []} />
                  <MiniList title="Responsibilities" items={design.role?.responsibilities ?? []} />
                </div>
              </div>

              <div className="rounded-lg border border-stone-200 bg-white p-4 shadow-panel">
                <div className="mb-2 flex items-center gap-2">
                  <ClipboardList size={14} className="text-steel" />
                  <span className="text-meta uppercase tracking-wide text-steel">Assignment</span>
                  <span className="ml-auto text-micro text-steel">~{design.case?.timeboxHours ?? 4}h</span>
                </div>
                <p className="font-semibold text-ink">{design.case?.title}</p>
                <p className="mt-1 text-sm text-ink">{design.case?.brief}</p>
                {(design.case?.tasks ?? []).length ? (
                  <ol className="mt-2 list-decimal space-y-0.5 pl-4 text-xs text-ink">
                    {(design.case?.tasks ?? []).map((t, i) => <li key={i}>{t}</li>)}
                  </ol>
                ) : null}

                {(design.case?.coverProbes ?? []).length ? (
                  <div className="mt-3 rounded-md border border-amber-200 bg-amber-50/60 p-2.5">
                    <p className="flex items-center gap-1 text-micro font-semibold uppercase tracking-wide text-amber-700">
                      <Lock size={11} /> Covert probes — internal, hidden from the candidate
                    </p>
                    <ul className="mt-1 space-y-1">
                      {(design.case?.coverProbes ?? []).map((p, i) => (
                        <li key={i} className="text-micro text-ink">
                          <span className="rounded bg-amber-100 px-1 py-0.5 text-micro font-semibold uppercase text-amber-700">{p.kind}</span>{" "}
                          <span className="text-steel">@ {p.where}</span> — {p.reveals}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {(design.case?.rubricDimensions ?? []).length ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {(design.case?.rubricDimensions ?? []).map((d) => (
                      <span key={d.name} className="rounded-full bg-paper px-2 py-0.5 text-micro text-ink">
                        {d.name} <span className="text-steel">{formatPercent(d.weight ?? 0, { fraction: true })}</span>
                      </span>
                    ))}
                  </div>
                ) : null}

                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-stone-100 pt-3">
                  {approvedId ? (
                    <span className="inline-flex items-center gap-1 text-sm font-semibold text-moss"><Check size={16} /> Approved</span>
                  ) : (
                    <button type="button" onClick={approve} disabled={approving}
                      className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-md bg-moss px-3 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
                      <ShieldCheck size={15} /> {approving ? "Approving…" : "Approve assignment"}
                    </button>
                  )}
                  <span className="text-micro text-steel">Human gate — review the probes, then approve to save it.</span>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="rounded-lg border border-stone-200 bg-red-50 p-4 text-sm text-red-700">
          {viewed.error ?? "Analysis did not complete."}
        </div>
      )}
    </section>
  );
}
