"use client";

// AUTO6 — the second registered scheduler job: candidate interview reminders.
// Shows it's alive (last sweep time), what it sent (latest run), and lets it be
// paused. Split out of SchedulerControl.tsx.

import type { SchedulerTranslator } from "./pipelineTranslator";
import { BellRing, XCircle } from "lucide-react";
import { isCurrentRunError } from "@/app/_lib/scheduler-health";
import type { Schedule, SchedulerRun } from "./SchedulerSummaryBadges";

export function SchedulerRemindersRow({
  t,
  reminders,
  reminderRuns,
  relativeTime,
  relayConfigured,
  busy,
  onToggle,
}: {
  t: SchedulerTranslator;
  reminders: Schedule;
  reminderRuns: SchedulerRun[];
  relativeTime: (iso: string) => string;
  relayConfigured: boolean | null;
  busy: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md border border-stone-200 bg-paper/40 px-3 py-1.5 text-sm text-steel">
      <span className="flex items-center gap-1.5 font-medium text-ink">
        <BellRing size={13} className="text-coral" aria-hidden /> {t("remindersJob")}
      </span>
      <button
        type="button"
        onClick={onToggle}
        disabled={busy}
        aria-pressed={reminders.enabled}
        className={`focus-ring inline-flex h-6 items-center rounded-full px-2.5 text-sm font-semibold ${
          reminders.enabled ? "bg-moss/15 text-moss" : "bg-stone-200 text-steel"
        }`}
        title={t("remindersToggleTitle")}
      >
        {reminders.enabled ? t("remindersOn") : t("remindersOff")}
      </button>
      <span>
        {reminders.lastRunAt ? t("remindersChecked", { time: relativeTime(reminders.lastRunAt) }) : t("remindersNever")}
      </span>
      {/* OO-L2-15 — an error row renders as a live problem ONLY while it is
          current: recent (24h TTL) and not superseded by a later check
          (zero-send sweeps record no rows, so the newest ROW can be weeks old
          while last_run_at proves the job healthy). Current errors carry
          their timestamp so "failing" is never confused with "failed once,
          back in June". Historic errors fall through to the last-success line
          (or nothing) instead of masquerading as today's status. */}
      {reminderRuns[0] ? (
        isCurrentRunError(reminderRuns[0], { lastRunAt: reminders.lastRunAt }) ? (
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-coral">
            <XCircle size={12} aria-hidden /> {reminderRuns[0].error ?? t("runFailed")}
            <span className="font-normal text-steel">· {relativeTime(reminderRuns[0].startedAt)}</span>
          </span>
        ) : reminderRuns[0].status !== "error" ? (
          <span className="text-xs">
            {t(relayConfigured === false ? "remindersLastQueued" : "remindersLastSent", {
              n: Number((reminderRuns[0].summary as { sent?: number } | null)?.sent ?? 0),
              time: relativeTime(reminderRuns[0].startedAt),
            })}
          </span>
        ) : null
      ) : null}
    </div>
  );
}
