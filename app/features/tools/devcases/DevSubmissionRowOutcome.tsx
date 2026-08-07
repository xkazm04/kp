"use client";

// Post-promote "review + record outcome" strip (Hired/Rejected/Withdrawn, plus the
// on-the-job performance picker), split out of DevSubmissionRow.tsx.
import Link from "next/link";
import { ArrowRight } from "lucide-react";

export function DevSubmissionRowOutcome({
  recorded,
  outcome,
  setOutcome,
  recordSubmissionOutcome,
}: {
  recorded: "hired" | "rejected" | "withdrawn" | null;
  outcome: { recorded: "hired" | "rejected" | "withdrawn" | null; pickingPerf: boolean; busy: boolean; error: string | null };
  setOutcome: React.Dispatch<
    React.SetStateAction<{ recorded: "hired" | "rejected" | "withdrawn" | null; pickingPerf: boolean; busy: boolean; error: string | null }>
  >;
  recordSubmissionOutcome: (kind: "hired" | "rejected" | "withdrawn", performance?: number) => void;
}) {
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-micro">
      {/* Promote files a pipeline entry + a Decisions review card — link to
          where the promoted candidate actually went instead of ending here. */}
      <Link
        href="/?tab=decisions"
        className="focus-ring inline-flex items-center gap-1 font-semibold text-coral hover:underline"
      >
        Review in Decisions <ArrowRight size={11} aria-hidden />
      </Link>
      {recorded ? (
        <span
          className={`rounded-full px-2 py-0.5 font-semibold uppercase ${
            recorded === "hired" ? "bg-moss/15 text-moss" : "bg-stone-100 text-steel"
          }`}
        >
          outcome: {recorded} ✓
        </span>
      ) : outcome.pickingPerf ? (
        <>
          <span className="uppercase tracking-wide text-steel">On-the-job perf</span>
          {[1, 2, 3, 4, 5].map((perf) => (
            <button
              key={perf}
              type="button"
              disabled={outcome.busy}
              onClick={() => void recordSubmissionOutcome("hired", perf)}
              className="focus-ring h-6 w-6 rounded border border-stone-200 bg-white font-semibold text-ink hover:border-moss/50 hover:bg-moss/5 disabled:opacity-50"
            >
              {perf}
            </button>
          ))}
          <button
            type="button"
            disabled={outcome.busy}
            onClick={() => void recordSubmissionOutcome("hired")}
            className="focus-ring rounded border border-stone-200 bg-white px-1.5 py-0.5 font-semibold text-steel hover:text-ink disabled:opacity-50"
          >
            skip — record hire only
          </button>
        </>
      ) : (
        <>
          <span className="uppercase tracking-wide text-steel" title="Feed the promote-floor calibration with what actually happened">
            Outcome
          </span>
          <button
            type="button"
            disabled={outcome.busy}
            onClick={() => setOutcome((o) => ({ ...o, pickingPerf: true, error: null }))}
            className="focus-ring rounded border border-moss/40 bg-white px-1.5 py-0.5 font-semibold text-moss hover:bg-moss/5 disabled:opacity-50"
          >
            Hired
          </button>
          <button
            type="button"
            disabled={outcome.busy}
            onClick={() => void recordSubmissionOutcome("rejected")}
            className="focus-ring rounded border border-stone-200 bg-white px-1.5 py-0.5 font-semibold text-coral hover:bg-coral/5 disabled:opacity-50"
          >
            Rejected
          </button>
          <button
            type="button"
            disabled={outcome.busy}
            onClick={() => void recordSubmissionOutcome("withdrawn")}
            className="focus-ring rounded border border-stone-200 bg-white px-1.5 py-0.5 font-semibold text-steel hover:text-ink disabled:opacity-50"
          >
            Withdrawn
          </button>
        </>
      )}
      {outcome.error ? (
        <span role="alert" className="text-red-700">
          {outcome.error}
        </span>
      ) : null}
    </div>
  );
}
