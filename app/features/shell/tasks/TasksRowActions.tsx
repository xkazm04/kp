"use client";

// The run table's Actions cell content: Cancel (with its inline confirm) while a
// run is active, Retry once it is terminal and replayable. Split out of
// TasksTableRow.tsx so that file stays under the 200-line cap; the two states are
// mutually exclusive by construction, which is why they share one cell.
import { useState } from "react";
import { useTranslations } from "next-intl";
import { RefreshCw, X } from "lucide-react";
import { useTasks, type Task } from "./TasksProvider";

export function TasksRowActions({ task, active, onCancel }: { task: Task; active: boolean; onCancel?: (id: string) => void }) {
  const t = useTranslations("tasks");
  const { retryTask } = useTasks();
  const [retrying, setRetrying] = useState(false);
  // Cancel is destructive (it kills a running job) and was a single unguarded
  // click with no feedback. Require an inline confirm, then show a pending state
  // until the row drops off on the next refresh.
  const [confirming, setConfirming] = useState(false);
  const [canceling, setCanceling] = useState(false);

  if (active) {
    // The history table passes no onCancel — its rows are terminal by construction.
    if (!onCancel) return null;
    if (canceling) return <span className="text-meta text-steel">{t("active.canceling")}</span>;
    if (confirming) {
      return (
        <span className="inline-flex items-center gap-1">
          <button
            type="button"
            onClick={() => {
              setConfirming(false);
              setCanceling(true);
              onCancel(task.id);
            }}
            className="focus-ring rounded border border-coral/40 px-1.5 py-0.5 text-meta font-semibold text-coral hover:bg-coral/5"
          >
            {t("active.confirmCancel")}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="focus-ring rounded border border-stone-200 px-1.5 py-0.5 text-meta font-semibold text-steel hover:bg-stone-100"
          >
            {t("active.keep")}
          </button>
        </span>
      );
    }
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        title={t("active.cancelAria")}
        aria-label={t("active.cancelAria")}
        className="focus-ring rounded p-1 text-steel hover:bg-stone-100 hover:text-coral"
      >
        <X size={14} aria-hidden />
      </button>
    );
  }

  // DATA1 — every dead-end terminal row can replay from its persisted params; the
  // new run appears at the top of the table via the existing poll (the old row
  // stays as the audit record of the failure).
  const retryable = task.status === "failed" || task.status === "interrupted" || task.status === "canceled";
  if (!retryable) return null;
  return (
    <button
      type="button"
      onClick={() => {
        setRetrying(true);
        void retryTask(task.id).finally(() => setRetrying(false));
      }}
      disabled={retrying}
      title={t("done.retryTitle")}
      className="focus-ring inline-flex items-center gap-1 rounded-md border border-stone-300 bg-white px-2 py-1 text-sm font-medium text-steel transition-colors hover:bg-paper hover:text-coral disabled:opacity-60"
    >
      <RefreshCw size={12} className={retrying ? "animate-spin" : ""} aria-hidden /> {t("done.retry")}
    </button>
  );
}
