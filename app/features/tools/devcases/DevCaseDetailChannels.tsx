"use client";

// Distribution + intake for a case — each posting is an apply channel; the
// candidates they collect are ranked together in the shortlist above. Split out
// of DevCaseDetail.tsx.
import { ClipboardList } from "lucide-react";
import { ApplyTokenPill } from "./DevApplyTokenPill";
import { SubmissionForm } from "./DevSubmissionForm";
import type { Posting } from "./DevTypes";

export function DevCaseDetailChannels({ casePostings, onDone }: { casePostings: Posting[]; onDone: () => void }) {
  if (casePostings.length === 0) return null;
  return (
    <section>
      <h3 className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-steel">
        <ClipboardList size={13} className="text-coral" /> Apply channels
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
            <SubmissionForm postingId={p.id} onDone={onDone} />
          </div>
        ))}
      </div>
    </section>
  );
}
