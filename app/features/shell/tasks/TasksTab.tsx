"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { AlertTriangle, RefreshCw, X } from "lucide-react";
import { useTasks, type Task, type TaskStatus } from "./TasksProvider";
import { Checkbox } from "@/app/_components/Checkbox";
import { Defer } from "@/app/_components/ui/Defer";
import { ACTIVE, RECENT_WINDOW_DAYS } from "./tasksTabHelpers";
import { TaskHistory } from "./TasksHistory";
import { TasksFilterBar } from "./TasksFilterBar";
import { TasksResultsSection } from "./TasksResultsSection";

// Tier 3 (docs/design/loading-choreography.md): the three operator panels below the
// task list (System/Backup/Integrations) are secondary — nobody opens
// Background tasks to read cache-hit rates first. Each gets its own chunk so
// the tab's entry payload is the running/done lists, and they mount an idle
// beat later via <Defer> instead of piling onto the first frame.
const panelGap = (minHeight: string) => {
  const Gap = () => <div className={`reveal-quiet ${minHeight}`} aria-hidden />;
  Gap.displayName = "TasksPanelGap";
  return Gap;
};
const SystemCard = dynamic(() => import("./TasksSystemCard").then((m) => ({ default: m.SystemCard })), {
  loading: panelGap("min-h-[10rem]"),
});
const BackupCard = dynamic(() => import("./TasksBackupCard").then((m) => ({ default: m.BackupCard })), {
  loading: panelGap("min-h-[12rem]"),
});
const IntegrationsCard = dynamic(() => import("./TasksIntegrationsCard").then((m) => ({ default: m.IntegrationsCard })), {
  loading: panelGap("min-h-[12rem]"),
});

export function TasksTab() {
  const { tasks, cancelTask, refresh, startError, clearStartError } = useTasks();
  // TasksProvider exposes no loading flag (`tasks` starts `[]` and stays `[]`
  // whether the first poll hasn't landed yet or genuinely found nothing), so
  // the tab tracks its own first-load signal here rather than touching the
  // provider: fire one refresh on mount and flip `loaded` once it settles
  // (success or failure — the poll keeps going regardless). This is what lets
  // tier 2 tell "not loaded yet" apart from "genuinely no tasks".
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let alive = true;
    // `refresh` is typed `() => void` on the Ctx (most callers fire-and-forget
    // it), but the provider's implementation is actually async — wrapping the
    // call in Promise.resolve() lets us await settlement either way without
    // touching TasksProvider.tsx's public type.
    void Promise.resolve(refresh()).then(() => {
      if (alive) setLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, [refresh]);
  const [showHistory, setShowHistory] = useState(false);
  // DATA6 — client-side filter bar over the loaded window (the established
  // PIPE2/RES3 pattern); kind/status also thread into the history endpoint.
  const [textFilter, setTextFilter] = useState("");
  const [kindFilter, setKindFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<TaskStatus | null>(null);
  const text = textFilter.trim().toLowerCase();
  const matchesFilters = (t: Task) =>
    (!kindFilter || t.kind === kindFilter) && (!text || (t.label ?? t.kind).toLowerCase().includes(text));
  const active = tasks.filter(ACTIVE).filter(matchesFilters);
  const done = tasks
    .filter((t) => !ACTIVE(t))
    .filter(matchesFilters)
    .filter((t) => !statusFilter || t.status === statusFilter);
  const kinds = [...new Set(tasks.map((t) => t.kind))].sort();
  const filtering = Boolean(text) || Boolean(kindFilter) || statusFilter !== null;

  return (
    // Tier 1: header, banners, filters, the active/done region, history, and
    // the operator panels are this section's direct children, so they cascade
    // in together. aria-busy covers only the FIRST load — later polls (the
    // 2s/6s refresh loop) never re-flip it, so an already-rendered list is
    // never blanked or dimmed by a background refresh.
    <section className="stagger-children mx-auto max-w-5xl space-y-6" aria-busy={!loaded}>
      <header className="flex flex-col gap-4 border-b border-stone-200 pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-meta uppercase text-coral">Activity</p>
          <h2 className="mt-1 font-serif text-display text-ink">Background tasks</h2>
          <p className="mt-2 max-w-3xl text-body text-steel">
            Long-running actions — analysis, screening, JD builds, group evaluations — run here in the background. Watch
            them progress and review what finished, even after switching tabs.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          className="focus-ring inline-flex shrink-0 items-center gap-1.5 rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-steel transition-colors hover:bg-paper"
        >
          <RefreshCw size={13} />
          Refresh
        </button>
      </header>

      {startError ? (
        <div className="flex items-start gap-2 rounded-lg border border-coral/40 bg-coral/5 p-3">
          <AlertTriangle size={15} className="mt-0.5 shrink-0 text-coral" />
          <div className="min-w-0 flex-1">
            <p className="text-base font-semibold text-coral">
              {startError.kind === "cancel" ? "Couldn't cancel the task" : "Couldn't start the task"}
            </p>
            <p className="break-words text-sm text-steel">{startError.message}</p>
          </div>
          <button
            type="button"
            onClick={clearStartError}
            title="Dismiss"
            className="focus-ring shrink-0 rounded p-1 text-steel hover:bg-stone-100 hover:text-coral"
          >
            <X size={14} />
          </button>
        </div>
      ) : null}

      {/* DATA6: narrow the (often dozen-kind) window — free text over labels,
          a kind select, and terminal-status chips for the Done group. */}
      {tasks.length > 0 || showHistory ? (
        <TasksFilterBar
          textFilter={textFilter}
          setTextFilter={setTextFilter}
          kindFilter={kindFilter}
          setKindFilter={setKindFilter}
          kinds={kinds}
          statusFilter={statusFilter}
          setStatusFilter={setStatusFilter}
          filtering={filtering}
          onClear={() => {
            setTextFilter("");
            setKindFilter("");
            setStatusFilter(null);
          }}
        />
      ) : null}

      <TasksResultsSection
        loaded={loaded}
        active={active}
        done={done}
        filtering={filtering}
        onCancel={(id) => void cancelTask(id)}
      />

      {/* Older runs are loaded only on demand — checking this reveals a history
          table that pages in 20 at a time, so the trail is never loaded at once. */}
      <label className="flex w-fit cursor-pointer items-center gap-2 text-base text-steel">
        <Checkbox
          checked={showHistory}
          onChange={(e) => setShowHistory(e.target.checked)}
        />
        Show history (tasks older than {RECENT_WINDOW_DAYS} days)
      </label>

      {/* Tier 3: history is already gated behind the "Show history" checkbox
          (a user click, never fired on tab entry); Defer just keeps it off the
          frame that click lands on. The keyed remount restarts the
          (accumulating) infinite scroll whenever a server-side filter changes
          — the engine pages from offset 0 again. */}
      {showHistory ? (
        <Defer strategy="next-frame" placeholder={<div className="reveal-quiet min-h-[16rem]" aria-hidden />}>
          <TaskHistory key={`${kindFilter}|${statusFilter ?? ""}`} kind={kindFilter} status={statusFilter} text={text} />
        </Defer>
      ) : null}

      {/* Tier 3: DATA2 + DATA3 + P1-5 — the operator panels are secondary to the
          task list itself, each its own chunk, mounted an idle beat later. */}
      <Defer strategy="idle">
        <SystemCard />
      </Defer>
      <Defer strategy="idle">
        <BackupCard />
      </Defer>
      <Defer strategy="idle">
        <IntegrationsCard />
      </Defer>
    </section>
  );
}
