"use client";

// SchedulerControl's data + update plumbing: load/poll the schedule + reminders
// job, run a manual tick, and commit the interval field. Split out of
// SchedulerControl.tsx so the component file is just wiring + markup.

import type { SchedulerTranslator } from "./pipelineTranslator";
import { useEffect, useRef, useState } from "react";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import type { SchedulerLiveness } from "@/app/_lib/scheduler-health";
import { type RunResult, type Schedule, type SchedulerRun, type Tick } from "./SchedulerSummaryBadges";
import { POLL_BASE_MS, clampInterval, describeTick, nextPollDelay } from "./schedulerRunState";

export function useSchedulerControlState(t: SchedulerTranslator, onRan?: () => void) {
  // API failures resolve from the machine `code`, not the server's English
  // `error` — see app/_lib/use-error-message.ts.
  const errMsg = useErrorMessage();
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
  // LIVENESS — is the tick chain still ALIVE, as opposed to merely ARMED? The route
  // now answers schedulerLiveness()'s verdict from the clock heartbeat; the toolbar
  // renders it beside the flag so a stalled armed clock can no longer read green.
  const [liveness, setLiveness] = useState<SchedulerLiveness | null>(null);
  const [livenessReason, setLivenessReason] = useState<string | null>(null);
  // Draft string for the interval field so the user can clear/retype freely — a
  // number-bound input can't hold an empty string. Parsed + clamped on blur.
  const [intervalDraft, setIntervalDraft] = useState("");
  // Single-flight: the toggle, interval-commit, and "Run now" all call update().
  // `busy` disables the controls, but two near-simultaneous clicks can launch before
  // it renders — this ref blocks a concurrent update() synchronously.
  const inFlightRef = useRef(false);
  // Consecutive failed reads — the input to the poll's backoff curve (see below).
  const failuresRef = useRef(0);
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
        setLiveness((p.liveness as SchedulerLiveness | null) ?? null);
        setLivenessReason(typeof p.livenessReason === "string" ? p.livenessReason : null);
        failuresRef.current = 0; // a good read resets the backoff curve
        setError(null);
      })
      .catch(() => {
        if (gen !== writeGenRef.current) return; // a superseded poll's failure isn't the current truth
        failuresRef.current += 1;
        setError(t("engineUnreachable"));
      });
  };

  // The poll had no visibility gate and no backoff: every open tab re-read the
  // schedule every 30s forever, including tabs nobody was looking at and engines
  // that had been answering 500 for an hour (120 failing requests/hour/tab). Two
  // rules, both pure and unit-pinned in schedulerRunState.ts:
  //   - a HIDDEN document polls not at all, and refreshes ONCE on becoming visible
  //     (so the bar an operator comes back to is current, not 30s stale) — the same
  //     `document.hidden` gate the board's own poll uses (usePipelineBoardData);
  //   - consecutive failures back the cadence off 30s -> 60s -> 2m -> 4m -> 5m, and
  //     one success resets it, so a down engine is not hammered and a recovered one
  //     is picked up without a reload.
  // A self-rescheduling timeout rather than setInterval, because the delay changes.
  const loadRef = useRef(load);
  // Kept current in an effect, not during render: `load` closes over t/errMsg and
  // is re-created every render, and the poll must always call the latest one.
  useEffect(() => {
    loadRef.current = load;
  });
  useEffect(() => {
    let timer: number | undefined;
    let stopped = false;
    const arm = () => {
      if (stopped) return;
      timer = window.setTimeout(
        async () => {
          if (!document.hidden) await loadRef.current();
          arm();
        },
        document.hidden ? POLL_BASE_MS : nextPollDelay(failuresRef.current)
      );
    };
    const onVisible = () => {
      if (document.hidden) return;
      failuresRef.current = 0; // a deliberate return to the tab deserves a fresh try
      void loadRef.current();
      if (timer !== undefined) window.clearTimeout(timer);
      arm();
    };
    void loadRef.current();
    arm();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      if (timer !== undefined) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
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
      setLiveness((p.liveness as SchedulerLiveness | null) ?? null);
      setLivenessReason(typeof p.livenessReason === "string" ? p.livenessReason : null);
      setError(null);
      if (body.tick) {
        onRan?.();
        if (p.tick) setResult(describeTick(p.tick as Tick, t));
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

  // Parse + clamp (clampInterval, unit-pinned in schedulerRunState.ts) and commit.
  // Empty / 0 / NaN are "no change" and snap back to the current cadence; the clamp
  // is reflected in the field immediately, not on the next poll, so it never shows a
  // value the engine won't honor.
  const commitInterval = (raw: string) => {
    if (!sched) return;
    const clamped = clampInterval(raw, sched.intervalMinutes);
    setIntervalDraft(String(clamped));
    if (clamped !== sched.intervalMinutes) update({ intervalMinutes: clamped });
  };

  return {
    sched, reminders, reminderRuns, busy, result, error,
    runs, historyOpen, setHistoryOpen, scheduleScope, liveness, livenessReason,
    intervalDraft, setIntervalDraft, setIntervalFocused,
    update, commitInterval,
  };
}
