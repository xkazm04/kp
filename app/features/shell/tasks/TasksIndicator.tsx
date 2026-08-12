"use client";

import { useTranslations } from "next-intl";
import { AlertTriangle, X } from "lucide-react";
import { useTasks } from "./TasksProvider";
import { UNSEEN_DONE } from "./tasksProviderTypes";
import { METER_BARS_PER_ROW, taskMeterRows } from "./tasksTaskMeter";
import { navItemClass } from "../tabs";

// Sidebar-footer entry for the Background tasks view. It no longer expands an
// inline list — clicking navigates to the dedicated ?tab=tasks page (onOpen).
// What stays here is the always-at-a-glance signal: a live running count, a
// start-failure alert, and the UNREAD badges — visible from any tab.
//
// Read/unread (background-mode round, 2026-08-12): every finished task carries a
// server-side seen_at ack (null = unread). The badges here count unread rows —
// failures separately in coral, successes in moss — and clicking the entry leads
// straight to them; the Tasks tab stamps the ack after the rows have actually
// been on screen (a short dwell in TasksTab), so an outcome can't be "seen" by a
// badge the recruiter never followed. This replaced the localStorage failure
// watermark: the ack now survives browsers/sessions and covers successes too —
// with every LLM action running as a background task, a finished-while-elsewhere
// result is the norm, not the exception.
//
// Unlike every other nav row this one carries NO leading icon: the label is the
// longest in the sidebar and the icon pushed it onto a second line beside the
// badges. The freed space goes to a load meter under the label instead (5 bars
// per row, a second row on spill, saturating at 10 — see task-meter.ts), which
// says "how busy" at a glance far faster than a number does.
export function TasksIndicator({ active, onOpen }: { active: boolean; onOpen: () => void }) {
  const { tasks, running, startError, clearStartError } = useTasks();
  const t = useTranslations("tasks");
  const unseen = tasks.filter(UNSEEN_DONE);
  const unseenFailed = unseen.filter((x) => x.status === "failed" || x.status === "interrupted").length;
  const unseenOk = unseen.length - unseenFailed;

  return (
    <div className="border-t border-stone-200 px-3 py-3">
      {startError && (
        <div role="alert" className="mb-2 flex items-start gap-1.5 rounded-md border border-coral/40 bg-coral/5 p-2">
          <AlertTriangle size={13} className="mt-0.5 shrink-0 text-coral" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-coral">
              {startError.kind === "cancel" ? t("cancelErrorTitle") : t("startErrorTitle")}
            </p>
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
        className={`focus-ring flex w-full flex-col gap-1.5 rounded-md px-2.5 py-2 text-base font-medium transition-colors ${navItemClass(active)}`}
      >
        {/* Row 1 — the label on ONE line (no icon), badges pushed right. */}
        <span className="flex w-full items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-left">{t("label")}</span>
          {/* aria-live so a screen reader hears the counts tick — the whole point
              of this always-at-a-glance signal, previously announced visual-only. */}
          {unseenFailed > 0 ? (
            <span
              aria-live="polite"
              aria-label={t("failedSince", { count: unseenFailed })}
              className="inline-flex shrink-0 items-center gap-1 rounded-full bg-coral/10 px-1.5 text-sm font-semibold text-coral"
            >
              <AlertTriangle size={10} aria-hidden /> {unseenFailed}
            </span>
          ) : null}
          {/* Unread finished-OK outcomes — the "your result is ready" signal for
              runs the recruiter navigated away from. Cleared by visiting the tab. */}
          {unseenOk > 0 ? (
            <span
              aria-live="polite"
              aria-label={t("unreadDone", { count: unseenOk })}
              className="shrink-0 rounded-full bg-moss/15 px-1.5 text-sm font-semibold text-moss"
            >
              {unseenOk}
            </span>
          ) : null}
          {running.length > 0 ? (
            <span
              aria-live="polite"
              aria-label={t("running", { count: running.length })}
              className="shrink-0 rounded-full bg-coral px-1.5 text-sm font-semibold text-white"
            >
              {running.length}
            </span>
          ) : tasks.length > 0 && unseen.length === 0 ? (
            <span className="shrink-0 text-sm text-steel">{tasks.length}</span>
          ) : null}
        </span>

        {/* Row 2+ — the load meter. Purely redundant with the aria-live count
            above, so it is hidden from AT rather than announced twice. */}
        <span aria-hidden className="flex w-full flex-col gap-[3px]">
          {taskMeterRows(running.length).map((filled, row) => (
            <span key={row} className="flex w-full gap-1">
              {Array.from({ length: METER_BARS_PER_ROW }, (_, bar) => (
                <span
                  key={bar}
                  className={`h-[3px] flex-1 rounded-full transition-colors ${bar < filled ? "bg-coral" : "bg-stone-200"}`}
                />
              ))}
            </span>
          ))}
        </span>
      </button>
    </div>
  );
}
