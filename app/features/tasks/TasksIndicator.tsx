"use client";

import { Activity, AlertTriangle, Loader2, X } from "lucide-react";
import { useTasks } from "./TasksProvider";
import { navItemClass } from "../tabs";

// Sidebar-footer entry for the Background tasks view. It no longer expands an
// inline list — clicking navigates to the dedicated ?tab=tasks page (onOpen).
// What stays here is the always-at-a-glance signal: a live running count and a
// start-failure alert, both visible regardless of which tab is open.
export function TasksIndicator({ active, onOpen }: { active: boolean; onOpen: () => void }) {
  const { tasks, running, startError, clearStartError } = useTasks();

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

      <button
        type="button"
        aria-current={active ? "page" : undefined}
        onClick={onOpen}
        className={`focus-ring flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-base font-medium transition-colors ${navItemClass(active)}`}
      >
        {running.length > 0 ? (
          <Loader2 size={14} className="shrink-0 animate-spin text-coral" />
        ) : (
          <Activity size={14} className="shrink-0 text-steel" />
        )}
        <span>Background tasks</span>
        {running.length > 0 ? (
          <span className="ml-auto rounded-full bg-coral px-1.5 text-sm font-semibold text-white">{running.length}</span>
        ) : tasks.length > 0 ? (
          <span className="ml-auto text-sm text-steel">{tasks.length}</span>
        ) : null}
      </button>
    </div>
  );
}
