"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Activity, AlertTriangle, Loader2, X } from "lucide-react";
import { useTasks } from "./TasksProvider";
import { navItemClass } from "../tabs";

// DATA5 — the "something failed while you were elsewhere" watermark. Failures
// that finished after the last time the tasks tab was open count as unseen;
// opening the tab acknowledges them (the timestamp persists across sessions).
const FAILED_SEEN_KEY = "kp.tasksFailedSeenAt";

// Sidebar-footer entry for the Background tasks view. It no longer expands an
// inline list — clicking navigates to the dedicated ?tab=tasks page (onOpen).
// What stays here is the always-at-a-glance signal: a live running count, a
// start-failure alert, and an unseen-failures badge — visible from any tab.
export function TasksIndicator({ active, onOpen }: { active: boolean; onOpen: () => void }) {
  const { tasks, running, startError, clearStartError } = useTasks();
  const t = useTranslations("nav.tasks");
  const [seenAt, setSeenAt] = useState("");
  useEffect(() => {
    try {
      const raw = localStorage.getItem(FAILED_SEEN_KEY);
      // localStorage is client-only — a mount effect is the SSR-safe hydration
      // path (the kp.pipelineViews convention); one-time set, not cascading.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (raw) setSeenAt(raw);
    } catch {
      /* unavailable — every failure counts as unseen this session */
    }
  }, []);
  // While the tab is open the user IS seeing the failures — keep the ack
  // watermark current so leaving the tab starts a fresh window.
  useEffect(() => {
    if (!active) return;
    const now = new Date().toISOString();
    try {
      localStorage.setItem(FAILED_SEEN_KEY, now);
    } catch {
      /* in-memory ack still applies this session */
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mirrors the external ack write above; runs only while the tasks tab is open
    setSeenAt(now);
  }, [active, tasks]);
  const unseenFailed = active
    ? 0
    : tasks.filter(
        (t) =>
          (t.status === "failed" || t.status === "interrupted") &&
          (t.finishedAt ?? t.createdAt) > seenAt
      ).length;

  return (
    <div className="border-t border-stone-200 px-3 py-3">
      {startError && (
        <div role="alert" className="mb-2 flex items-start gap-1.5 rounded-md border border-coral/40 bg-coral/5 p-2">
          <AlertTriangle size={13} className="mt-0.5 shrink-0 text-coral" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-coral">{t("startErrorTitle")}</p>
            <p className="break-words text-sm text-steel">{startError.message}</p>
          </div>
          <button
            type="button"
            onClick={clearStartError}
            title={t("dismiss")}
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
          <Loader2 size={14} aria-hidden className="shrink-0 animate-spin text-coral" />
        ) : (
          <Activity size={14} aria-hidden className="shrink-0 text-steel" />
        )}
        <span>{t("label")}</span>
        {/* aria-live so a screen reader hears the running count tick up/down — the whole
            point of this always-at-a-glance signal, previously announced visual-only. */}
        {unseenFailed > 0 ? (
          <span
            aria-live="polite"
            aria-label={t("failedSince", { count: unseenFailed })}
            className="ml-auto inline-flex items-center gap-1 rounded-full bg-coral/10 px-1.5 text-sm font-semibold text-coral"
          >
            <AlertTriangle size={10} aria-hidden /> {unseenFailed}
          </span>
        ) : null}
        {running.length > 0 ? (
          <span aria-live="polite" aria-label={t("running", { count: running.length })} className={`${unseenFailed > 0 ? "ml-1" : "ml-auto"} rounded-full bg-coral px-1.5 text-sm font-semibold text-white`}>{running.length}</span>
        ) : tasks.length > 0 && unseenFailed === 0 ? (
          <span className="ml-auto text-sm text-steel">{tasks.length}</span>
        ) : null}
      </button>
    </div>
  );
}
