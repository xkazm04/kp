"use client";

// WP4a — ONE generic row per registered scheduler job (scheduler-jobs.ts) other than
// the policy pass, which keeps its own toolbar (the "Run now" door, the engine
// notice). The row shows the job is alive (last check time), whether it is on, its
// cadence (editable), what its latest run did, and a collapsible history. It
// replaced SchedulerRemindersRow: the reminders job now renders through this with
// its historical copy handed in as `copy`, so it shows every string it showed before.
//
// A job that must be proven by hand first (`requiresVerifiedRun && !verified`)
// renders its toggle disabled with `unverified` as the title — the route refuses the
// same write with JOBSEEKER_SCAN_UNVERIFIED, so the disabled control is a courtesy
// that says WHY, not the gate itself.

import type { SchedulerTranslator } from "./pipelineTranslator";
import { useState } from "react";
import { BellRing, History, Radar, Timer, XCircle } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { isCurrentRunError } from "@/app/_lib/scheduler-health";
import type { SchedulerJobName } from "@/app/_lib/scheduler-jobs";
import { FIELD } from "@/app/_components/ui/recipes";
import type { SchedulerJobView, SchedulerRun } from "./SchedulerSummaryBadges";
import { INTERVAL_MAX_MINUTES, INTERVAL_MIN_MINUTES, clampInterval } from "./schedulerRunState";

// Presentation per job — the icon only. Copy comes from the catalog, behaviour from
// the registry; a job with no entry here gets the neutral timer glyph.
const JOB_ICON: Partial<Record<SchedulerJobName, LucideIcon>> = {
  reminders: BellRing,
  jobseeker_scan: Radar,
};

/** The strings a row renders. Every field has a generic default (`jobRowCopy`);
 *  a job with historical copy of its own (reminders) overrides the ones it owns. */
export type JobRowCopy = {
  label: string;
  toggleTitle: string;
  on: string;
  off: string;
  /** "checked {time}" — the job's last claim, alive or not. */
  checked: (time: string) => string;
  never: string;
  /** The latest SUCCESSFUL run in one line, or null to show nothing for it. */
  lastOk: (run: SchedulerRun, time: string) => string | null;
  intervalAria: string;
};

/** Generic copy for a registry job, from `pipeline.scheduler.job.<labelKey>` and the
 *  `job*` keys. The label falls back to the wire name when a catalog lacks the key,
 *  so a newly registered job is never an empty chip. */
export function jobRowCopy(t: SchedulerTranslator, job: SchedulerJobView): JobRowCopy {
  const labelKey = `job.${job.labelKey}` as Parameters<typeof t>[0];
  const label = t.has(labelKey) ? t(labelKey) : job.name;
  return {
    label,
    toggleTitle: t("jobToggleTitle", { job: label }),
    on: t("jobOn"),
    off: t("jobOff"),
    checked: (time) => t("jobChecked", { time }),
    never: t("jobNever"),
    lastOk: (_run, time) => t("jobLastOk", { time }),
    intervalAria: t("jobIntervalAria", { job: label }),
  };
}

export function SchedulerJobRow({
  t,
  job,
  copy,
  relativeTime,
  busy,
  onToggle,
  onInterval,
}: {
  t: SchedulerTranslator;
  job: SchedulerJobView;
  copy: JobRowCopy;
  relativeTime: (iso: string) => string;
  busy: boolean;
  onToggle: () => void;
  onInterval: (minutes: number) => void;
}) {
  const Icon = JOB_ICON[job.name] ?? Timer;
  const { schedule, runs } = job;
  const locked = job.requiresVerifiedRun && !job.verified;
  const latest = runs[0];
  // Draft string for the cadence field so the operator can clear/retype freely;
  // mirrored from the stored value whenever it changes and the field is not focused
  // (the same guarded render-phase pattern the policy-pass toolbar uses).
  const [draft, setDraft] = useState(String(schedule.intervalMinutes));
  const [mirrored, setMirrored] = useState(schedule.intervalMinutes);
  const [focused, setFocused] = useState(false);
  if (schedule.intervalMinutes !== mirrored && !focused) {
    setMirrored(schedule.intervalMinutes);
    setDraft(String(schedule.intervalMinutes));
  }
  const commit = (raw: string) => {
    const clamped = clampInterval(raw, schedule.intervalMinutes);
    setDraft(String(clamped));
    if (clamped !== schedule.intervalMinutes) onInterval(clamped);
  };
  return (
    <div className="mt-1.5 rounded-md border border-stone-200 bg-paper/40 px-3 py-1.5 text-sm text-steel">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="flex items-center gap-1.5 font-medium text-ink">
          <Icon size={13} className="text-coral" aria-hidden /> {copy.label}
        </span>
        <button
          type="button"
          onClick={onToggle}
          disabled={busy || locked}
          aria-pressed={schedule.enabled}
          className={`focus-ring inline-flex h-6 items-center rounded-full px-2.5 text-sm font-semibold disabled:opacity-60 ${
            schedule.enabled ? "bg-moss/15 text-moss" : "bg-stone-200 text-steel"
          }`}
          title={locked ? t("unverified") : copy.toggleTitle}
        >
          {schedule.enabled ? copy.on : copy.off}
        </button>
        <label className="flex items-center gap-1">
          {t("every")}
          <input
            type="number"
            min={INTERVAL_MIN_MINUTES}
            max={INTERVAL_MAX_MINUTES}
            value={draft}
            disabled={busy}
            aria-label={copy.intervalAria}
            onChange={(e) => setDraft(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={(e) => {
              setFocused(false);
              commit(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            className={`focus-ring ${FIELD} w-16 px-1 py-0.5 text-center text-sm nums`}
          />
          {t("min")}
        </label>
        <span>{schedule.lastRunAt ? copy.checked(relativeTime(schedule.lastRunAt)) : copy.never}</span>
        {/* OO-L2-15 — an error row renders as a live problem ONLY while it is
            current: recent (24h TTL) and not superseded by a later check
            (zero-send sweeps record no rows, so the newest ROW can be weeks old
            while last_run_at proves the job healthy). Current errors carry
            their timestamp so "failing" is never confused with "failed once,
            back in June". Historic errors fall through to the last-success line
            (or nothing) instead of masquerading as today's status. */}
        {latest ? (
          isCurrentRunError(latest, { lastRunAt: schedule.lastRunAt }) ? (
            <span className="inline-flex items-center gap-1 text-sm font-semibold text-coral">
              {/* The persisted run error is a raw server exception with no machine
                  code to resolve, so the SENTENCE is localized and the detail rides
                  inside it (same shape as the tick chip in useSchedulerControlState)
                  rather than replacing the localized text with English. */}
              <XCircle size={12} aria-hidden />{" "}
              {latest.error ? t("runFailedMsg", { msg: latest.error }) : t("runFailed")}
              <span className="font-normal text-steel">· {relativeTime(latest.startedAt)}</span>
            </span>
          ) : latest.status === "skipped" ? (
            <span className="text-sm">{t("jobLastSkipped", { time: relativeTime(latest.startedAt) })}</span>
          ) : latest.status !== "error" ? (
            (() => {
              const line = copy.lastOk(latest, relativeTime(latest.startedAt));
              return line ? <span className="text-sm">{line}</span> : null;
            })()
          ) : null
        ) : null}
        {runs.length > 0 ? (
          <details className="ml-auto">
            <summary className="focus-ring inline-flex cursor-pointer items-center gap-1 rounded-full px-2 py-0.5 text-sm font-medium text-steel" title={t("jobHistoryTitle", { job: copy.label })}>
              <History size={12} aria-hidden /> {t("history", { count: runs.length })}
            </summary>
            <ol className="mt-1 w-full space-y-0.5 border-t border-stone-100 pt-1">
              {runs.map((run) => (
                <li key={run.id} className="flex flex-wrap items-center gap-x-2 text-sm">
                  <span className="font-medium text-ink">{relativeTime(run.startedAt)}</span>
                  <span className={`rounded-full px-1.5 py-0.5 font-semibold uppercase ${
                    run.status === "error" ? "bg-coral/10 text-coral" : run.status === "skipped" ? "bg-stone-100 text-steel" : "bg-moss/10 text-moss"
                  }`}>
                    {t(`jobStatus.${run.status === "error" ? "error" : run.status === "skipped" ? "skipped" : "ok"}`)}
                  </span>
                  {run.status === "error" ? (
                    <span className="text-coral">{run.error ? t("runFailedMsg", { msg: run.error }) : t("runFailed")}</span>
                  ) : run.status !== "skipped" ? (
                    copy.lastOk(run, relativeTime(run.startedAt))
                  ) : null}
                </li>
              ))}
            </ol>
          </details>
        ) : null}
      </div>
    </div>
  );
}
