"use client";

import { useState } from "react";
import { Activity, AlertTriangle, Check, Loader2, X } from "lucide-react";
import { useTasks, type Task } from "./TasksProvider";

const STATUS_DOT: Record<string, string> = {
  succeeded: "bg-moss",
  failed: "bg-coral",
  canceled: "bg-stone-400",
  interrupted: "bg-amber-400",
};

function pct(t: Task): number {
  if (t.progressTotal <= 0) return t.status === "running" ? 8 : 0;
  return Math.round((t.progressDone / t.progressTotal) * 100);
}

export function TasksIndicator() {
  const { tasks, running, cancelTask, startError, clearStartError } = useTasks();
  const [open, setOpen] = useState(false);
  const recent = tasks.filter((t) => !["running", "queued"].includes(t.status)).slice(0, 4);

  // Nothing has ever run and nothing failed to start this session → stay invisible.
  if (tasks.length === 0 && !startError) return null;

  return (
    <div className="border-t border-stone-200 px-3 py-3">
      {startError && (
        <div className="mb-2 flex items-start gap-1.5 rounded-md border border-coral/40 bg-coral/5 p-2">
          <AlertTriangle size={13} className="mt-0.5 shrink-0 text-coral" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-coral">Couldn&apos;t start the task</p>
            <p className="break-words text-sm text-steel">{startError.message}</p>
          </div>
          <button
            type="button"
            onClick={clearStartError}
            title="Dismiss"
            className="focus-ring rounded p-0.5 text-steel hover:bg-stone-100 hover:text-coral"
          >
            <X size={12} />
          </button>
        </div>
      )}

      {tasks.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="focus-ring flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-base font-medium text-ink/80 hover:bg-white"
          >
            {running.length > 0 ? (
              <Loader2 size={14} className="animate-spin text-coral" />
            ) : (
              <Activity size={14} className="text-steel" />
            )}
            <span>Background tasks</span>
            {running.length > 0 ? (
              <span className="ml-auto rounded-full bg-coral px-1.5 text-sm font-semibold text-white">{running.length}</span>
            ) : (
              <span className="ml-auto text-sm text-steel">{open ? "hide" : "show"}</span>
            )}
          </button>

          {(open || running.length > 0) && (
            <div className="mt-2 space-y-2">
              {running.map((t) => (
                <div key={t.id} className="rounded-md border border-stone-200 bg-white p-2">
                  <div className="flex items-center gap-1.5">
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{t.label ?? t.kind}</span>
                    <button
                      type="button"
                      onClick={() => cancelTask(t.id)}
                      title="Cancel"
                      className="focus-ring rounded p-0.5 text-steel hover:bg-stone-100 hover:text-coral"
                    >
                      <X size={12} />
                    </button>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-stone-200">
                    <div className="h-full rounded-full bg-coral transition-all duration-500" style={{ width: `${Math.max(6, pct(t))}%` }} />
                  </div>
                  <p className="mt-1 truncate text-sm text-steel">
                    {t.progressTotal > 0 ? `${t.progressDone}/${t.progressTotal} · ` : ""}
                    {t.progressMsg ?? (t.status === "queued" ? "queued…" : "working…")}
                  </p>
                </div>
              ))}

              {open && recent.length > 0
                ? recent.map((t) => (
                    <div key={t.id} className="flex items-center gap-1.5 px-1 text-sm">
                      <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[t.status] ?? "bg-stone-300"}`} />
                      <span className="min-w-0 flex-1 truncate text-steel">{t.label ?? t.kind}</span>
                      {t.status === "succeeded" ? <Check size={11} className="text-moss" /> : null}
                    </div>
                  ))
                : null}
            </div>
          )}
        </>
      )}
    </div>
  );
}
