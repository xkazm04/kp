"use client";

// The scheduler's main control row: clock label, the no-CLI fallback badge, the
// enabled toggle, the interval field, the fixed "reject → queued for approval"
// note, the last-run summary, "Run now", the history toggle, and the run-result /
// error chips. Split out of SchedulerControl.tsx.

import type { SchedulerTranslator } from "./pipelineTranslator";
import { AlertTriangle, Clock, History, Loader2 } from "lucide-react";
import type { EngineAvailability } from "@/app/_lib/engine-preflight";
import type { SchedulerLiveness } from "@/app/_lib/scheduler-health";
import { BTN_SECONDARY, CHIP_QUIET, FIELD } from "@/app/_components/ui/recipes";
import { RESULT_TONE, SummaryBadges, type Schedule, type RunResult } from "./SchedulerSummaryBadges";
import { INTERVAL_MAX_MINUTES, INTERVAL_MIN_MINUTES, enabledPillTone, livenessChip } from "./schedulerRunState";

// The ON/OFF pill's three states. `degraded` is the one that did not exist: ARMED
// but not ticking. It must not be moss-green, or it argues with the chip beside it.
const PILL_TONE: Record<"on" | "off" | "degraded", string> = {
  on: "bg-moss/15 text-moss",
  off: "bg-stone-200 text-steel",
  degraded: "bg-amber-50 text-amber-700",
};

// Liveness chip tones. `warn` is a clock that is arming (no heartbeat yet inside the
// boot grace); `danger` is one that has stopped.
const LIVENESS_TONE: Record<"ok" | "warn" | "danger", string> = {
  ok: "bg-moss/15 text-moss",
  warn: "bg-amber-50 text-amber-700",
  danger: "bg-coral/10 text-coral",
};

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
  liveness,
  livenessReason,
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
  /** Is the tick CHAIN alive, as opposed to the flag being on? Null when the
   *  server did not say (an older payload) — the chip then renders nothing. */
  liveness: SchedulerLiveness | null;
  /** The server's own English sentence naming what is wrong; carried as the chip's
   *  title so an operator can copy it into a bug report, never as the label. */
  livenessReason: string | null;
}) {
  const s = sched.lastSummary;
  const live = livenessChip(sched.enabled, liveness);
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
        className={`focus-ring inline-flex h-7 items-center rounded-full px-2.5 text-sm font-semibold ${PILL_TONE[enabledPillTone(sched.enabled, liveness)]}`}
        title={t("toggleTitle")}
      >
        {sched.enabled ? t("on") : t("off")}
      </button>
      {/* LIVENESS — the flag says ARMED; this says whether the clock is still
          TICKING. schedulerLiveness() has judged that from the heartbeat since
          bug-ui-scan-2026-07-09, but only the health/ops probes read it, so this
          bar showed a green "On" over a chain that had stopped hours ago. A
          stalled armed clock can no longer read green here (schedulerRunState.ts,
          unit-pinned). */}
      {live ? (
        <span
          role="status"
          title={livenessReason ?? undefined}
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-sm font-semibold ${LIVENESS_TONE[live.tone]}`}
        >
          {live.tone === "danger" ? <AlertTriangle size={12} className="shrink-0" aria-hidden /> : null}
          {t(live.labelKey)}
        </span>
      ) : null}
      {/* The switch is installation-wide (one schedule row, phase-1 tenancy): flipping
          it starts or stops automation for every team, not just this one. The route
          declares that as `scheduleScope`; render it as a caption rather than leaving
          the blast radius implicit. */}
      {scheduleScope === "global" ? (
        <span className={CHIP_QUIET} title={t("scopeGlobalTitle")}>
          {t("scopeGlobal")}
        </span>
      ) : null}
      <label className="flex items-center gap-1">
        {t("every")}
        <input
          type="number"
          min={INTERVAL_MIN_MINUTES}
          max={INTERVAL_MAX_MINUTES}
          value={intervalDraft}
          disabled={busy}
          aria-label={t("intervalAria")}
          onChange={(e) => onIntervalChange(e.target.value)}
          onFocus={onIntervalFocus}
          onBlur={(e) => onIntervalBlur(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          className={`focus-ring ${FIELD} w-16 px-1 py-0.5 text-center text-sm nums`}
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
        className={`${BTN_SECONDARY} ml-auto h-7 px-2.5 text-sm`}
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
          className={`${BTN_SECONDARY} h-7 px-2.5 text-sm`}
          title={t("historyTitle")}
        >
          <History size={13} aria-hidden /> {t("history", { count: runsCount })}
        </button>
      ) : null}
      {result ? (
        <span
          role="status"
          title={result.tone === "error" ? result.text : undefined}
          className={`inline-flex max-w-[15rem] items-center truncate rounded-full px-2 py-0.5 text-sm font-semibold ${RESULT_TONE[result.tone]}`}
        >
          {result.text}
        </span>
      ) : null}
      {error ? (
        <span
          role="status"
          title={error}
          className="inline-flex max-w-[15rem] items-center gap-1 truncate text-sm font-semibold text-coral"
        >
          <AlertTriangle size={14} className="shrink-0" /> {error}
        </span>
      ) : null}
    </div>
  );
}
