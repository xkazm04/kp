"use client";

// The scheduler's main control row: clock label, the no-CLI fallback badge, the
// enabled toggle, the interval field, the fixed "reject → queued for approval"
// note, the last-run summary, "Run now", the history toggle, and the run-result /
// error chips. Split out of SchedulerControl.tsx.

import type { SchedulerTranslator } from "./pipelineTranslator";
import { AlertTriangle, Clock, History, Loader2 } from "lucide-react";
import type { EngineAvailability } from "@/app/_lib/engine-preflight";
import { RESULT_TONE, SummaryBadges, type Schedule, type RunResult } from "./SchedulerSummaryBadges";

export function SchedulerToolbar({
  t,
  engines,
  sched,
  busy,
  onToggleEnabled,
  scheduleScope,
  intervalDraft,
  onIntervalChange,
  onIntervalFocus,
  onIntervalBlur,
  relativeTime,
  onRunNow,
  runsCount,
  historyOpen,
  onToggleHistory,
  result,
  error,
}: {
  t: SchedulerTranslator;
  engines: EngineAvailability | null;
  sched: Schedule;
  busy: boolean;
  onToggleEnabled: () => void;
  /** The route's declared blast radius for the clock ("global" in phase-1 tenancy). */
  scheduleScope: string | null;
  intervalDraft: string;
  onIntervalChange: (value: string) => void;
  onIntervalFocus: () => void;
  onIntervalBlur: (value: string) => void;
  relativeTime: (iso: string) => string;
  onRunNow: () => void;
  runsCount: number;
  historyOpen: boolean;
  onToggleHistory: () => void;
  result: RunResult | null;
  error: string | null;
}) {
  const s = sched.lastSummary;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md border border-stone-200 bg-paper/60 px-3 py-2 text-sm text-steel">
      <span className="flex items-center gap-1.5 font-medium text-ink">
        <Clock size={14} className="text-coral" /> {t("clock")}
      </span>
      {/* DATA4 — without the Claude CLI the pass still runs but every draft is
          a deterministic fallback that LOOKS like AI output; say so where the
          automation is controlled, not only in server logs. */}
      {engines && !engines.claudeCli ? (
        <span
          role="status"
          title={t("fallbackEngineTitle")}
          className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-sm font-medium text-amber-700"
        >
          <AlertTriangle size={12} className="shrink-0" aria-hidden /> {t("fallbackEngine")}
        </span>
      ) : null}
      <button
        type="button"
        onClick={onToggleEnabled}
        disabled={busy}
        className={`focus-ring inline-flex h-7 items-center rounded-full px-2.5 text-sm font-semibold ${
          sched.enabled ? "bg-moss/15 text-moss" : "bg-stone-200 text-steel"
        }`}
        title={t("toggleTitle")}
      >
        {sched.enabled ? t("on") : t("off")}
      </button>
      {/* The switch is installation-wide (one schedule row, phase-1 tenancy): flipping
          it starts or stops automation for every team, not just this one. The route
          declares that as `scheduleScope`; render it as a caption rather than leaving
          the blast radius implicit. */}
      {scheduleScope === "global" ? (
        <span className="rounded-full bg-stone-100 px-1.5 py-0.5 text-xs text-steel" title={t("scopeGlobalTitle")}>
          {t("scopeGlobal")}
        </span>
      ) : null}
      <label className="flex items-center gap-1">
        {t("every")}
        <input
          type="number"
          min={1}
          max={1440}
          value={intervalDraft}
          disabled={busy}
          aria-label={t("intervalAria")}
          onChange={(e) => onIntervalChange(e.target.value)}
          onFocus={onIntervalFocus}
          onBlur={(e) => onIntervalBlur(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          className="focus-ring w-14 rounded border border-stone-200 bg-white px-1 py-0.5 text-center text-ink caret-coral nums"
        />
        {t("min")}
      </label>
      {/* AUTO1 retired (UAT M6 / GDPR Art. 22): a clock-computed rejection is always
          QUEUED for a human click on the Decisions gate — never applied unattended —
          so the candidate disclosure ("nothing adverse is decided automatically")
          holds. It's now a stated fact, not an operator-selectable mode. */}
      <span className="flex items-center gap-1" title={t("rejectModeTitle")}>
        {t("rejectModeLabel")}
        <span className="font-medium text-ink">{t("rejectModeApprove")}</span>
      </span>
      {sched.lastRunAt ? (
        <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>{t("lastAutoRun", { time: relativeTime(sched.lastRunAt) })}</span>
          {s ? <SummaryBadges summary={s} /> : null}
        </span>
      ) : (
        <span>{t("neverRun")}</span>
      )}
      <button
        type="button"
        onClick={onRunNow}
        disabled={busy}
        className="focus-ring ml-auto inline-flex items-center gap-1.5 rounded-md border border-stone-200 px-2 py-0.5 text-sm hover:bg-stone-50 disabled:opacity-50"
        title={t("runNowTitle")}
      >
        {busy ? <Loader2 size={14} className="animate-spin" /> : null}
        {busy ? t("running") : t("runNow")}
      </button>
      {runsCount > 0 ? (
        <button
          type="button"
          onClick={onToggleHistory}
          aria-expanded={historyOpen}
          className="focus-ring inline-flex items-center gap-1 rounded-md border border-stone-200 px-2 py-0.5 text-sm hover:bg-stone-50"
          title={t("historyTitle")}
        >
          <History size={13} aria-hidden /> {t("history", { count: runsCount })}
        </button>
      ) : null}
      {result ? (
        <span
          role="status"
          title={result.tone === "error" ? result.text : undefined}
          className={`inline-flex max-w-[15rem] items-center truncate rounded-full px-2 py-0.5 text-xs font-semibold ${RESULT_TONE[result.tone]}`}
        >
          {result.text}
        </span>
      ) : null}
      {error ? (
        <span
          role="status"
          title={error}
          className="inline-flex max-w-[15rem] items-center gap-1 truncate text-xs font-semibold text-coral"
        >
          <AlertTriangle size={14} className="shrink-0" /> {error}
        </span>
      ) : null}
    </div>
  );
}
