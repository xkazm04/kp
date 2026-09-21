"use client";

import { AlertTriangle, Clock } from "lucide-react";
import { useTranslations } from "next-intl";
import { useDeliveryCapability } from "@/app/features/shell/useDeliveryCapability";
import { useEngineAvailability } from "@/app/features/shell/useEngineAvailability";
import { useRelativeTime } from "./PipelineShared";
import { useSchedulerControlState } from "./useSchedulerControlState";
import { SchedulerToolbar } from "./SchedulerToolbar";
import { SchedulerRunHistory } from "./SchedulerRunHistory";
import { SchedulerJobRow, jobRowCopy, type JobRowCopy } from "./SchedulerJobRow";
import type { SchedulerJobView, SchedulerRun } from "./SchedulerSummaryBadges";
import type { SchedulerTranslator } from "./pipelineTranslator";

// Direction #5 — control + status for the automation clock (the durable
// scheduler that runs the Task-7 policy pass on a cadence). Disabled by default.
//
// WP4a — the panel iterates the job REGISTRY the route ships as `jobs[]`
// (scheduler-jobs.ts): the policy pass keeps its toolbar (the "Run now" door, the
// engine notice, the decision history), and every other registered job renders one
// generic SchedulerJobRow. Registering a fourth job adds a row here with no edit.
export function SchedulerControl({
  onRan,
  className = "",
  labelFor,
}: {
  onRan?: () => void;
  className?: string;
  /** AUTO2 — resolve a decision row's entryId to a candidate label (the board
   *  already holds the entries); falls back to the raw id when absent. */
  labelFor?: (entryId: string) => string | undefined;
}) {
  const t = useTranslations("pipeline.scheduler");
  const relativeTime = useRelativeTime();
  // DATA4 — flag the silent-fallback mode (no Claude CLI on PATH) at the
  // surface that triggers the automation.
  const engines = useEngineAvailability();
  // REC-10 — "{n} sent" for reminder sweeps only reads as delivered when a
  // relay exists; without one those sends are terminal outbox rows.
  const relayConfigured = useDeliveryCapability();
  const st = useSchedulerControlState(t, onRan);

  if (!st.sched) {
    // First load failed — show the bar with an error instead of vanishing.
    if (!st.error) return null;
    return (
      <div className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md border border-stone-200 bg-paper/60 px-3 py-2 text-sm text-steel ${className}`}>
        <span className="flex items-center gap-1.5 font-medium text-ink">
          <Clock size={14} className="text-coral" /> {t("clock")}
        </span>
        <span role="status" className="inline-flex items-center gap-1 font-medium text-coral">
          <AlertTriangle size={14} className="shrink-0" /> {st.error}
        </span>
      </div>
    );
  }

  return (
    <div className={className}>
      <SchedulerToolbar
        t={t}
        engines={engines}
        sched={st.sched}
        busy={st.busy}
        onToggleEnabled={() => st.update({ enabled: !st.sched!.enabled })}
        scheduleScope={st.scheduleScope}
        intervalDraft={st.intervalDraft}
        onIntervalChange={st.setIntervalDraft}
        onIntervalFocus={() => st.setIntervalFocused(true)}
        onIntervalBlur={(value) => {
          st.setIntervalFocused(false);
          st.commitInterval(value);
        }}
        relativeTime={relativeTime}
        onRunNow={() => st.update({ tick: true })}
        runsCount={st.runs.length}
        historyOpen={st.historyOpen}
        onToggleHistory={() => st.setHistoryOpen((o) => !o)}
        result={st.result}
        error={st.error}
        liveness={st.liveness}
        livenessReason={st.livenessReason}
      />

      {/* AUTO2 — run history: what each pass did and WHY, per candidate. The
          decision rows were computed by every pass and discarded; now they're
          persisted with the run and answerable here days later. */}
      {st.historyOpen ? (
        <SchedulerRunHistory t={t} runs={st.runs} relativeTime={relativeTime} labelFor={labelFor} />
      ) : null}

      {/* WP4a — one generic row per registered job other than the policy pass, in
          registry order. The reminders job (AUTO6 — the most candidate-visible
          automation) keeps its historical copy; a job that must be verified by a
          manual run first renders its toggle disabled until one succeeded. */}
      {st.jobs
        .filter((job) => job.name !== "policy_pass")
        .map((job) => (
          <SchedulerJobRow
            key={job.name}
            t={t}
            job={job}
            copy={rowCopyFor(t, job, relayConfigured)}
            relativeTime={relativeTime}
            busy={st.busy}
            onToggle={() => st.setJob(job.name, { enabled: !job.schedule.enabled })}
            onInterval={(minutes) => st.setJob(job.name, { intervalMinutes: minutes })}
          />
        ))}
    </div>
  );
}

// The reminders row's strings predate the registry and are the ones operators know
// ("checked 2m ago", "{n} sent", "{n} queued in Outbox … (not delivered)"); they
// override the generic defaults for that one job. Every other job reads the generic set.
function rowCopyFor(t: SchedulerTranslator, job: SchedulerJobView, relayConfigured: boolean | null): JobRowCopy {
  const generic = jobRowCopy(t, job);
  if (job.name !== "reminders") return generic;
  return {
    ...generic,
    toggleTitle: t("remindersToggleTitle"),
    on: t("remindersOn"),
    off: t("remindersOff"),
    checked: (time) => t("remindersChecked", { time }),
    never: t("remindersNever"),
    lastOk: (run: SchedulerRun, time) =>
      t(relayConfigured === false ? "remindersLastQueued" : "remindersLastSent", {
        n: Number((run.summary as { sent?: number } | null)?.sent ?? 0),
        time,
      }),
  };
}
