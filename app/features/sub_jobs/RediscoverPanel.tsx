"use client";

import { Check, History, RotateCcw, Send, UserPlus } from "lucide-react";
import { useJsonFetch } from "@/app/_lib/useJsonFetch";
import { useAddToPipeline } from "@/app/_lib/useAddToPipeline";
import { useReachOut } from "@/app/_lib/useReachOut";
import { ScoreBadge } from "@/app/_components/ScoreBadge";
import { EmptyState, SkippedCandidatesNote } from "./JobsShared";
import type { SkippedCandidate } from "./JobsTypes";

type Rediscovered = {
  candidateId: string;
  label: string;
  archetype: string;
  score: number;
  prior: { kind: "rejected" | "closed" | "elsewhere"; label: string };
};

const PRIOR_STYLE: Record<string, string> = {
  rejected: "bg-coral/10 text-coral",
  closed: "bg-dial-amber/20 text-ink",
  elsewhere: "bg-steel/10 text-steel",
};

export function RediscoverPanel({ jobId, jobTitle }: { jobId: string; jobTitle: string }) {
  const { data: body, error } = useJsonFetch<{ rediscovered?: Rediscovered[]; skipped?: SkippedCandidate[] }>(
    `/api/jobs/${encodeURIComponent(jobId)}/rediscover`,
    "Couldn't run rediscovery."
  );
  const data = body ? body.rediscovered ?? [] : null;
  const skipped = body?.skipped ?? [];
  const { add, added, adding, error: addError, announce } = useAddToPipeline(jobId, jobTitle);
  const { reach, reached, reaching, error: reachError, announce: reachAnnounce } = useReachOut(jobId);

  if (error) return <p className="text-base text-coral">{error}</p>;
  if (!data) return <p className="text-base text-steel">Scanning past candidates for a fit…</p>;
  // The skipped note rides above the results regardless of whether any candidate
  // resurfaced — a malformed profile may be exactly why the list looks empty.
  if (data.length === 0) {
    return (
      <div>
        <SkippedCandidatesNote skipped={skipped} />
        <EmptyState
          icon={History}
          title="No past candidates resurface yet"
          body="As people are rejected or hired elsewhere, strong cross-role fits will appear here."
        />
      </div>
    );
  }

  return (
    <div>
      <p role="status" aria-live="polite" className="sr-only">
        {[announce, reachAnnounce].filter(Boolean).join(" ")}
      </p>
      <SkippedCandidatesNote skipped={skipped} />
      <p className="text-base text-steel">
        Past candidates who clear the bar for <span className="font-medium text-ink">{jobTitle}</span> but aren&apos;t in
        its pipeline — worth a second look.
      </p>
      <ul className="mt-3 space-y-2">
        {data.map((c) => {
          const err = addError(c.candidateId);
          const reachErr = reachError(c.candidateId);
          const input = { candidateId: c.candidateId, candidateLabel: c.label, archetype: c.archetype, matchScore: c.score };
          return (
            <li key={c.candidateId} className="flex items-center gap-3 rounded-md border border-stone-200 bg-white px-3 py-2">
              <span className="shrink-0"><ScoreBadge score={c.score} /></span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-base font-medium text-ink">{c.label}</p>
                <span className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-meta ${PRIOR_STYLE[c.prior.kind]}`}>
                  {c.prior.label}
                </span>
              </div>
              {reached(c.candidateId) ? (
                // Reaching out also pipelines them, so a reached candidate is a
                // single badge — no redundant add button.
                <span className="inline-flex items-center gap-1 text-sm font-semibold text-moss">
                  <Check size={14} /> Reached out
                </span>
              ) : (
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => reach(input)}
                      disabled={reaching(c.candidateId)}
                      title={reachErr ?? "Add to the pipeline and send a first-touch message"}
                      className={`focus-ring inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm font-semibold disabled:opacity-50 ${
                        reachErr ? "border-coral/60 bg-coral/10 text-coral" : "border-coral/40 bg-coral/5 text-coral hover:bg-coral/10"
                      }`}
                    >
                      {reachErr ? <RotateCcw size={14} /> : <Send size={14} />}{" "}
                      {reaching(c.candidateId) ? "Reaching…" : reachErr ? "Try again" : "Reach out"}
                    </button>
                    {added(c.candidateId) ? (
                      <span className="inline-flex items-center gap-1 text-sm font-semibold text-moss">
                        <Check size={14} /> Added
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => add(input)}
                        disabled={adding(c.candidateId)}
                        title={err ?? undefined}
                        className={`focus-ring inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm font-semibold disabled:opacity-50 ${
                          err
                            ? "border-coral/50 bg-coral/5 text-coral hover:border-coral/70"
                            : "border-stone-200 text-ink hover:border-coral/40"
                        }`}
                      >
                        {err ? <RotateCcw size={14} className="text-coral" /> : <UserPlus size={14} className="text-coral" />}{" "}
                        {adding(c.candidateId) ? "Adding…" : err ? "Try again" : "Add to pipeline"}
                      </button>
                    )}
                  </div>
                  {err ? (
                    <span className="max-w-[12rem] text-right text-meta text-coral">Couldn&apos;t add — {err}</span>
                  ) : null}
                  {reachErr ? (
                    <span className="max-w-[12rem] text-right text-meta text-coral">Couldn&apos;t reach out — {reachErr}</span>
                  ) : null}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
