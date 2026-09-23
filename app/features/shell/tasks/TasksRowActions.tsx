"use client";

// The run table's Actions cell content: Cancel (with its inline confirm) while a
// run is active, Retry once it is terminal and replayable — or, when the server's
// replay verdict says the replay cannot run, the reason and the tab that can. Split out of
// TasksTableRow.tsx so that file stays under the 200-line cap; the two states are
// mutually exclusive by construction, which is why they share one cell.
import { useState } from "react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { RefreshCw, X } from "lucide-react";
import { buildTabSwitchUrl } from "../tabs";
import { useShellNavigate } from "../nav/shallow-nav";
import { useTasks, type Task } from "./TasksProvider";
import { REPLAY_REASON_KEY, rowRetryAction, type RetryDoor } from "./tasksTabHelpers";
import type { ReplayBlockReason } from "@/app/_lib/task-replay";

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

  // DATA1 — a dead-end terminal row replays from its persisted params; the new run
  // appears at the top of the table via the existing poll (the old row stays as the
  // audit record of the failure). Whether it CAN replay is the server's verdict
  // (app/_lib/task-replay.ts, the same function the retry door refuses by): a row
  // that would only be refused states why instead of offering a button that fails.
  const action = rowRetryAction(task);
  if (action.kind === "none") return null;
  if (action.kind === "blocked") return <TasksRowBlocked reason={action.reason} door={action.door} />;
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

/** A dead row the replay cannot run: the reason, from a code, and — when a tab can
 *  re-create the inputs — the door to it. Its own component so only these rows
 *  subscribe to the search params. */
function TasksRowBlocked({ reason, door }: { reason: ReplayBlockReason; door: RetryDoor | null }) {
  const t = useTranslations("tasks.replay");
  const nav = useShellNavigate();
  const search = useSearchParams();
  return (
    <span className="inline-flex max-w-64 flex-col items-start gap-0.5 text-left">
      <span className="text-meta text-steel">{t(REPLAY_REASON_KEY[reason])}</span>
      {door && (
        <button
          type="button"
          onClick={() => nav.push(buildTabSwitchUrl(door.tab, search.toString()))}
          className="focus-ring rounded-sm text-meta font-semibold text-coral underline decoration-coral/40 underline-offset-2 hover:decoration-coral"
        >
          {t("openAnalyze")}
        </button>
      )}
    </span>
  );
}
