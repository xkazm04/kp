"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { buildUrl } from "@/app/features/tabs";
import {
  SIM_COMPANY,
  SIM_JD_MARKDOWN,
  SIM_ROLE,
  SIM_SALARY,
  SIM_TITLE,
  type SimPhaseId,
} from "./constants";

type LogLine = { at: number; text: string };
type SimState = {
  running: boolean;
  paused: boolean;
  phase: SimPhaseId | null;
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
};

const Ctx = createContext<SimCtx | null>(null);
export const useSimulation = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error("useSimulation must be used within SimulationProvider");
  return c;
};

class SimStop extends Error {}
const JSON_HEADERS = { "Content-Type": "application/json" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function SimulationProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<SimState>({
    running: false,
    paused: false,
    phase: null,
    status: "Idle",
    log: [],
    targetLabel: null,
    error: null,
    done: false,
  });

  // Imperative control shared with the running async sequence.
  const ctrl = useRef<{ stop: boolean; paused: boolean; wake: (() => void) | null }>({ stop: false, paused: false, wake: null });

  const patch = useCallback((p: Partial<SimState>) => setState((s) => ({ ...s, ...p })), []);
  const log = useCallback(
    (text: string) => setState((s) => ({ ...s, log: [...s.log, { at: Date.now(), text }].slice(-40) })),
    []
  );
  const nav = useCallback((updates: Record<string, string | null>) => router.replace(buildUrl(updates), { scroll: false }), [router]);

  // Pause/stop checkpoint between steps.
  const gate = useCallback(async () => {
    if (ctrl.current.stop) throw new SimStop();
    if (ctrl.current.paused) {
      setState((s) => ({ ...s, paused: true }));
      await new Promise<void>((res) => (ctrl.current.wake = res));
      setState((s) => ({ ...s, paused: false }));
      if (ctrl.current.stop) throw new SimStop();
    }
  }, []);

  const phase = useCallback(
    async (id: SimPhaseId, status: string, tab: string, extra?: Record<string, string | null>) => {
      patch({ phase: id, status });
      log(status);
      nav({ tab, ...(extra ?? {}) });
      await gate();
    },
    [gate, log, nav, patch]
  );

  const advance = useCallback(async (entryId: string): Promise<string> => {
    const r = await fetch(`/api/pipeline/${entryId}`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ action: "accept" }) });
    const p = await r.json();
    if (!r.ok) throw new Error(p.error ?? "advance failed");
    return p.entry?.stage as string;
  }, []);

  const run = useCallback(async () => {
    try {
      log("Resetting prior simulation runs…");
      await fetch("/api/sim/reset", { method: "POST" });

      // 1) Design JD — prefill the builder so the inputs are visible.
      await phase("design", `Designing job description: ${SIM_TITLE}`, "library", {
        jdTitle: SIM_TITLE,
        jdCompany: SIM_COMPANY,
        jdSeniority: SIM_ROLE.seniority,
        jdFamily: SIM_ROLE.roleFamily,
        jdNeed: SIM_ROLE.responsibilities.join(". ") + ".",
      });

      // 2) Publish + source.
      await phase("source", "Publishing JD and sourcing candidates…", "pipeline", { jdTitle: null, jdCompany: null, jdSeniority: null, jdFamily: null, jdNeed: null });
      const save = await fetch("/api/jds/save", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ title: SIM_TITLE, body: SIM_JD_MARKDOWN, role: SIM_ROLE, salary: SIM_SALARY, company: SIM_COMPANY }),
      }).then((r) => r.json());
      const jobId = `jd-${save.slug}`;
      log(`JD published as a matchable job · sourced ${save.sourced ?? 0} candidates → Sourced`);
      await gate();

      // 3) Auto-match — advance THIS job's sourced candidates to AI-matched.
      //    Scoped to the sim's own entries so the seeded pipeline isn't churned;
      //    the global policy pass + scheduler are demoable separately (Pipeline tab).
      await phase("match", "Auto-matching sourced candidates…", "pipeline");
      const sourcedNow: { id: string }[] = (await fetch("/api/pipeline").then((r) => r.json()).then((p) => p.entries ?? []))
        .filter((e: { jobId: string; stage: string }) => e.jobId === jobId && e.stage === "Sourced");
      for (const e of sourcedNow) await advance(e.id); // Sourced → AI-matched
      log(`Auto-matched ${sourcedNow.length} candidates → AI-matched`);
      await gate();

      // Pick the strongest AI-matched candidate for this job to walk to Hired.
      const entries = await fetch("/api/pipeline").then((r) => r.json()).then((p) => p.entries ?? []);
      const target = entries
        .filter((e: { jobId: string; stage: string }) => e.jobId === jobId && e.stage === "AI-matched")
        .sort((a: { matchScore: number }, b: { matchScore: number }) => (b.matchScore ?? 0) - (a.matchScore ?? 0))[0];
      if (!target) throw new Error("No AI-matched candidate to walk (sourcing returned none).");
      patch({ targetLabel: target.candidateLabel });
      log(`Selected ${target.candidateLabel} (match ${target.matchScore}) to follow to Hired`);

      // 4) Screen → advance.
      await phase("screen", `Screening ${target.candidateLabel}…`, "decisions");
      log(`→ ${await advance(target.id)}`);
      await gate();

      // 5) Interview.
      await phase("interview", "Scheduling the interview…", "schedule");
      log(`→ ${await advance(target.id)}`);
      await gate();
      log(`→ ${await advance(target.id)}`); // Interview → Offer

      // 6) Offer: deterministic draft → recruiter extends (sends the secure link).
      await phase("offer", "Drafting and extending the offer…", "decisions");
      await fetch("/api/sim/offer-draft", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ entryId: target.id }) });
      const ext = await fetch(`/api/pipeline/${target.id}`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ action: "accept" }) }).then((r) => r.json());
      log(`Offer sent to ${target.candidateLabel} (secure accept/decline link)`);
      await gate();

      // 7) Candidate accepts via the token link → Hired + onboarding.
      const token = String(ext.link ?? "").split("/offer/")[1];
      if (!token) throw new Error("No offer token returned from extend.");
      await sleep(400);
      const acc = await fetch(`/api/offer/${token}`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ response: "accept" }) }).then((r) => r.json());
      if (acc.status !== "accepted") throw new Error("Offer was not accepted.");

      await phase("hired", `${target.candidateLabel} accepted — Hired 🎉`, "pipeline");
      log("Onboarding comm queued. Simulation complete — JD → Hired.");
      patch({ done: true, running: false, status: "Done — candidate hired" });
    } catch (e) {
      if (e instanceof SimStop) {
        patch({ running: false, status: "Stopped" });
        log("Simulation stopped.");
        return;
      }
      const msg = e instanceof Error ? e.message : "Simulation failed.";
      patch({ running: false, error: msg, status: `Failed: ${msg}` });
      log(`Error: ${msg}`);
    }
  }, [advance, gate, log, patch, phase]);

  const start = useCallback(() => {
    ctrl.current = { stop: false, paused: false, wake: null };
    setState({ running: true, paused: false, phase: null, status: "Starting…", log: [], targetLabel: null, error: null, done: false });
    void run();
  }, [run]);

  const pause = useCallback(() => {
    ctrl.current.paused = true;
    patch({ status: "Paused" });
  }, [patch]);

  const resume = useCallback(() => {
    ctrl.current.paused = false;
    ctrl.current.wake?.();
    ctrl.current.wake = null;
  }, []);

  const stop = useCallback(() => {
    ctrl.current.stop = true;
    ctrl.current.wake?.();
    ctrl.current.wake = null;
  }, []);

  const reset = useCallback(async () => {
    ctrl.current.stop = true;
    ctrl.current.wake?.();
    await fetch("/api/sim/reset", { method: "POST" }).catch(() => undefined);
    setState({ running: false, paused: false, phase: null, status: "Reset", log: [], targetLabel: null, error: null, done: false });
  }, []);

  const value = useMemo<SimCtx>(() => ({ ...state, start, pause, resume, stop, reset }), [state, start, pause, resume, stop, reset]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
