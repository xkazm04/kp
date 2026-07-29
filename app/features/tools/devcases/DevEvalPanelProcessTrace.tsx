"use client";

// Process trace (DECISIONS log + commit cadence) and seed-engagement strips,
// split out of DevEvalPanel.tsx.
import type { EvalBundle } from "./DevTypes";

export function DevEvalPanelProcessTrace({ ev }: { ev: EvalBundle }) {
  return (
    <>
      {/* process trace (DEVP6) — persisted "so the decisions-log contract is checkable
          later instead of taken on faith"; this strip is where it finally is. Keeping
          the DECISIONS log is a mandated task of the case (coral when skipped); cadence
          is a how-they-worked signal, deliberately framed neutrally, not as a verdict. */}
      {ev.processTrace ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-micro">
          <span
            className={`rounded px-1.5 py-0.5 font-semibold uppercase ${
              ev.processTrace.decisionsLogPresent ? "bg-moss/10 text-moss" : "bg-coral/15 text-coral"
            }`}
          >
            DECISIONS log: {ev.processTrace.decisionsLogPresent ? "kept" : "missing"}
          </span>
          {ev.processTrace.cadence?.spanHours != null ? (
            <span className="text-steel">
              {ev.processTrace.commitCount ?? ev.commitCount ?? 0} commits over{" "}
              {Math.round(ev.processTrace.cadence.spanHours * 10) / 10} h
            </span>
          ) : null}
          {ev.processTrace.cadence?.bursty === true ? (
            <span className="rounded bg-paper px-1.5 py-0.5 text-steel" title="Commits landed in one tight burst — how they worked, not a verdict">
              single sitting
            </span>
          ) : null}
        </div>
      ) : null}

      {/* c364a44d — seed engagement: which planted seam files the submission
          actually touched. Grounded, mechanically-comparable evidence (every
          candidate starts from the same seed) beside the LLM's probe read — an
          untouched seam file is a seam they never opened. */}
      {ev.seedDiff && ev.seedDiff.total > 0 ? (
        <div className="mt-1.5 text-micro">
          <span
            className={`rounded px-1.5 py-0.5 font-semibold uppercase ${
              ev.seedDiff.touched === 0 ? "bg-coral/15 text-coral" : "bg-paper text-steel"
            }`}
            title="Files from the shared starter seed the submission modified — the seed plants each probe's seam, so an untouched file is a seam they never engaged."
          >
            Seed engagement: {ev.seedDiff.touched}/{ev.seedDiff.total} planted files touched
          </span>
          {ev.seedDiff.untouched.length > 0 ? (
            <span className="ml-1.5 text-steel">untouched: {ev.seedDiff.untouched.join(", ")}</span>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
