"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowUpRight, Clock, Loader2, Pause, XCircle } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge, type BadgeTone } from "@/app/_components/Badge";
import { useRelativeTime } from "./PipelineShared";

type Summary = { advanced?: number; rejected?: number; held?: number; alerts?: number };
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
export function SchedulerControl({ onRan, className = "" }: { onRan?: () => void; className?: string }) {
  const t = useTranslations("pipeline.scheduler");
  const relativeTime = useRelativeTime();
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
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
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

  const update = async (body: { enabled?: boolean; intervalMinutes?: number; tick?: boolean }) => {
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
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md border border-stone-200 bg-paper/60 px-3 py-2 text-sm text-steel ${className}`}>
      <span className="flex items-center gap-1.5 font-medium text-ink">
        <Clock size={14} className="text-coral" /> {t("clock")}
      </span>
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
          className="focus-ring w-14 rounded border border-stone-200 px-1 py-0.5 text-center nums"
        />
        {t("min")}
      </label>
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
