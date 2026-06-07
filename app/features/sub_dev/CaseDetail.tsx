"use client";

import { Fragment } from "react";
import { ArrowLeft, ClipboardList, Lock, MicVocal, Send, Users } from "lucide-react";
import { Markdown } from "@/app/_components/Markdown";
import { formatFraction, formatRelativeTime } from "@/app/_lib/format";
import { ApplyTokenPill } from "./ApplyTokenPill";
import { caseToMarkdown } from "./DevHelpers";
import { MiniList } from "./DevShared";
import { SubmissionForm } from "./SubmissionForm";
import { SubmissionRow } from "./SubmissionRow";
import type { DevCaseDetail, Posting } from "./DevTypes";

/** The readable case document: the candidate-facing assignment rendered as
 *  formatted Markdown (caseToMarkdown — probes can never leak into it), followed
 *  by clearly-marked INTERNAL panels (probes + decision spaces, rubric, role
 *  spec) and this case's postings/submissions with their evaluations. */
export function CaseDetail({
  kase,
  postings,
  onBack,
  publish,
  source,
  sourcing,
  sourcedCounts,
  loadPostings,
}: {
  kase: DevCaseDetail;
  postings: Posting[];
  onBack: () => void;
  publish: (caseId: string) => void;
  source: (caseId: string) => void;
  sourcing: string | null;
  sourcedCounts: Record<string, number>;
  loadPostings: () => void;
}) {
  const c = kase.case ?? {};
  const role = kase.role ?? null;
  const casePostings = postings.filter((p) => p.caseId === kase.id);
  const published = casePostings.length > 0;
  const hasScenario = Array.isArray(kase.scenario?.phases) && (kase.scenario?.phases?.length ?? 0) > 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-sm font-semibold text-steel hover:bg-paper hover:text-ink"
        >
          <ArrowLeft size={14} /> All cases
        </button>
        <span className="text-micro text-steel">created {formatRelativeTime(kase.createdAt) || "—"}</span>
        {hasScenario ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-moss/15 px-2 py-0.5 text-micro font-semibold uppercase text-moss">
            <MicVocal size={11} /> interview scenario ready
          </span>
        ) : null}
        <div className="ml-auto flex gap-1.5">
          <button
            type="button"
            onClick={() => publish(kase.id)}
            disabled={published}
            className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-md border border-stone-200 bg-white px-2.5 text-micro font-semibold text-ink hover:border-coral/40 disabled:opacity-50"
          >
            <Send size={12} /> {published ? "Published" : "Publish"}
          </button>
          <button
            type="button"
            onClick={() => source(kase.id)}
            disabled={sourcing === kase.id}
            title="Rank the existing candidate DB against this role and seed the pipeline"
            className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-md border border-stone-200 bg-white px-2.5 text-micro font-semibold text-coral hover:border-coral/40 disabled:opacity-50"
          >
            <Users size={12} /> {sourcing === kase.id ? "Sourcing…" : sourcedCounts[kase.id] != null ? `Sourced ${sourcedCounts[kase.id]}` : "Source DB"}
          </button>
        </div>
      </div>

      {/* the assignment, as the candidate would read it */}
      <article className="rounded-lg border border-stone-200 bg-white px-6 py-5 shadow-panel sm:px-8 sm:py-6">
        <Markdown content={caseToMarkdown(c, role)} className="max-w-3xl" />
      </article>

      {/* internal material — everything a candidate must never see */}
      <section className="rounded-lg border border-amber-200 bg-amber-50/40 p-4">
        <h3 className="flex items-center gap-1.5 text-meta font-semibold uppercase tracking-wide text-amber-700">
          <Lock size={12} /> Internal — interviewer &amp; reviewer material
        </h3>

        {(c.coverProbes ?? []).length ? (
          <ul className="mt-2 space-y-2">
            {(c.coverProbes ?? []).map((p, i) => (
              <li key={p.id ?? i} className="rounded-md border border-amber-200/70 bg-white/70 p-2.5">
                <p className="text-micro text-ink">
                  <span className="rounded bg-amber-100 px-1 py-0.5 text-micro font-semibold uppercase text-amber-700">
                    {(p.kind ?? "probe").replace(/_/g, " ")}
                  </span>{" "}
                  <span className="text-steel">@ {p.where}</span> — {p.reveals}
                </p>
                {(p.decisionSpace ?? []).length ? (
                  <ul className="mt-1.5 space-y-0.5 border-l-2 border-amber-200 pl-2">
                    {(p.decisionSpace ?? []).map((opt, j) => (
                      <li key={j} className="text-micro text-steel">
                        <span className="font-semibold text-amber-700">{String.fromCharCode(65 + j)}.</span> {opt}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-micro text-steel">No covert probes recorded on this case.</p>
        )}

        {(c.rubricDimensions ?? []).length ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {(c.rubricDimensions ?? []).map((d) => (
              <span key={d.name} title={d.description} className="rounded-full bg-white px-2 py-0.5 text-micro text-ink ring-1 ring-amber-200/70">
                {d.label ?? d.name} <span className="text-steel">{formatFraction(d.weight ?? 0, { label: "rubric weight" })}</span>
              </span>
            ))}
          </div>
        ) : null}

        {role ? (
          <div className="mt-3 grid gap-3 border-t border-amber-200/60 pt-3 sm:grid-cols-2">
            <MiniList title="Role must-haves" items={role.mustHaves ?? []} />
            <MiniList title="Role responsibilities" items={role.responsibilities ?? []} />
          </div>
        ) : null}
      </section>

      {/* distribution + intake for THIS case */}
      {casePostings.length > 0 ? (
        <section>
          <h3 className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-steel">
            <ClipboardList size={13} className="text-coral" /> Postings &amp; submissions
            <span className="text-coral">· {casePostings.length}</span>
          </h3>
          <div className="mt-2 grid gap-3 lg:grid-cols-2">
            {casePostings.map((p) => (
              <div key={p.id} className="rounded-lg border border-stone-200 bg-white p-3 shadow-panel">
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-paper px-2 py-0.5 text-micro font-semibold uppercase text-steel">{p.channel}</span>
                  <span className="min-w-0 flex-1 truncate text-base font-semibold text-ink">{p.caseTitle || p.roleTitle || "Posting"}</span>
                  <span className="text-micro text-steel">{p.submissions?.length ?? p.submissionCount ?? 0} in</span>
                </div>
                <div className="mt-1 flex items-center gap-1.5">
                  <span className="shrink-0 text-micro uppercase tracking-wide text-steel">Apply link</span>
                  <ApplyTokenPill token={p.token} />
                </div>

                {(p.submissions ?? []).length > 0 ? (
                  <ul className="mt-2 space-y-1.5 border-t border-stone-100 pt-2">
                    {[...(p.submissions ?? [])]
                      .sort((a, b) => (b.transferScore ?? -1) - (a.transferScore ?? -1))
                      .map((s, i, arr) => {
                        const rank = s.transferScore != null ? i + 1 : null;
                        const isTop = rank === 1;
                        return (
                          <Fragment key={s.id}>
                            <SubmissionRow submission={s} rank={rank} isTop={isTop} onChanged={loadPostings} />
                            {isTop && arr.length > 1 ? <li aria-hidden className="border-t border-dashed border-stone-200" /> : null}
                          </Fragment>
                        );
                      })}
                  </ul>
                ) : null}

                <SubmissionForm postingId={p.id} onDone={loadPostings} />
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
