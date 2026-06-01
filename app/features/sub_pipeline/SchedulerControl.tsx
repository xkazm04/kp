"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, ArrowUpRight, Clock, Loader2, Pause, XCircle } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Badge, type BadgeTone } from "@/app/_components/Badge";
import { relativeTime } from "./PipelineTypes";

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

// Turn a tick outcome into a short, legible chip: the real summary on success,
// a neutral "nothing due" no-op, or the error message verbatim.
function describeTick(tick: Tick): RunResult {
  if (tick.error) return { tone: "error", text: tick.error };
  if (!tick.ran) return { tone: "neutral", text: "nothing due" };
  const s = tick.summary ?? {};
  const parts: string[] = [];
  if (s.advanced) parts.push(`${s.advanced} advanced`);
  if (s.rejected) parts.push(`${s.rejected} rejected`);
  if (s.held) parts.push(`${s.held} held`);
  if (s.alerts) parts.push(`${s.alerts} alert${s.alerts === 1 ? "" : "s"}`);
  return { tone: "ok", text: parts.length ? `ran · ${parts.join(", ")}` : "ran · no changes" };
}

// The four buckets a policy pass moves entries into, tone-coded so the last-run
// row reads at a glance — and so `held` (tracked by the backend, AutomationSummary)
// is shown instead of silently dropped. Zero counts render dimmed (Badge.muted).
const SUMMARY_COUNTS: { key: keyof Summary; tone: BadgeTone; icon: LucideIcon; label: (n: number) => string }[] = [
  { key: "advanced", tone: "positive", icon: ArrowUpRight, label: (n) => `${n} advanced` },
  { key: "rejected", tone: "critical", icon: XCircle, label: (n) => `${n} rejected` },
  { key: "held", tone: "neutral", icon: Pause, label: (n) => `${n} held` },
  { key: "alerts", tone: "caution", icon: AlertTriangle, label: (n) => `${n} alert${n === 1 ? "" : "s"}` },
];

// Render the last-run summary as semantic badges (one per bucket), every count
// through the shared Badge so outcomes look identical to the rest of the pipeline.
function SummaryBadges({ summary }: { summary: Summary }) {
  return (
    <>
      {SUMMARY_COUNTS.map(({ key, tone, icon, label }) => {
        const n = summary[key] ?? 0;
        return (
          <Badge
            key={key}
            tone={tone}
            icon={icon}
            muted={n === 0}
            label={label(n)}
            ariaLabel={`${label(n)} this run`}
            className="nums"
          />
        );
      })}
    </>
  );
}

// Direction #5 — control + status for the automation clock (the durable
// scheduler that runs the Task-7 policy pass on a cadence). Disabled by default.
export function SchedulerControl({ onRan }: { onRan?: () => void }) {
  const [sched, setSched] = useState<Schedule | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Draft string for the interval field so the user can clear/retype freely — a
  // number-bound input can't hold an empty string. Parsed + clamped on blur.
  const [intervalDraft, setIntervalDraft] = useState("");

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
      .catch(() => setError("Couldn't reach the automation engine."));

  useEffect(() => {
    load();
    const h = setInterval(load, 30_000);
    return () => clearInterval(h);
  }, []);

  // Mirror the persisted cadence into the editable field on initial load, the 30s
  // poll, and the clamped value a POST echoes back. Keyed on the stored value so it
  // only fires when that actually changes — it won't clobber what you're typing.
  useEffect(() => {
    if (sched) setIntervalDraft(String(sched.intervalMinutes));
  }, [sched?.intervalMinutes]);

  // Auto-dismiss the "Run now" result chip a few seconds after it appears.
  useEffect(() => {
    if (!result) return;
    const h = setTimeout(() => setResult(null), 5_000);
    return () => clearTimeout(h);
  }, [result]);

  const update = async (body: { enabled?: boolean; intervalMinutes?: number; tick?: boolean }) => {
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
        else setResult({ tone: "error", text: typeof p.error === "string" ? p.error : "Run failed" });
      }
    } catch (e) {
      const msg = e instanceof Error && e.message ? e.message : "network error";
      // Tick failures surface in the run-result chip; config failures (toggle /
      // interval) get the inline error so the bar can't fail silently.
      if (body.tick) setResult({ tone: "error", text: `Run failed — ${msg}` });
      else setError(`Couldn't update the schedule — ${msg}`);
    } finally {
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
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md border border-stone-200 bg-paper/60 px-3 py-2 text-sm text-steel">
        <span className="flex items-center gap-1.5 font-medium text-ink">
          <Clock size={14} className="text-coral" /> Automation clock
        </span>
        <span role="status" className="inline-flex items-center gap-1 font-medium text-coral">
          <AlertTriangle size={14} className="shrink-0" /> {error}
        </span>
      </div>
    );
  }
  const s = sched.lastSummary;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md border border-stone-200 bg-paper/60 px-3 py-2 text-sm text-steel">
      <span className="flex items-center gap-1.5 font-medium text-ink">
        <Clock size={14} className="text-coral" /> Automation clock
      </span>
      <button
        type="button"
        onClick={() => update({ enabled: !sched.enabled })}
        disabled={busy}
        className={`focus-ring inline-flex h-7 items-center rounded-full px-2.5 text-sm font-semibold ${
          sched.enabled ? "bg-moss/15 text-moss" : "bg-stone-200 text-steel"
        }`}
        title="Run the deterministic policy pass automatically on a timer"
      >
        {sched.enabled ? "On" : "Off"}
      </button>
      <label className="flex items-center gap-1">
        every
        <input
          type="number"
          min={1}
          max={1440}
          value={intervalDraft}
          disabled={busy}
          aria-label="Automation interval in minutes (1–1440)"
          onChange={(e) => setIntervalDraft(e.target.value)}
          onBlur={(e) => commitInterval(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          className="focus-ring w-14 rounded border border-stone-200 px-1 py-0.5 text-center nums"
        />
        min
      </label>
      {sched.lastRunAt ? (
        <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>· last auto-run {relativeTime(sched.lastRunAt)}</span>
          {s ? <SummaryBadges summary={s} /> : null}
        </span>
      ) : (
        <span>· never run yet</span>
      )}
      <button
        type="button"
        onClick={() => update({ tick: true })}
        disabled={busy}
        className="focus-ring ml-auto inline-flex items-center gap-1.5 rounded-md border border-stone-200 px-2 py-0.5 text-sm hover:bg-stone-50 disabled:opacity-50"
        title="Force a scheduler run now (logged to the run history)"
      >
        {busy ? <Loader2 size={14} className="animate-spin" /> : null}
        {busy ? "Running…" : "Run now"}
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
