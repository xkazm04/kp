"use client";

// ONE row shape for every run, whatever its status. The tab used to render two
// different components — a progress CARD for in-progress work and a list ROW for
// finished work — under two headings, which meant the same run changed shape
// under the reader mid-glance and the two lists could never be scanned as one
// (no shared columns, no shared sort, no shared pager). This row carries both
// states: the progress bar and Cancel appear while a run is active, the outcome
// drawer and Retry once it is terminal, in the same six columns.
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import { progressDisplay } from "@/app/_lib/task-view";
import { renderTaskLabel } from "@/app/_lib/task-label";
import { useTasks, type Task } from "./TasksProvider";
import { ACTIVE, STATUS, duration, relTime } from "./tasksTabHelpers";
import { TaskOutcome } from "./TasksOutcome";
import { TasksRowActions } from "./TasksRowActions";

/** Column count — the drawer row spans it. Kept beside the markup that defines it. */
export const TASK_COLUMNS = 6;

// `animateDelayMs` cascades a freshly loaded history page in; live (recent-window)
// rows omit it so polling never re-triggers motion. CSS animations only fire on
// mount, so already-present rows never re-animate regardless.
export function TasksTableRow({
  task,
  onCancel,
  animateDelayMs = null,
}: {
  task: Task;
  /** Omitted by the history table: its rows are terminal by construction. */
  onCancel?: (id: string) => void;
  animateDelayMs?: number | null;
}) {
  const locale = useLocale();
  const t = useTranslations("tasks");
  const { fetchTask } = useTasks();
  const reduced = useReducedMotion();
  // DATA5 — the outcome drawer: the row expands to the task's full record
  // (fetchTask — the polled list deliberately omits result/params blobs).
  const [expanded, setExpanded] = useState(false);
  const [full, setFull] = useState<Task | null>(null);
  const [outcomeFailed, setOutcomeFailed] = useState(false);

  const meta = STATUS[task.status];
  const active = ACTIVE(task);
  const disp = progressDisplay(task);
  const dur = duration(task.startedAt, task.finishedAt);
  const failed = task.status === "failed" || task.status === "interrupted";
  const animate = animateDelayMs != null;

  const toggleOutcome = () => {
    const next = !expanded;
    setExpanded(next);
    if (next && !full) {
      void fetchTask(task.id).then((fetched) => {
        if (fetched) setFull(fetched);
        else setOutcomeFailed(true);
      });
    }
  };

  return (
    <>
      <tr
        className={`border-b border-stone-100 align-top ${animate ? "animate-fade-in" : ""}`}
        style={animate ? { animationDelay: `${animateDelayMs}ms` } : undefined}
      >
        <td className="whitespace-nowrap py-2.5 pr-3">
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-meta font-semibold ${meta.badge}`}>
            <meta.Icon size={11} className={meta.iconCls} />
            {t(`status.${task.status}`)}
          </span>
        </td>

        <td className="min-w-[16rem] py-2.5 pr-3">
          {/* Only a terminal run has an outcome to open, so only a terminal run's
              label is a button — an active one would expand onto "no result yet". */}
          {active ? (
            <p className="text-base text-ink">{renderTaskLabel(t, task)}</p>
          ) : (
            <button type="button" onClick={toggleOutcome} aria-expanded={expanded} title={t("done.outcomeTitle")} className="focus-ring w-full text-left">
              <span className="flex items-center gap-1 text-base text-ink">
                {expanded ? (
                  <ChevronDown size={13} className="shrink-0 text-steel" aria-hidden />
                ) : (
                  <ChevronRight size={13} className="shrink-0 text-steel" aria-hidden />
                )}
                <span className="min-w-0 truncate">{renderTaskLabel(t, task)}</span>
                {/* Unread dot: this outcome finished while the recruiter was
                    elsewhere and has not been acknowledged yet. The tab's
                    dwell-ack (TasksTab) stamps seen_at ~1.5s after the row is on
                    screen; the dot clears on the poll that follows. */}
                {task.seenAt === null ? (
                  <span
                    role="status"
                    aria-label={t("unreadRow")}
                    title={t("unreadRow")}
                    className="ml-1 inline-block h-2 w-2 shrink-0 rounded-full bg-coral"
                  />
                ) : null}
              </span>
            </button>
          )}
          {failed && task.error ? <p className="mt-0.5 break-words text-sm text-coral">{task.error}</p> : null}
          {active ? (
            <>
              {/* Finding 5: a determinate bar ONLY when there's a real total. A
                  running task with no total is genuinely indeterminate — show an
                  animated "working" treatment (gated on reduced-motion) rather
                  than a frozen fake ~8% that reads as a job stalled at 8%. */}
              <div
                className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-stone-200"
                role="progressbar"
                aria-valuenow={disp.mode === "determinate" ? disp.pct : undefined}
                aria-valuemin={disp.mode === "determinate" ? 0 : undefined}
                aria-valuemax={disp.mode === "determinate" ? 100 : undefined}
                aria-label={disp.mode === "indeterminate" ? t("active.working") : undefined}
              >
                {disp.mode === "determinate" ? (
                  <div className="h-full rounded-full bg-coral transition-all duration-500" style={{ width: `${Math.max(6, disp.pct)}%` }} />
                ) : disp.mode === "indeterminate" ? (
                  <div className={`h-full w-full rounded-full ${reduced ? "bg-coral/40" : "bg-coral/70 animate-pulse"}`} />
                ) : (
                  <div className="h-full w-1/6 rounded-full bg-stone-300" />
                )}
              </div>
              <p className="mt-1 truncate text-sm text-steel">
                {task.progressTotal > 0 ? `${task.progressDone}/${task.progressTotal} · ` : ""}
                {/* `progressMsg` is the running handler's own live detail (a
                    candidate name, a stage) written server-side with no reader
                    locale — passed through as-is; only this fallback is copy. */}
                {task.progressMsg ?? (task.status === "queued" ? t("active.queuedMsg") : t("active.workingMsg"))}
              </p>
            </>
          ) : null}
        </td>

        {/* A task KIND is a canonical wire slug (`jd_build`, `batch_screen`) — an
            identifier, not copy, so it renders verbatim in mono type. */}
        <td className="whitespace-nowrap py-2.5 pr-3 font-mono text-sm text-steel/80">{task.kind}</td>

        <td className="whitespace-nowrap py-2.5 pr-3 text-sm text-steel nums">
          {relTime(task.finishedAt ?? task.startedAt ?? task.createdAt, locale)}
        </td>

        <td className="whitespace-nowrap py-2.5 pr-3 text-sm text-steel nums">{dur ?? "—"}</td>

        <td className="whitespace-nowrap py-2.5 text-right">
          <TasksRowActions task={task} active={active} onCancel={onCancel} />
        </td>
      </tr>

      {expanded ? (
        <tr className="border-b border-stone-100">
          <td colSpan={TASK_COLUMNS} className="pb-3 pl-8 pr-3">
            {full ? (
              <TaskOutcome task={full} />
            ) : outcomeFailed ? (
              <p className="text-sm text-coral">{t("done.outcomeFailed")}</p>
            ) : (
              <p className="text-sm text-steel">{t("done.outcomeLoading")}</p>
            )}
          </td>
        </tr>
      ) : null}
    </>
  );
}
