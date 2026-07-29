"use client";

// A running/queued task's progress card, split out of TasksTab.tsx so it stays
// under the 200-line file cap. Verbatim — same confirm-then-cancel flow, same
// determinate/indeterminate progress bar logic (Finding 5).
import { useState } from "react";
import { X } from "lucide-react";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import { progressDisplay } from "@/app/_lib/task-view";
import type { Task } from "./TasksProvider";
import { STATUS } from "./tasksTabHelpers";

export function ActiveCard({ task, onCancel }: { task: Task; onCancel: () => void }) {
  const meta = STATUS[task.status];
  const reduced = useReducedMotion();
  const disp = progressDisplay(task);
  // Cancel is destructive (kills a running job) and was a single unguarded click with
  // no feedback. Require an inline confirm, then show a pending state until the card
  // drops off on the next refresh.
  const [confirming, setConfirming] = useState(false);
  const [canceling, setCanceling] = useState(false);
  return (
    <li className="rounded-md border border-stone-200 bg-paper/50 p-3">
      <div className="flex items-center gap-2">
        <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-meta font-semibold ${meta.badge}`}>
          <meta.Icon size={11} className={meta.iconCls} />
          {meta.label}
        </span>
        <span className="min-w-0 flex-1 truncate text-base font-medium text-ink">{task.label ?? task.kind}</span>
        {canceling ? (
          <span className="shrink-0 text-meta text-steel">Canceling…</span>
        ) : confirming ? (
          <span className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => {
                setConfirming(false);
                setCanceling(true);
                onCancel();
              }}
              className="focus-ring rounded border border-coral/40 px-1.5 py-0.5 text-meta font-semibold text-coral hover:bg-coral/5"
            >
              Cancel task
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="focus-ring rounded border border-stone-200 px-1.5 py-0.5 text-meta font-semibold text-steel hover:bg-stone-100"
            >
              Keep
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            title="Cancel task"
            aria-label="Cancel task"
            className="focus-ring shrink-0 rounded p-1 text-steel hover:bg-stone-100 hover:text-coral"
          >
            <X size={14} />
          </button>
        )}
      </div>
      {/* Finding 5: a determinate bar ONLY when there's a real total. A running
          task with no total is genuinely indeterminate — show an animated
          "working" treatment (a pulsing full bar, gated on reduced-motion) rather
          than a frozen fake ~8% that reads as a job stalled at 8%. */}
      <div
        className="mt-2 h-1.5 overflow-hidden rounded-full bg-stone-200"
        role="progressbar"
        aria-valuenow={disp.mode === "determinate" ? disp.pct : undefined}
        aria-valuemin={disp.mode === "determinate" ? 0 : undefined}
        aria-valuemax={disp.mode === "determinate" ? 100 : undefined}
        aria-label={disp.mode === "indeterminate" ? "Working…" : undefined}
      >
        {disp.mode === "determinate" ? (
          <div className="h-full rounded-full bg-coral transition-all duration-500" style={{ width: `${Math.max(6, disp.pct)}%` }} />
        ) : disp.mode === "indeterminate" ? (
          <div className={`h-full w-full rounded-full ${reduced ? "bg-coral/40" : "bg-coral/70 animate-pulse"}`} />
        ) : (
          <div className="h-full w-1/6 rounded-full bg-stone-300" />
        )}
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-3 text-sm text-steel">
        <span className="min-w-0 truncate">
          {task.progressTotal > 0 ? `${task.progressDone}/${task.progressTotal} · ` : ""}
          {task.progressMsg ?? (task.status === "queued" ? "queued…" : "working…")}
        </span>
        <span className="shrink-0 font-mono text-sm text-steel/80">{task.kind}</span>
      </div>
    </li>
  );
}
