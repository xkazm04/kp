"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, RefreshCw, X } from "lucide-react";
import { EYEBROW, INTRO, TITLE_DISPLAY } from "@/app/_components/ui/recipes";
import { renderTaskLabel } from "@/app/_lib/task-label";
import { useTasks, type Task, type TaskStatus } from "./TasksProvider";
import { Checkbox } from "@/app/_components/Checkbox";
import { Defer } from "@/app/_components/ui/Defer";
import { ACTIVE, RECENT_WINDOW_DAYS } from "./tasksTabHelpers";
import { TaskHistory } from "./TasksHistory";
import { TasksRunsPanel } from "./TasksRunsPanel";

// AI tasks — every long-running AI action the workspace kicked off, live.
//
// The tab used to carry three unrelated operator panels below the run lists: a
// System health readout, workspace Backup & restore, and the outbound ATS
// webhook form. They collected here because this was the operator's tab, not
// because they belonged to tasks. Each has moved to the surface that owns it —
// System into Models → Usage & cost (which already reported half of it),
// Backup & restore into Settings → Organization, the webhook into Settings →
// Integrations — so this tab is now exactly one thing: the run table.

export function TasksTab() {
  const t = useTranslations("tasks");
  const { tasks, cancelTask, refresh, startError, clearStartError, markSeen } = useTasks();

  // Read/unread ack: after the unread finished rows have actually been on screen
  // for a short dwell, stamp their seen_at (server-side) so the indicator badge
  // clears. The dwell (not an instant ack on mount) is what makes "seen" honest —
  // a tab flicked past for 200ms doesn't count. Keyed by the unread id set so a
  // finish that lands while the tab is open gets its own dwell.
  const unseenIds = tasks.filter((task) => !ACTIVE(task) && task.seenAt === null).map((task) => task.id);
  const unseenKey = unseenIds.join(",");
  useEffect(() => {
    if (!unseenKey) return;
    const ids = unseenKey.split(",");
    const timer = window.setTimeout(() => void markSeen(ids), 1500);
    return () => window.clearTimeout(timer);
  }, [unseenKey, markSeen]);
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
  // DATA6 — the filters live here, not in the table, because kind/status also
  // thread into the history endpoint: one filter set narrows both the in-memory
  // window and the server-side trail. The controls themselves are the run
  // table's column headers (TasksTable).
  const [textFilter, setTextFilter] = useState("");
  const [kindFilter, setKindFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<TaskStatus | null>(null);
  const text = textFilter.trim().toLowerCase();
  // Free text matches what the user can SEE, so it runs over the resolved
  // (localized) label — the stored one is an encoded catalog reference.
  const matches = (task: Task) =>
    (!kindFilter || task.kind === kindFilter) &&
    (!statusFilter || task.status === statusFilter) &&
    (!text || renderTaskLabel(t, task).toLowerCase().includes(text) || task.kind.toLowerCase().includes(text));
  const shown = tasks.filter(matches);
  const kinds = [...new Set(tasks.map((task) => task.kind))].sort();
  const filtering = Boolean(text) || Boolean(kindFilter) || statusFilter !== null;

  return (
    // Tier 1: header, banners, the run table and the history pager are this
    // section's direct children, so they cascade in together. aria-busy covers
    // only the FIRST load — later polls (the 2s/6s refresh loop) never re-flip
    // it, so an already-rendered table is never blanked by a background refresh.
    <section className="stagger-children mx-auto max-w-5xl space-y-6" aria-busy={!loaded}>
      <header className="flex flex-col gap-4 border-b border-stone-200 pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className={EYEBROW}>{t("eyebrow")}</p>
          <h2 className={`mt-1 ${TITLE_DISPLAY}`}>{t("label")}</h2>
          <p className={`mt-2 max-w-3xl ${INTRO}`}>{t("intro")}</p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          className="focus-ring inline-flex shrink-0 items-center gap-1.5 rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-steel transition-colors hover:bg-paper"
        >
          <RefreshCw size={13} aria-hidden />
          {t("refresh")}
        </button>
      </header>

      {startError ? (
        <div className="flex items-start gap-2 rounded-lg border border-coral/40 bg-coral/5 p-3">
          <AlertTriangle size={15} className="mt-0.5 shrink-0 text-coral" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-base font-semibold text-coral">
              {startError.kind === "cancel" ? t("cancelErrorTitle") : t("startErrorTitle")}
            </p>
            <p className="break-words text-sm text-steel">{startError.message}</p>
          </div>
          <button
            type="button"
            onClick={clearStartError}
            title={t("dismiss")}
            className="focus-ring shrink-0 rounded p-1 text-steel hover:bg-stone-100 hover:text-coral"
          >
            <X size={14} aria-hidden />
          </button>
        </div>
      ) : null}

      <TasksRunsPanel
        loaded={loaded}
        tasks={shown}
        kinds={kinds}
        textFilter={textFilter}
        setTextFilter={setTextFilter}
        kindFilter={kindFilter}
        setKindFilter={setKindFilter}
        statusFilter={statusFilter}
        setStatusFilter={setStatusFilter}
        filtering={filtering}
        onClearFilters={() => {
          setTextFilter("");
          setKindFilter("");
          setStatusFilter(null);
        }}
        onCancel={(id) => void cancelTask(id)}
      />

      {/* Older runs are loaded only on demand — checking this reveals a history
          table that pages in 20 at a time, so the trail is never loaded at once. */}
      <label className="flex w-fit cursor-pointer items-center gap-2 text-base text-steel">
        <Checkbox checked={showHistory} onChange={(e) => setShowHistory(e.target.checked)} />
        {t("showHistory", { days: RECENT_WINDOW_DAYS })}
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
    </section>
  );
}
