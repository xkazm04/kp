"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowUpRight, BellRing, Clock, History, Loader2, Pause, XCircle } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge, type BadgeTone } from "@/app/_components/Badge";
import { useDeliveryCapability } from "@/app/features/useDeliveryCapability";
import { useEngineAvailability } from "@/app/features/useEngineAvailability";
import { deriveDecisionOutcome, type DecisionOutcome } from "@/app/_lib/decision-attribution";
import { isCurrentRunError } from "@/app/_lib/scheduler-health";
import { useRelativeTime } from "./PipelineShared";

type Summary = { advanced?: number; rejected?: number; held?: number; alerts?: number; errors?: number; evaluated?: number };
// AUTO2 — the persisted per-run record the schedule GET has always returned
// (and this component ignored): trigger/status/summary plus the decision rows
// the pass used to compute and discard.
type RunDecision = { entryId?: string; action?: string; reason?: string; outcome?: string };
type SchedulerRun = {
  id: number;
  trigger: string;
  status: string;
  summary: Summary | null;
  decisions: RunDecision[] | null;
  error: string | null;
  startedAt: string;
};
type Schedule = {
  enabled: boolean;
  intervalMinutes: number;
  lastRunAt: string | null;
  lastSummary: Summary | null;
};
// Mirrors tickScheduler()'s return shape (scheduler.ts) as forwarded by the POST route.
type Tick = { ran: boolean; summary?: Summary | null; error?: string };
type RunResult = { tone: "ok" | "neutral" | "error"; text: string };

const RESULT_TONE: Record<RunResult["tone"], string> = {
  ok: "bg-moss/15 text-moss",
  neutral: "bg-stone-100 text-steel",
  error: "bg-coral/10 text-coral",
};

// Per-decision outcome chip — failed / CAS-skipped / fairness-refused / queued
// states the action badge alone can't convey (a failed REJECT used to render
// exactly like an applied one, and skips were dropped from the list entirely).
const OUTCOME_STYLE: Record<DecisionOutcome, string> = {
  applied: "",
  failed: "bg-coral/10 text-coral",
  skipped: "bg-stone-100 text-steel",
  fairness_blocked: "bg-amber-50 text-amber-700",
  queued: "bg-stone-100 text-steel",
};

function OutcomeChip({ outcome }: { outcome: DecisionOutcome }) {
  const t = useTranslations("pipeline.scheduler");
  return (
    <span className={`mr-1 inline-flex items-center gap-0.5 rounded px-1 py-0.5 font-semibold uppercase ${OUTCOME_STYLE[outcome]}`}>
      {outcome === "failed" ? <XCircle size={10} aria-hidden /> : null}
      {outcome === "fairness_blocked" ? <AlertTriangle size={10} aria-hidden /> : null}
      {t(`outcome.${outcome}` as Parameters<typeof t>[0])}
    </span>
  );
}

// The four buckets a policy pass moves entries into, tone-coded so the last-run
// row reads at a glance — and so `held` (tracked by the backend, AutomationSummary)
// is shown instead of silently dropped. Zero counts render dimmed (Badge.muted).
// This is the ONE table of buckets: both the badge row (SummaryBadges) and the
// "Run now" chip (describeTick) are driven from it, so adding a fifth outcome is a
// single-line change that can't leave the two summaries out of sync.
// The per-bucket presentation; the human label is localized via the
// `pipeline.scheduler` catalog (labelKey), so the chip and the badges never drift.
const SUMMARY_COUNTS: { key: keyof Summary; tone: BadgeTone; icon: LucideIcon; labelKey: string }[] = [
  { key: "advanced", tone: "positive", icon: ArrowUpRight, labelKey: "summaryAdvanced" },
  { key: "rejected", tone: "critical", icon: XCircle, labelKey: "summaryRejected" },
  { key: "held", tone: "neutral", icon: Pause, labelKey: "summaryHeld" },
  { key: "alerts", tone: "caution", icon: AlertTriangle, labelKey: "summaryAlerts" },
  // AUTO2 — apply failures were tracked by the backend and invisible here.
  { key: "errors", tone: "critical", icon: AlertTriangle, labelKey: "summaryErrors" },
];

// Render the last-run summary as semantic badges (one per bucket), every count
// through the shared Badge so outcomes look identical to the rest of the pipeline.
function SummaryBadges({ summary }: { summary: Summary }) {
  const t = useTranslations("pipeline.scheduler");
  return (
    <>
      {SUMMARY_COUNTS.map(({ key, tone, icon, labelKey }) => {
        const n = summary[key] ?? 0;
        const label = t(labelKey as Parameters<typeof t>[0], { n });
        return (
          <Badge
            key={key}
            tone={tone}
            icon={icon}
            muted={n === 0}
            label={label}
            ariaLabel={t("thisRun", { label })}
            className="nums"
          />
        );
      })}
    </>
  );
}

// Direction #5 — control + status for the automation clock (the durable
// scheduler that runs the Task-7 policy pass on a cadence). Disabled by default.
export function SchedulerControl({
  onRan,
  className = "",
  labelFor,
}: {
  onRan?: () => void;
  className?: string;
  /** AUTO2 — resolve a decision row's entryId to a candidate label (the board
   *  already holds the entries); falls back to the raw id when absent. */
  labelFor?: (entryId: string) => string | undefined;
}) {
  const t = useTranslations("pipeline.scheduler");
  const relativeTime = useRelativeTime();
  // DATA4 — flag the silent-fallback mode (no Claude CLI on PATH) at the
  // surface that triggers the automation.
  const engines = useEngineAvailability();
  // REC-10 — "{n} sent" for reminder sweeps only reads as delivered when a
  // relay exists; without one those sends are terminal outbox rows.
  const relayConfigured = useDeliveryCapability();
  // Turn a tick outcome into a short, legible chip: the real summary on success, a
  // neutral no-op, or the error verbatim. The per-bucket parts come from
  // SUMMARY_COUNTS so the chip and the badges never drift. Local (not module) so
  // it can read the request locale.
  const describeTick = (tick: Tick): RunResult => {
    if (tick.error) return { tone: "error", text: tick.error };
    if (!tick.ran) return { tone: "neutral", text: t("nothingDue") };
    const s = tick.summary ?? {};
    const parts = SUMMARY_COUNTS.filter(({ key }) => s[key]).map(({ key, labelKey }) =>
      t(labelKey as Parameters<typeof t>[0], { n: s[key] ?? 0 })
    );
    return { tone: "ok", text: parts.length ? t("ranWith", { parts: parts.join(", ") }) : t("ranNoChanges") };
  };
  const [sched, setSched] = useState<Schedule | null>(null);
  // AUTO6 — the reminders job (second scheduler row) + its recent send runs.
  const [reminders, setReminders] = useState<Schedule | null>(null);
  const [reminderRuns, setReminderRuns] = useState<SchedulerRun[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  // AUTO2 — run history (already on every schedule GET; previously discarded).
  const [runs, setRuns] = useState<SchedulerRun[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  // Draft string for the interval field so the user can clear/retype freely — a
  // number-bound input can't hold an empty string. Parsed + clamped on blur.
  const [intervalDraft, setIntervalDraft] = useState("");
  // Single-flight: the toggle, interval-commit, and "Run now" all call update().
  // `busy` disables the controls, but two near-simultaneous clicks can launch before
  // it renders — this ref blocks a concurrent update() synchronously.
  const inFlightRef = useRef(false);
  // True while the interval field is focused, so the 30s poll's render-phase mirror
  // doesn't overwrite what the operator is mid-typing.
  // Whether the interval input has focus — state (not a ref) so the render-phase mirror below
  // can read it without accessing a ref during render. Focus/blur are infrequent, so the extra
  // render is immaterial.
  const [intervalFocused, setIntervalFocused] = useState(false);

  const load = () =>
    fetch("/api/automation/schedule")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((p) => {
        setSched(p.schedule as Schedule);
        if (Array.isArray(p.runs)) setRuns(p.runs as SchedulerRun[]);
        if (p.reminders) setReminders(p.reminders as Schedule);
        if (Array.isArray(p.reminderRuns)) setReminderRuns(p.reminderRuns as SchedulerRun[]);
        setError(null);
      })
      .catch(() => setError(t("engineUnreachable")));

  useEffect(() => {
    load();
    const h = setInterval(load, 30_000);
    return () => clearInterval(h);
  }, []);

  // Mirror the persisted cadence into the editable field on initial load, the 30s
  // poll, and the clamped value a POST echoes back. Guarded render-phase
  // adjustment keyed on the stored value, so it only fires when that actually
  // changes — it won't clobber what you're typing.
  const [mirroredInterval, setMirroredInterval] = useState<number | null>(null);
  if (sched && sched.intervalMinutes !== mirroredInterval && !intervalFocused) {
    setMirroredInterval(sched.intervalMinutes);
    setIntervalDraft(String(sched.intervalMinutes));
  }

  // Auto-dismiss the "Run now" result chip a few seconds after it appears.
  useEffect(() => {
    if (!result) return;
    const h = setTimeout(() => setResult(null), 5_000);
    return () => clearTimeout(h);
  }, [result]);

  const update = async (body: { enabled?: boolean; intervalMinutes?: number; tick?: boolean; remindersEnabled?: boolean }) => {
    if (inFlightRef.current) return; // a concurrent schedule op is already running
    inFlightRef.current = true;
    setBusy(true);
    if (body.tick) setResult(null); // clear any stale chip before a fresh run
    try {
      const r = await fetch("/api/automation/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const p = await r.json();
      if (!r.ok) throw new Error(typeof p?.error === "string" ? p.error : `HTTP ${r.status}`);
      if (p.schedule) setSched(p.schedule as Schedule);
      if (Array.isArray(p.runs)) setRuns(p.runs as SchedulerRun[]);
      if (p.reminders) setReminders(p.reminders as Schedule);
      if (Array.isArray(p.reminderRuns)) setReminderRuns(p.reminderRuns as SchedulerRun[]);
      setError(null);
      if (body.tick) {
        onRan?.();
        if (p.tick) setResult(describeTick(p.tick as Tick));
        else setResult({ tone: "error", text: typeof p.error === "string" ? p.error : t("runFailed") });
      }
    } catch (e) {
      const msg = e instanceof Error && e.message ? e.message : t("networkError");
      // Tick failures surface in the run-result chip; config failures (toggle /
      // interval) get the inline error so the bar can't fail silently.
      if (body.tick) setResult({ tone: "error", text: t("runFailedMsg", { msg }) });
      else setError(t("updateFailed", { msg }));
    } finally {
      inFlightRef.current = false;
      setBusy(false);
    }
  };

  // Parse, clamp to the engine's [1, 1440] window, and commit. Empty / 0 / NaN are
  // treated as "no change" and snap back to the current cadence, so the field never
  // shows a value the engine won't honor — and the clamp is reflected immediately,
  // not on the next 30s poll.
  const commitInterval = (raw: string) => {
    if (!sched) return;
    const parsed = Number(raw);
    const base = Number.isFinite(parsed) && parsed > 0 ? parsed : sched.intervalMinutes;
    const clamped = Math.max(1, Math.min(1440, Math.round(base)));
    setIntervalDraft(String(clamped));
    if (clamped !== sched.intervalMinutes) update({ intervalMinutes: clamped });
  };

  if (!sched) {
    // First load failed — show the bar with an error instead of vanishing.
    if (!error) return null;
    return (
      <div className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md border border-stone-200 bg-paper/60 px-3 py-2 text-sm text-steel ${className}`}>
        <span className="flex items-center gap-1.5 font-medium text-ink">
          <Clock size={14} className="text-coral" /> {t("clock")}
        </span>
        <span role="status" className="inline-flex items-center gap-1 font-medium text-coral">
          <AlertTriangle size={14} className="shrink-0" /> {error}
        </span>
      </div>
    );
  }
  const s = sched.lastSummary;

  return (
    <div className={className}>
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
        onClick={() => update({ enabled: !sched.enabled })}
        disabled={busy}
        className={`focus-ring inline-flex h-7 items-center rounded-full px-2.5 text-sm font-semibold ${
          sched.enabled ? "bg-moss/15 text-moss" : "bg-stone-200 text-steel"
        }`}
        title={t("toggleTitle")}
      >
        {sched.enabled ? t("on") : t("off")}
      </button>
      <label className="flex items-center gap-1">
        {t("every")}
        <input
          type="number"
          min={1}
          max={1440}
          value={intervalDraft}
          disabled={busy}
          aria-label={t("intervalAria")}
          onChange={(e) => setIntervalDraft(e.target.value)}
          onFocus={() => setIntervalFocused(true)}
          onBlur={(e) => {
            setIntervalFocused(false);
            commitInterval(e.target.value);
          }}
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
        onClick={() => update({ tick: true })}
        disabled={busy}
        className="focus-ring ml-auto inline-flex items-center gap-1.5 rounded-md border border-stone-200 px-2 py-0.5 text-sm hover:bg-stone-50 disabled:opacity-50"
        title={t("runNowTitle")}
      >
        {busy ? <Loader2 size={14} className="animate-spin" /> : null}
        {busy ? t("running") : t("runNow")}
      </button>
      {runs.length > 0 ? (
        <button
          type="button"
          onClick={() => setHistoryOpen((o) => !o)}
          aria-expanded={historyOpen}
          className="focus-ring inline-flex items-center gap-1 rounded-md border border-stone-200 px-2 py-0.5 text-sm hover:bg-stone-50"
          title={t("historyTitle")}
        >
          <History size={13} aria-hidden /> {t("history", { count: runs.length })}
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

    {/* AUTO2 — run history: what each pass did and WHY, per candidate. The
        decision rows were computed by every pass and discarded; now they're
        persisted with the run and answerable here days later. */}
    {historyOpen && runs.length > 0 ? (
      <div className="mt-1.5 rounded-md border border-stone-200 bg-white p-2 text-sm text-steel">
        <ol className="space-y-1">
          {runs.map((run) => {
            const decisions = Array.isArray(run.decisions) ? run.decisions : [];
            // "none" rows are CAS skips — near-misses the guard prevented. The
            // audit history must show them, not drop them (the old filter made a
            // prevented action indistinguishable from one that never existed).
            const acted = decisions.filter((d) => d.action && (d.action !== "none" || deriveDecisionOutcome(d) === "skipped"));
            return (
              <li key={run.id} className="rounded border border-stone-100 bg-paper/40 px-2 py-1">
                <details>
                  <summary className="focus-ring flex cursor-pointer flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-medium text-ink">{relativeTime(run.startedAt)}</span>
                    <span className="rounded-full bg-stone-100 px-1.5 py-0.5 text-xs font-semibold uppercase">
                      {t.has(`trigger.${run.trigger}` as Parameters<typeof t>[0])
                        ? t(`trigger.${run.trigger}` as Parameters<typeof t>[0])
                        : run.trigger}
                    </span>
                    {run.status === "error" ? (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-coral">
                        <XCircle size={12} aria-hidden /> {run.error ?? t("runFailed")}
                      </span>
                    ) : (
                      <span className="inline-flex flex-wrap items-center gap-1">
                        {run.summary ? <SummaryBadges summary={run.summary} /> : null}
                        {run.summary?.evaluated != null ? (
                          <span className="text-xs">{t("runEvaluated", { n: run.summary.evaluated })}</span>
                        ) : null}
                      </span>
                    )}
                  </summary>
                  {acted.length > 0 ? (
                    <ul className="mt-1 space-y-0.5 border-t border-stone-100 pt-1">
                      {acted.map((d, i) => {
                        const outcome = deriveDecisionOutcome(d);
                        return (
                          <li key={`${d.entryId}-${i}`} className="text-xs">
                            {d.action !== "none" ? (
                              <span
                                className={`mr-1 rounded px-1 py-0.5 font-semibold uppercase ${
                                  d.action === "reject"
                                    ? "bg-coral/10 text-coral"
                                    : d.action === "advance"
                                      ? "bg-moss/10 text-moss"
                                      : "bg-stone-100 text-steel"
                                }`}
                              >
                                {d.action}
                              </span>
                            ) : null}
                            {/* The outcome chip separates "landed" from failed /
                                CAS-skipped / fairness-refused — the rows an
                                auditor actually cares about. */}
                            {outcome !== "applied" ? <OutcomeChip outcome={outcome} /> : null}
                            <span className="font-medium text-ink">
                              {(d.entryId && labelFor?.(d.entryId)) ?? d.entryId ?? "—"}
                            </span>{" "}
                            <span className="text-steel">— {d.reason}</span>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="mt-1 border-t border-stone-100 pt-1 text-xs">{t("runNoActions")}</p>
                  )}
                </details>
              </li>
            );
          })}
        </ol>
      </div>
    ) : null}

    {/* AUTO6 — the second registered job: candidate interview reminders. The
        most candidate-visible automation finally shows it's alive (last sweep
        time), what it sent (latest run), and can be paused. */}
    {reminders ? (
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md border border-stone-200 bg-paper/40 px-3 py-1.5 text-sm text-steel">
        <span className="flex items-center gap-1.5 font-medium text-ink">
          <BellRing size={13} className="text-coral" aria-hidden /> {t("remindersJob")}
        </span>
        <button
          type="button"
          onClick={() => update({ remindersEnabled: !reminders.enabled })}
          disabled={busy}
          aria-pressed={reminders.enabled}
          className={`focus-ring inline-flex h-6 items-center rounded-full px-2.5 text-sm font-semibold ${
            reminders.enabled ? "bg-moss/15 text-moss" : "bg-stone-200 text-steel"
          }`}
          title={t("remindersToggleTitle")}
        >
          {reminders.enabled ? t("remindersOn") : t("remindersOff")}
        </button>
        <span>
          {reminders.lastRunAt
            ? t("remindersChecked", { time: relativeTime(reminders.lastRunAt) })
            : t("remindersNever")}
        </span>
        {/* OO-L2-15 — an error row renders as a live problem ONLY while it is
            current: recent (24h TTL) and not superseded by a later check
            (zero-send sweeps record no rows, so the newest ROW can be weeks old
            while last_run_at proves the job healthy). Current errors carry
            their timestamp so "failing" is never confused with "failed once,
            back in June". Historic errors fall through to the last-success line
            (or nothing) instead of masquerading as today's status. */}
        {reminderRuns[0] ? (
          isCurrentRunError(reminderRuns[0], { lastRunAt: reminders.lastRunAt }) ? (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-coral">
              <XCircle size={12} aria-hidden /> {reminderRuns[0].error ?? t("runFailed")}
              <span className="font-normal text-steel">· {relativeTime(reminderRuns[0].startedAt)}</span>
            </span>
          ) : reminderRuns[0].status !== "error" ? (
            <span className="text-xs">
              {t(relayConfigured === false ? "remindersLastQueued" : "remindersLastSent", {
                n: Number((reminderRuns[0].summary as { sent?: number } | null)?.sent ?? 0),
                time: relativeTime(reminderRuns[0].startedAt),
              })}
            </span>
          ) : null
        ) : null}
      </div>
    ) : null}
    </div>
  );
}
