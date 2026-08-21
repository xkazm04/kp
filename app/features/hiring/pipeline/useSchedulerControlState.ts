"use client";

// SchedulerControl's data + update plumbing: load/poll the schedule + reminders
// job, run a manual tick, and commit the interval field. Split out of
// SchedulerControl.tsx so the component file is just wiring + markup.

import type { SchedulerTranslator } from "./pipelineTranslator";
import { useEffect, useRef, useState } from "react";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { SUMMARY_COUNTS, type RunResult, type Schedule, type SchedulerRun, type Tick } from "./SchedulerSummaryBadges";

export function useSchedulerControlState(t: SchedulerTranslator, onRan?: () => void) {
  // API failures resolve from the machine `code`, not the server's English
  // `error` — see app/_lib/use-error-message.ts.
  const errMsg = useErrorMessage();
  // Turn a tick outcome into a short, legible chip: the real summary on success, a
  // neutral no-op, or the error verbatim. The per-bucket parts come from
  // SUMMARY_COUNTS so the chip and the badges never drift.
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
  // The clock's blast radius, as the route declares it (`scheduleScope`). It is "global"
  // by design in phase 1 — one schedule row for the whole installation behind
  // requireOperator — so flipping this toggle stops or starts automation for EVERY team.
  // The button gave no hint of that; the caption in the toolbar states it.
  const [scheduleScope, setScheduleScope] = useState<string | null>(null);
  // Draft string for the interval field so the user can clear/retype freely — a
  // number-bound input can't hold an empty string. Parsed + clamped on blur.
  const [intervalDraft, setIntervalDraft] = useState("");
  // Single-flight: the toggle, interval-commit, and "Run now" all call update().
  // `busy` disables the controls, but two near-simultaneous clicks can launch before
  // it renders — this ref blocks a concurrent update() synchronously.
  const inFlightRef = useRef(false);
  // The 30s poll and update() are the TWO writers of sched/runs/reminders, and the poll
  // has no way to notice that a write landed while its GET was in flight. A GET issued
  // just before the operator flips the toggle carries PRE-write data, so committing it
  // AFTER the POST snapped the switch back to the value they just changed — reading as
  // "the click didn't take" — and the honest state was 30s away. So each load() stamps
  // the write generation it started under and commits nothing once that generation is
  // stale. update() bumps it as it fires AND when it settles, so exactly the responses
  // that were in flight ACROSS a write are dropped; every later poll commits normally.
  const writeGenRef = useRef(0);
  // True while the interval field is focused, so the 30s poll's render-phase mirror
  // doesn't overwrite what the operator is mid-typing.
  const [intervalFocused, setIntervalFocused] = useState(false);

  const load = () => {
    const gen = writeGenRef.current;
    return fetch("/api/automation/schedule")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((p) => {
        if (gen !== writeGenRef.current) return; // a write landed meanwhile — this payload predates it
        setSched(p.schedule as Schedule);
        if (Array.isArray(p.runs)) setRuns(p.runs as SchedulerRun[]);
        if (p.reminders) setReminders(p.reminders as Schedule);
        if (Array.isArray(p.reminderRuns)) setReminderRuns(p.reminderRuns as SchedulerRun[]);
        if (typeof p.scheduleScope === "string") setScheduleScope(p.scheduleScope);
        setError(null);
      })
      .catch(() => {
        if (gen !== writeGenRef.current) return; // a superseded poll's failure isn't the current truth
        setError(t("engineUnreachable"));
      });
  };

  useEffect(() => {
    load();
    const h = setInterval(load, 30_000);
    return () => clearInterval(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    writeGenRef.current += 1; // any poll already in flight now carries pre-write data
    setBusy(true);
    if (body.tick) setResult(null); // clear any stale chip before a fresh run
    try {
      const r = await fetch("/api/automation/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const p = await r.json();
      if (!r.ok) throw new Error(errMsg(p, t("updateFailed", { msg: `HTTP ${r.status}` })));
      if (p.schedule) setSched(p.schedule as Schedule);
      if (Array.isArray(p.runs)) setRuns(p.runs as SchedulerRun[]);
      if (p.reminders) setReminders(p.reminders as Schedule);
      if (Array.isArray(p.reminderRuns)) setReminderRuns(p.reminderRuns as SchedulerRun[]);
      if (typeof p.scheduleScope === "string") setScheduleScope(p.scheduleScope);
      setError(null);
      if (body.tick) {
        onRan?.();
        if (p.tick) setResult(describeTick(p.tick as Tick));
        else setResult({ tone: "error", text: errMsg(p, t("runFailed")) });
      }
    } catch (e) {
      const msg = e instanceof Error && e.message ? e.message : t("networkError");
      // Tick failures surface in the run-result chip; config failures (toggle /
      // interval) get the inline error so the bar can't fail silently.
      if (body.tick) setResult({ tone: "error", text: t("runFailedMsg", { msg }) });
      else setError(t("updateFailed", { msg }));
    } finally {
      // A poll that STARTED mid-write also predates the committed result, so bump
      // again on settle rather than only on fire.
      writeGenRef.current += 1;
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

  return {
    sched, reminders, reminderRuns, busy, result, error,
    runs, historyOpen, setHistoryOpen, scheduleScope,
    intervalDraft, setIntervalDraft, setIntervalFocused,
    update, commitInterval,
  };
}
