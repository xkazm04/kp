"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { buildUrl } from "@/app/features/tabs";
import { SIM_COMPANY, SIM_JD_MARKDOWN, SIM_ROLE, SIM_SALARY, SIM_TITLE, type SimPhaseId } from "./constants";

type Speed = "slow" | "normal" | "fast";
type Spotlight = { selector: string | null; title: string; caption: string };
type LogLine = { at: number; text: string };

type SimState = {
  running: boolean;
  paused: boolean;
  stepMode: boolean;
  awaitingNext: boolean;
  speed: Speed;
  explainOpen: boolean;
  phase: SimPhaseId | null;
  spotlight: Spotlight | null;
  status: string;
  log: LogLine[];
  targetLabel: string | null;
  error: string | null;
  done: boolean;
};

type SimCtx = SimState & {
  start: () => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  reset: () => Promise<void>;
  setSpeed: (s: Speed) => void;
  toggleStep: () => void;
  next: () => void;
  openExplain: () => void;
  closeExplain: () => void;
};

const Ctx = createContext<SimCtx | null>(null);
export const useSimulation = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error("useSimulation must be used within SimulationProvider");
  return c;
};

const SPEED_FACTOR: Record<Speed, number> = { slow: 1.8, normal: 1, fast: 0.45 };
class SimStop extends Error {}
const JSON_HEADERS = { "Content-Type": "application/json" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function SimulationProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<SimState>({
    running: false,
    paused: false,
    stepMode: false,
    awaitingNext: false,
    speed: "normal",
    explainOpen: false,
    phase: null,
    spotlight: null,
    status: "Idle",
    log: [],
    targetLabel: null,
    error: null,
    done: false,
  });

  // Imperative control shared with the running async sequence.
  const ctrl = useRef<{ stop: boolean; paused: boolean; wake: (() => void) | null }>({ stop: false, paused: false, wake: null });
  const speedRef = useRef<Speed>("normal");
  const stepRef = useRef<boolean>(false);

  const patch = useCallback((p: Partial<SimState>) => setState((s) => ({ ...s, ...p })), []);
  const log = useCallback(
    (text: string) => setState((s) => ({ ...s, log: [...s.log, { at: Date.now(), text }].slice(-40) })),
    []
  );
  const nav = useCallback((updates: Record<string, string | null>) => router.replace(buildUrl(updates), { scroll: false }), [router]);

  // Paced wait — honors pause (paused time doesn't count) and stop. Beats are how
  // the showcase slows down so a viewer can read + watch each result land.
  const beat = useCallback(async (ms: number) => {
    const target = ms * SPEED_FACTOR[speedRef.current];
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

  // Checkpoint between phases: blocks for Resume (paused) or Next (step mode).
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

  type StepOpts = {
    id: SimPhaseId;
    tab: string;
    target: string | null;
    title: string;
    caption: string;
    navExtra?: Record<string, string | null>;
    action?: () => Promise<void>;
    readMs?: number;
    settleMs?: number;
  };

  const step = useCallback(
    async (o: StepOpts) => {
      patch({ phase: o.id, status: o.title, spotlight: { selector: o.target, title: o.title, caption: o.caption } });
      log(o.caption);
      nav({ tab: o.tab, ...(o.navExtra ?? {}) });
      await beat(o.readMs ?? 1600); // read the caption + let the tab settle
      if (o.action) await o.action();
      await beat(o.settleMs ?? 1000); // let the result show
      await gate(); // pause / step checkpoint
    },
    [beat, gate, log, nav, patch]
  );

  const advance = useCallback(async (entryId: string): Promise<string> => {
    const r = await fetch(`/api/pipeline/${entryId}`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ action: "accept" }) });
    const p = await r.json();
    if (!r.ok) throw new Error(p.error ?? "advance failed");
    return p.entry?.stage as string;
  }, []);

  const run = useCallback(async () => {
    let jobId = "";
    let targetId = "";
    let targetLabel = "";
    let link = "";
    try {
      log("Resetting prior simulation runs…");
      await fetch("/api/sim/reset", { method: "POST" });

      await step({
        id: "design",
        tab: "library",
        target: '[data-sim="jd-builder"]',
        title: "Designing the job description",
        caption: `Filling the JD builder for "${SIM_TITLE}" — the role spec (must-haves, seniority, languages) drives everything downstream.`,
        navExtra: {
          jdTitle: SIM_TITLE,
          jdCompany: SIM_COMPANY,
          jdSeniority: SIM_ROLE.seniority,
          jdFamily: SIM_ROLE.roleFamily,
          jdNeed: SIM_ROLE.responsibilities.join(". ") + ".",
        },
        readMs: 2200,
      });

      await step({
        id: "source",
        tab: "pipeline",
        target: '[data-sim="pipeline-board"]',
        title: "Publishing & sourcing",
        caption: "The JD becomes a structured, matchable job and we rank the seeded candidate pool against it — survivors land at ‘Sourced’.",
        navExtra: { jdTitle: null, jdCompany: null, jdSeniority: null, jdFamily: null, jdNeed: null },
        action: async () => {
          const save = await fetch("/api/jds/save", {
            method: "POST",
            headers: JSON_HEADERS,
            body: JSON.stringify({ title: SIM_TITLE, body: SIM_JD_MARKDOWN, role: SIM_ROLE, salary: SIM_SALARY, company: SIM_COMPANY }),
          }).then((r) => r.json());
          jobId = `jd-${save.slug}`;
          log(`Published as a matchable job · sourced ${save.sourced ?? 0} candidates → Sourced`);
        },
      });

      await step({
        id: "match",
        tab: "pipeline",
        target: '[data-sim="pipeline-board"]',
        title: "Auto-matching",
        caption: "Each sourced candidate is scored archetype-aware (experienced vs. student vs. switcher) and advanced to ‘AI-matched’.",
        action: async () => {
          const sourced: { id: string }[] = (await fetch("/api/pipeline").then((r) => r.json()).then((p) => p.entries ?? [])).filter(
            (e: { jobId: string; stage: string }) => e.jobId === jobId && e.stage === "Sourced"
          );
          for (const e of sourced) await advance(e.id);
          const entries = await fetch("/api/pipeline").then((r) => r.json()).then((p) => p.entries ?? []);
          const target = entries
            .filter((e: { jobId: string; stage: string }) => e.jobId === jobId && e.stage === "AI-matched")
            .sort((a: { matchScore: number }, b: { matchScore: number }) => (b.matchScore ?? 0) - (a.matchScore ?? 0))[0];
          if (!target) throw new Error("No AI-matched candidate to walk (sourcing returned none).");
          targetId = target.id;
          targetLabel = target.candidateLabel;
          patch({ targetLabel });
          log(`Auto-matched ${sourced.length} candidates · following ${targetLabel} (match ${target.matchScore}) to Hired`);
        },
      });

      await step({
        id: "screen",
        tab: "decisions",
        target: '[data-sim="decisions"]',
        title: "Screening",
        caption: `AI recommends; a human decides. Advancing ${targetLabel || "the candidate"} past screening (early-career is never auto-rejected).`,
        action: async () => {
          log(`→ ${await advance(targetId)}`);
        },
      });

      await step({
        id: "interview",
        tab: "schedule",
        target: '[data-sim="schedule"]',
        title: "Interview",
        caption: "Scheduling the interview with prep ready, then moving the candidate to the offer stage.",
        action: async () => {
          log(`→ ${await advance(targetId)}`); // Screening → Interview
          log(`→ ${await advance(targetId)}`); // Interview → Offer
        },
      });

      await step({
        id: "offer",
        tab: "decisions",
        target: '[data-sim="decisions"]',
        title: "Offer",
        caption: "A deterministic offer is drafted at the band midpoint; the recruiter extends it and the candidate gets a secure accept/decline link.",
        action: async () => {
          await fetch("/api/sim/offer-draft", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ entryId: targetId }) });
          const ext = await fetch(`/api/pipeline/${targetId}`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ action: "accept" }) }).then((r) => r.json());
          link = String(ext.link ?? "");
          log(`Offer sent to ${targetLabel} (secure link)`);
        },
        settleMs: 1400,
      });

      await step({
        id: "hired",
        tab: "pipeline",
        target: '[data-sim="pipeline-board"]',
        title: "Hired",
        caption: `${targetLabel || "The candidate"} accepts the offer — they move to Hired and onboarding kicks off automatically.`,
        action: async () => {
          const token = link.split("/offer/")[1];
          if (!token) throw new Error("No offer token returned from extend.");
          const acc = await fetch(`/api/offer/${token}`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ response: "accept" }) }).then((r) => r.json());
          if (acc.status !== "accepted") throw new Error("Offer was not accepted.");
          log("Onboarding comm queued · simulation complete — JD → Hired.");
        },
        settleMs: 1600,
      });

      patch({ done: true, running: false, status: "Done — candidate hired 🎉", spotlight: null });
    } catch (e) {
      if (e instanceof SimStop) {
        patch({ running: false, status: "Stopped", spotlight: null });
        log("Simulation stopped.");
        return;
      }
      const msg = e instanceof Error ? e.message : "Simulation failed.";
      patch({ running: false, error: msg, status: `Failed: ${msg}`, spotlight: null });
      log(`Error: ${msg}`);
    }
  }, [advance, log, patch, step]);

  const start = useCallback(() => {
    ctrl.current = { stop: false, paused: false, wake: null };
    stepRef.current = false;
    setState((s) => ({
      ...s,
      running: true,
      paused: false,
      stepMode: false,
      awaitingNext: false,
      explainOpen: true,
      phase: null,
      spotlight: null,
      status: "Starting…",
      log: [],
      targetLabel: null,
      error: null,
      done: false,
    }));
    void run();
  }, [run]);

  const pause = useCallback(() => {
    ctrl.current.paused = true;
    patch({ paused: true, status: "Paused" });
  }, [patch]);

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
    await fetch("/api/sim/reset", { method: "POST" }).catch(() => undefined);
    setState((s) => ({
      ...s,
      running: false,
      paused: false,
      awaitingNext: false,
      phase: null,
      spotlight: null,
      status: "Reset",
      log: [],
      targetLabel: null,
      error: null,
      done: false,
    }));
  }, []);

  const setSpeed = useCallback((s: Speed) => {
    speedRef.current = s;
    patch({ speed: s });
  }, [patch]);

  const toggleStep = useCallback(() => {
    stepRef.current = !stepRef.current;
    patch({ stepMode: stepRef.current });
    if (!stepRef.current) ctrl.current.wake?.(); // leaving step mode releases a waiting gate
  }, [patch]);

  const openExplain = useCallback(() => patch({ explainOpen: true }), [patch]);
  const closeExplain = useCallback(() => patch({ explainOpen: false }), [patch]);

  const value = useMemo<SimCtx>(
    () => ({ ...state, start, pause, resume, stop, reset, setSpeed, toggleStep, next, openExplain, closeExplain }),
    [state, start, pause, resume, stop, reset, setSpeed, toggleStep, next, openExplain, closeExplain]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
