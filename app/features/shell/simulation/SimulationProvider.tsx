"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { track } from "@/app/_lib/analytics/plausible";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { buildUrl } from "@/app/features/shell/tabs";
import { IDLE_STATE, SLOW_FACTOR, SimStop, sleep, type SimCtx, type SimRuntime, type SimState } from "./simulationProviderTypes";
import { SIM_DOOR_IDLE, performReset, refreshSimDoor, runControlFlags, simDoorSnapshot, simWaitVariant, subscribeSimDoor, totalCleared } from "./simRunControl";
import { storedLease, tabStorage } from "./simRunLease";
import { resumePointOf, type SimResumePoint } from "./simWalkResume";

// The engine + scripted walk, code-split out of the shell's first load: an operator who
// never starts the demo never downloads it. SimulationRuntime.tsx says when it mounts.
const SimulationRuntime = dynamic(() => import("./SimulationRuntime").then((m) => ({ default: m.SimulationRuntime })));

const Ctx = createContext<SimCtx | null>(null);
export const useSimulation = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error("useSimulation must be used within SimulationProvider");
  return c;
};
/** Same context, but `null` outside the provider — for shell chrome that also
 *  mounts on the server-rendered deep-link pages (the command palette on the
 *  link-mode sidebar), where there is no simulation to offer. */
export const useOptionalSimulation = () => useContext(Ctx);

export function SimulationProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // The run-control statuses (starting / paused / reset) are the demo's own copy —
  // the tour is public (/?sim=auto from the localized landing CTA), so they must
  // never be the English literals they used to be.
  const t = useTranslations("simulation");
  // The reset door answers a CODE; the console renders it in the reader's language,
  // never the server's English. Stable identity (memoized on the translator), so it
  // is safe in reset's dependency array.
  const resolveError = useErrorMessage();
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
  // Both live in <SimulationRuntime>, mounted on first need (`armed`, or a resume to
  // read) and published back here through onReady. `withRuntime` is how an action that
  // needs the walk waits for it: immediate once loaded, one chunk download the first
  // time. Waiters are flushed in the effect that adopts the published runtime.
  const [runtime, setRuntime] = useState<SimRuntime | null>(null);
  const runtimeRef = useRef<SimRuntime | null>(null);
  const runtimeWaiters = useRef<((rt: SimRuntime) => void)[]>([]);
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    runtimeRef.current = runtime;
    if (runtime) for (const resolve of runtimeWaiters.current.splice(0)) resolve(runtime);
  }, [runtime]);
  // Once loaded it stays mounted for the document (`armed` is sticky): unmounting it when
  // the residue that mounted it is reset would drop the walk's lease ref with it.
  const adoptRuntime = useCallback((rt: SimRuntime) => {
    setRuntime(rt);
    setArmed(true);
  }, []);
  const withRuntime = useCallback((): Promise<SimRuntime> => {
    if (runtimeRef.current) return Promise.resolve(runtimeRef.current);
    setArmed(true);
    return new Promise((resolve) => runtimeWaiters.current.push(resolve));
  }, []);

  // A reload mid-run used to strand the operator: the lease outlived the tab and
  // the next Start was refused for up to five minutes. pagehide is the last
  // reliable moment a closing or reloading tab gets; the release is keepalive and
  // releases only a lease this tab claimed (useSimulationWalk.releaseLease). No
  // runtime yet means no walk ever ran in this tab, so there is nothing to release.
  useEffect(() => {
    const releaseLease = () => runtimeRef.current?.releaseLease();
    window.addEventListener("pagehide", releaseLease);
    return () => window.removeEventListener("pagehide", releaseLease);
  }, []);

  // RESUME a walk the board still shows (simWalkResume.ts). A reload, a crashed tab or
  // a presenter who navigated away used to have two ways back, Start and Reset, and
  // both purged the walk they wanted to continue. The board is the record: read it
  // once when the console has residue to explain, and offer the chapter it proves.
  //
  // Offered only when no live lease is someone else's: a free tenant, or one whose
  // lease THIS tab held before the reload (its token is in session storage). The
  // route decides for real either way; this only keeps a Resume that would be
  // refused off the console.
  const door = useSyncExternalStore(subscribeSimDoor, simDoorSnapshot, () => SIM_DOOR_IDLE);
  const resumeEligible = door.residue > 0 && (!door.runActive || storedLease(tabStorage()) !== null);
  const [boardResume, setBoardResume] = useState<SimResumePoint | null>(null);
  // Reading the board for a resume needs the engine, so residue is one of the things
  // that mounts the runtime (below); until it has loaded there is no offer to make.
  useEffect(() => {
    if (state.running || state.done || !resumeEligible || !runtime) return;
    let live = true;
    runtime
      .getBoard()
      .then((board) => live && setBoardResume(resumePointOf(board)))
      .catch(() => live && setBoardResume(null));
    return () => {
      live = false;
    };
  }, [state.running, state.done, resumeEligible, runtime]);
  const resumable = !state.running && !state.done && resumeEligible ? boardResume : null;
  // A run that just ended (stopped, failed) left the door's residue count stale.
  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current && !state.running) void refreshSimDoor();
    wasRunning.current = state.running;
  }, [state.running]);

  const begin = useCallback((from: SimResumePoint | null) => {
    ctrl.current = { ...runControlFlags("start", ctrl.current).flags, wake: null };
    // Everything cleared to IDLE, then the run-starting overrides. stepMode is
    // preserved — it mirrors stepRef.current, the engine's source of truth.
    // explainOpen deliberately NOT forced on: the drawer competes with the tour's
    // own spotlight narration on first watch — it stays opt-in via the dock's
    // Explain toggle (IDLE_STATE has it off).
    setState((s) => ({ ...IDLE_STATE, stepMode: s.stepMode, running: true, status: t(from ? "status.resuming" : "status.starting") }));
    // The walk's own first statement runs once the runtime is loaded: immediately
    // after the first run, one chunk download before it. Stop/reset during that
    // download is honoured by the walk's first checkpoint, and reset's settle awaits
    // this same promise.
    runPromiseRef.current = withRuntime().then((rt) => rt.run(from));
  }, [withRuntime, t]);
  const start = useCallback(() => begin(null), [begin]);
  const resumeAt = useCallback(() => {
    if (resumable) begin(resumable);
  }, [begin, resumable]);

  const pause = useCallback(() => {
    Object.assign(ctrl.current, runControlFlags("pause", ctrl.current).flags);
    patch({ paused: true, status: t("status.paused") });
  }, [patch, t]);

  const resume = useCallback(() => {
    // Order (pinned in simRunControl.test.ts): clear the flag, THEN wake — the woken
    // walk re-reads `paused` and would immediately re-park itself otherwise.
    const { flags, wakes } = runControlFlags("resume", ctrl.current);
    Object.assign(ctrl.current, flags);
    patch({ paused: false });
    if (wakes) ctrl.current.wake?.();
  }, [patch]);

  const next = useCallback(() => {
    ctrl.current.wake?.();
  }, []);

  const stop = useCallback(() => {
    const { flags, wakes } = runControlFlags("stop", ctrl.current);
    Object.assign(ctrl.current, flags);
    if (wakes) ctrl.current.wake?.();
  }, []);

  const reset = useCallback(async () => {
    // stop → settle → purge, ordered and reported by performReset (simRunControl.ts).
    // The settle is load-bearing: the stop flag is only honored at await checkpoints, so
    // a mutation already in flight (e.g. /api/sim/inbound, which CREATES SIM rows) would
    // otherwise complete AFTER the delete and re-orphan the rows it removed.
    const { purge } = await performReset({
      requestStop: () => {
        const { flags, wakes } = runControlFlags("stop", ctrl.current);
        Object.assign(ctrl.current, flags);
        if (wakes) ctrl.current.wake?.();
      },
      settleRun: async () => {
        await runPromiseRef.current?.catch(() => undefined);
        runPromiseRef.current = null;
      },
      // The door's whole answer, not just `.ok`. It computes a thirteen-table count
      // on success and refuses with a CODE plus the holder's remaining lease on a
      // 409; reading only the status threw all three away.
      purge: async () => {
        const r = await fetch("/api/sim/reset", { method: "POST" });
        const body = (await r.json().catch(() => null)) as { cleared?: unknown; code?: unknown; retryAfterSeconds?: unknown } | null;
        if (!r.ok) {
          return {
            ok: false,
            code: typeof body?.code === "string" ? body.code : null,
            retryAfterSeconds: typeof body?.retryAfterSeconds === "number" ? body.retryAfterSeconds : null,
          };
        }
        return { ok: true, cleared: totalCleared(body?.cleared) };
      },
    });
    // What the operator is told, from what the server actually said.
    //
    //  · a refusal is the CODE in the reader's language, and — this is the half that
    //    was missing — WITH the wait it carries. "Cleanup failed. Try again" over a
    //    409 was the one instruction that cannot work: a retry is refused for as
    //    long as the holder's lease has left, and only the seconds say so.
    //  · a success names what it removed. A count of zero is not a failure and must
    //    not read as one; it is the honest "there was nothing here".
    //
    // A FAILED purge is not a clean slate, so it also lands in `error` (the status
    // line is styled off it by SimControlDockSimFace) — the presenter must not start
    // the next run on top of the last one's residue.
    const waitKey = purge.ok ? null : simWaitVariant(purge.code, purge.retryAfterSeconds);
    const generic = purge.ok ? "" : resolveError(purge, t("status.resetFailed"));
    const failure = waitKey && !purge.ok ? resolveError({ code: waitKey }, generic, { seconds: purge.retryAfterSeconds ?? 0 }) : generic;
    setState((s) => ({
      ...IDLE_STATE,
      stepMode: s.stepMode,
      explainOpen: s.explainOpen,
      status: purge.ok ? (purge.cleared > 0 ? t("status.resetCleared", { count: purge.cleared }) : t("status.resetNothing")) : failure,
      error: purge.ok ? null : failure,
    }));
    // The purge is exactly what makes the status door's residue count wrong, so
    // re-read it here: a cleared tenant must stop pinning the deck to the console,
    // and a FAILED purge must keep it there (the rows are still on the board).
    void refreshSimDoor();
  }, [resolveError, t]);

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
    () => ({ ...state, resumable, resumeAt, start, pause, resume, stop, reset, toggleStep, next, openExplain, closeExplain, closeGroupEval, closeScreenWave, closeFrame, coachmark }),
    [state, resumable, resumeAt, start, pause, resume, stop, reset, toggleStep, next, openExplain, closeExplain, closeGroupEval, closeScreenWave, closeFrame, coachmark]
  );
  return (
    <Ctx.Provider value={value}>
      {children}
      {armed || resumeEligible ? (
        <SimulationRuntime ctrl={ctrl} patch={patch} log={log} nav={nav} beat={beat} gate={gate} onReady={adoptRuntime} />
      ) : null}
    </Ctx.Provider>
  );
}
