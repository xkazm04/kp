"use client";

import { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { relativeTime } from "./PipelineTypes";

type Summary = { advanced?: number; rejected?: number; held?: number; alerts?: number };
type Schedule = {
  enabled: boolean;
  intervalMinutes: number;
  lastRunAt: string | null;
  lastSummary: Summary | null;
};

// Direction #5 — control + status for the automation clock (the durable
// scheduler that runs the Task-7 policy pass on a cadence). Disabled by default.
export function SchedulerControl({ onRan }: { onRan?: () => void }) {
  const [sched, setSched] = useState<Schedule | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () =>
    fetch("/api/automation/schedule")
      .then((r) => r.json())
      .then((p) => setSched(p.schedule as Schedule))
      .catch(() => undefined);

  useEffect(() => {
    load();
    const h = setInterval(load, 30_000);
    return () => clearInterval(h);
  }, []);

  const update = async (body: { enabled?: boolean; intervalMinutes?: number; tick?: boolean }) => {
    setBusy(true);
    try {
      const r = await fetch("/api/automation/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const p = await r.json();
      if (p.schedule) setSched(p.schedule as Schedule);
      if (body.tick) onRan?.();
    } finally {
      setBusy(false);
    }
  };

  if (!sched) return null;
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
          value={sched.intervalMinutes}
          disabled={busy}
          onChange={(e) => setSched({ ...sched, intervalMinutes: Number(e.target.value) || sched.intervalMinutes })}
          onBlur={(e) => update({ intervalMinutes: Number(e.target.value) || sched.intervalMinutes })}
          className="focus-ring w-14 rounded border border-stone-200 px-1 py-0.5 text-center"
        />
        min
      </label>
      {sched.lastRunAt ? (
        <span>
          · last auto-run {relativeTime(sched.lastRunAt)}
          {s ? ` · ${s.advanced ?? 0} advanced, ${s.rejected ?? 0} rejected, ${s.alerts ?? 0} alerts` : ""}
        </span>
      ) : (
        <span>· never run yet</span>
      )}
      <button
        type="button"
        onClick={() => update({ tick: true })}
        disabled={busy}
        className="focus-ring ml-auto rounded-md border border-stone-200 px-2 py-0.5 text-sm hover:bg-stone-50 disabled:opacity-50"
        title="Force a scheduler run now (logged to the run history)"
      >
        Run now
      </button>
    </div>
  );
}
