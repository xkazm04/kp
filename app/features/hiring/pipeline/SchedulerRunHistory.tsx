"use client";

// AUTO2 — the scheduler's run-history dropdown: what each pass did and WHY, per
// candidate. Split out of SchedulerControl.tsx.

import type { SchedulerTranslator } from "./pipelineTranslator";
import { XCircle } from "lucide-react";
import { deriveDecisionOutcome } from "@/app/_lib/decision-attribution";
import { OutcomeChip, SummaryBadges, type SchedulerRun } from "./SchedulerSummaryBadges";

export function SchedulerRunHistory({
  t,
  runs,
  relativeTime,
  labelFor,
}: {
  t: SchedulerTranslator;
  runs: SchedulerRun[];
  relativeTime: (iso: string) => string;
  labelFor?: (entryId: string) => string | undefined;
}) {
  if (runs.length === 0) return null;
  return (
    <div className="mt-1.5 rounded-md border border-stone-200 bg-white p-2 text-sm text-steel">
      <ol className="space-y-1">
        {runs.map((run) => {
          const decisions = Array.isArray(run.decisions) ? run.decisions : [];
          // "none" rows are CAS skips — near-misses the guard prevented. The
          // audit history must show them, not drop them (the old filter made a
          // prevented action indistinguishable from one that never existed).
          const acted = decisions.filter((d) => d.action && (d.action !== "none" || deriveDecisionOutcome(d) === "skipped"));
          return (
            <li key={run.id} className="rounded border border-stone-100 bg-paper/40 px-2 py-1">
              <details>
                <summary className="focus-ring flex cursor-pointer flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-medium text-ink">{relativeTime(run.startedAt)}</span>
                  <span className="rounded-full bg-stone-100 px-1.5 py-0.5 text-xs font-semibold uppercase">
                    {/* The trigger name is a runtime value from the run record, so the
                        key is composed rather than literal — cast it to the translator's
                        own key type (the `Parameters<typeof t>[0]` idiom used across the
                        app for code-keyed catalogs). has() still guards the lookup. */}
                    {(() => {
                      const key = `trigger.${run.trigger}` as Parameters<typeof t>[0];
                      return t.has(key) ? t(key) : run.trigger;
                    })()}
                  </span>
                  {run.status === "error" ? (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-coral">
                      <XCircle size={12} aria-hidden /> {run.error ?? t("runFailed")}
                    </span>
                  ) : (
                    <span className="inline-flex flex-wrap items-center gap-1">
                      {run.summary ? <SummaryBadges summary={run.summary} /> : null}
                      {run.summary?.evaluated != null ? (
                        <span className="text-xs">{t("runEvaluated", { n: run.summary.evaluated })}</span>
                      ) : null}
                    </span>
                  )}
                </summary>
                {acted.length > 0 ? (
                  <ul className="mt-1 space-y-0.5 border-t border-stone-100 pt-1">
                    {acted.map((d, i) => {
                      const outcome = deriveDecisionOutcome(d);
                      return (
                        <li key={`${d.entryId}-${i}`} className="text-xs">
                          {d.action !== "none" ? (
                            <span
                              className={`mr-1 rounded px-1 py-0.5 font-semibold uppercase ${
                                d.action === "reject"
                                  ? "bg-coral/10 text-coral"
                                  : d.action === "advance"
                                    ? "bg-moss/10 text-moss"
                                    : "bg-stone-100 text-steel"
                              }`}
                            >
                              {d.action}
                            </span>
                          ) : null}
                          {/* The outcome chip separates "landed" from failed /
                              CAS-skipped / fairness-refused — the rows an
                              auditor actually cares about. */}
                          {outcome !== "applied" ? <OutcomeChip outcome={outcome} /> : null}
                          <span className="font-medium text-ink">
                            {(d.entryId && labelFor?.(d.entryId)) ?? d.entryId ?? "—"}
                          </span>{" "}
                          <span className="text-steel">— {d.reason}</span>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="mt-1 border-t border-stone-100 pt-1 text-xs">{t("runNoActions")}</p>
                )}
              </details>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
