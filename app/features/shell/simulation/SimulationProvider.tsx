"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { track } from "@/app/_lib/analytics/plausible";
import { buildUrl } from "@/app/features/shell/tabs";
import { IDLE_STATE, SLOW_FACTOR, SimStop, sleep, type SimCtx, type SimState } from "./simulationProviderTypes";
import { useSimulationEngine } from "./useSimulationEngine";
import { useSimulationWalk } from "./useSimulationWalk";

const Ctx = createContext<SimCtx | null>(null);
export const useSimulation = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error("useSimulation must be used within SimulationProvider");
  return c;
};

export function SimulationProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // The run-control statuses (starting / paused / reset) are the demo's own copy —
  // the tour is public (/?sim=auto from the localized landing CTA), so they must
  // never be the English literals they used to be.
  const t = useTranslations("simulation");
  const [state, setState] = useState<SimState>(IDLE_STATE);

  const ctrl = useRef<{ stop: boolean; paused: boolean; wake: (() => void) | null }>({ stop: false, paused: false, wake: null });
  // The in-flight run's promise, so reset() can wait for it to settle (and its last in-flight
  // mutation to finish) before deleting the SIM rows — otherwise a row-creating mutation
  // already awaiting could land AFTER the delete and re-orphan rows.
  const runPromiseRef = useRef<Promise<void> | null>(null);
  const stepRef = useRef<boolean>(true);

  // The latest committed query, read through a ref so the long-running walk's nav()
  // composes each patch off the CURRENT router state — not the stale value captured
  // when `run` was created, and not window.location (which next/navigation hasn't
  // updated yet mid-tick). useSearchParams re-renders on every committed navigation;
  // syncing it into a ref (post-commit) lets the frozen run() closure read the fresh
  // string. The walk awaits a `beat` between nav()s, so the effect always lands first.
  const searchRef = useRef(searchParams.toString());
  useEffect(() => {
    searchRef.current = searchParams.toString();
  }, [searchParams]);

  const patch = useCallback((p: Partial<SimState>) => setState((s) => ({ ...s, ...p })), []);
  const log = useCallback(
    (text: string) => setState((s) => ({ ...s, log: [...s.log, { at: Date.now(), text }].slice(-40) })),
    []
  );
  const nav = useCallback((updates: Record<string, string | null>) => router.replace(buildUrl(updates, searchRef.current), { scroll: false }), [router]);

  // Paced wait — paused time doesn't count; stop interrupts.
  const beat = useCallback(async (ms: number) => {
    const target = ms * SLOW_FACTOR;
    let elapsed = 0;
    while (elapsed < target) {
      if (ctrl.current.stop) throw new SimStop();
      if (ctrl.current.paused) {
        await sleep(120);
        continue;
      }
      await sleep(60);
      elapsed += 60;
    }
  }, []);

  // Checkpoint between phases — blocks for Resume (paused) or Next (step mode).
  const gate = useCallback(async () => {
    if (ctrl.current.stop) throw new SimStop();
    if (ctrl.current.paused || stepRef.current) {
      setState((s) => ({ ...s, awaitingNext: stepRef.current }));
      await new Promise<void>((res) => (ctrl.current.wake = res));
      ctrl.current.wake = null;
      setState((s) => ({ ...s, awaitingNext: false }));
      if (ctrl.current.stop) throw new SimStop();
    }
  }, []);

  // ---- Observation + real-click engine, and the scripted walk ----------------
  const engine = useSimulationEngine({ ctrl, patch, log, beat });
  const { run } = useSimulationWalk({ ctrl, patch, log, nav, beat, gate, engine });

  const start = useCallback(() => {
    ctrl.current = { stop: false, paused: false, wake: null };
    // Everything cleared to IDLE, then the run-starting overrides. stepMode is
    // preserved — it mirrors stepRef.current, the engine's source of truth.
    // explainOpen deliberately NOT forced on: the drawer competes with the tour's
    // own spotlight narration on first watch — it stays opt-in via the dock's
    // Explain toggle (IDLE_STATE has it off).
    setState((s) => ({ ...IDLE_STATE, stepMode: s.stepMode, running: true, status: t("status.starting") }));
    runPromiseRef.current = run();
  }, [run, t]);

  const pause = useCallback(() => {
    ctrl.current.paused = true;
    patch({ paused: true, status: t("status.paused") });
  }, [patch, t]);

  const resume = useCallback(() => {
    ctrl.current.paused = false;
    patch({ paused: false });
    ctrl.current.wake?.();
  }, [patch]);

  const next = useCallback(() => {
    ctrl.current.wake?.();
  }, []);

  const stop = useCallback(() => {
    ctrl.current.stop = true;
    ctrl.current.wake?.();
  }, []);

  const reset = useCallback(async () => {
    ctrl.current.stop = true;
    ctrl.current.wake?.();
    // Wait for the in-flight run to settle BEFORE deleting. The stop flag is only honored at
    // await checkpoints, so a mutation already in flight (e.g. /api/sim/inbound, which CREATES
    // SIM rows) would otherwise complete AFTER this delete and re-orphan the rows it removed.
    // Awaiting the run promise guarantees that mutation finished, so the delete runs last.
    await runPromiseRef.current?.catch(() => undefined);
    runPromiseRef.current = null;
    await fetch("/api/sim/reset", { method: "POST" }).catch(() => undefined);
    // Everything cleared to IDLE; keep the user's stepMode + explain-drawer state.
    setState((s) => ({ ...IDLE_STATE, stepMode: s.stepMode, explainOpen: s.explainOpen, status: t("status.reset") }));
  }, [t]);

  const toggleStep = useCallback(() => {
    stepRef.current = !stepRef.current;
    patch({ stepMode: stepRef.current });
    if (!stepRef.current) ctrl.current.wake?.();
  }, [patch]);

  const openExplain = useCallback(() => patch({ explainOpen: true }), [patch]);
  const closeExplain = useCallback(() => patch({ explainOpen: false }), [patch]);
  const closeGroupEval = useCallback(() => patch({ groupEval: null }), [patch]);
  const closeScreenWave = useCallback(() => patch({ screenWave: null }), [patch]);
  // Lets the presenter dismiss the candidate-page overlay (Escape / overlay-click
  // while paused). The walk continues; if it still needs the frame it falls back
  // to its API path (e.g. accepting the offer server-side).
  const closeFrame = useCallback(() => patch({ frame: null }), [patch]);

  // Public guided-demo entry (B1): a prospect arrives at '/?sim=auto' from the
  // marketing "Try the live demo" CTA (via /api/demo, which set the isolated demo
  // session). Auto-start the run ONCE so they see it play without hunting for a
  // control — and in PLAY mode (not the step default) for a hands-off first
  // impression; the SimBar still lets them pause/step. The ref guards against a
  // re-fire (StrictMode double-invoke, or the param persisting across nav).
  const autoStarted = useRef(false);
  useEffect(() => {
    if (autoStarted.current || searchParams.get("sim") !== "auto") return;
    autoStarted.current = true;
    // Fire-and-forget (no-op when Plausible isn't configured): the prospect
    // actually reached the guided demo — the conversion the landing CTA sells.
    track("demo_started");
    stepRef.current = false;
    setState((s) => ({ ...s, stepMode: false }));
    start();
  }, [searchParams, start]);

  const coachmark = useCallback<SimCtx["coachmark"]>(
    (c) => setState((s) => (s.running ? s : { ...s, spotlight: c ? { selector: c.selector, title: c.title, caption: c.caption } : null })),
    []
  );

  const value = useMemo<SimCtx>(
    () => ({ ...state, start, pause, resume, stop, reset, toggleStep, next, openExplain, closeExplain, closeGroupEval, closeScreenWave, closeFrame, coachmark }),
    [state, start, pause, resume, stop, reset, toggleStep, next, openExplain, closeExplain, closeGroupEval, closeScreenWave, closeFrame, coachmark]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
