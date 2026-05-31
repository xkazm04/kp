"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { buildUrl } from "@/app/features/tabs";
import { notifyDataChanged } from "@/app/features/live-refresh";
import { SIM_COMPANY, SIM_JD_MARKDOWN, SIM_ROLE, SIM_SALARY, SIM_TITLE, type SimPhaseId } from "./constants";

type Spotlight = { selector: string | null; title: string; caption: string };
type LogLine = { at: number; text: string };
type Entry = { id: string; jobId: string | null; stage: string; approvalKind: string | null; matchScore: number | null; candidateLabel: string };

type SimState = {
  running: boolean;
  paused: boolean;
  stepMode: boolean;
  awaitingNext: boolean;
  explainOpen: boolean;
  phase: SimPhaseId | null;
  spotlight: Spotlight | null;
  offerUrl: string | null;
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

// Slow is the demo baseline — every beat runs at this factor.
const SLOW_FACTOR = 1.8;
class SimStop extends Error {}
const JSON_HEADERS = { "Content-Type": "application/json" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function SimulationProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<SimState>({
    running: false,
    paused: false,
    stepMode: true, // step-through is the default for demos
    awaitingNext: false,
    explainOpen: false,
    phase: null,
    spotlight: null,
    offerUrl: null,
    status: "Idle",
    log: [],
    targetLabel: null,
    error: null,
    done: false,
  });

  const ctrl = useRef<{ stop: boolean; paused: boolean; wake: (() => void) | null }>({ stop: false, paused: false, wake: null });
  const stepRef = useRef<boolean>(true);

  const patch = useCallback((p: Partial<SimState>) => setState((s) => ({ ...s, ...p })), []);
  const log = useCallback(
    (text: string) => setState((s) => ({ ...s, log: [...s.log, { at: Date.now(), text }].slice(-40) })),
    []
  );
  const nav = useCallback((updates: Record<string, string | null>) => router.replace(buildUrl(updates), { scroll: false }), [router]);

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

  // ---- Observation + real-click engine ---------------------------------------

  const getEntries = useCallback(async (): Promise<Entry[]> => {
    return fetch("/api/pipeline").then((r) => r.json()).then((p) => (p.entries as Entry[]) ?? []);
  }, []);

  // Poll a DOM predicate until satisfied (element appears / iframe ready).
  const waitDom = useCallback(async <T,>(probe: () => T | null, timeout = 9000): Promise<T | null> => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (ctrl.current.stop) throw new SimStop();
      const v = probe();
      if (v) return v;
      await sleep(120);
    }
    return null;
  }, []);

  // Poll the server until a pipeline entry matches (so we don't race the UI's fetch).
  const waitEntry = useCallback(
    async (id: string, pred: (e: Entry) => boolean, timeout = 9000): Promise<boolean> => {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        if (ctrl.current.stop) throw new SimStop();
        const e = (await getEntries()).find((x) => x.id === id);
        if (e && pred(e)) return true;
        await sleep(250);
      }
      return false;
    },
    [getEntries]
  );

  // Dispatch a REAL click on a rendered element (main doc or an iframe doc).
  const clickEl = useCallback(
    async (selector: string, o: { title: string; caption: string; doc?: Document }): Promise<boolean> => {
      const doc = o.doc ?? document;
      const el = (await waitDom(() => doc.querySelector(selector) as HTMLElement | null)) as HTMLElement | null;
      if (!el) return false;
      if (!o.doc) {
        el.scrollIntoView({ block: "center", behavior: "smooth" });
        patch({ spotlight: { selector, title: o.title, caption: o.caption } });
      }
      await beat(1100); // let the viewer see what's about to be clicked
      el.click(); // native click bubbles to the React root → the real handler fires
      await beat(700);
      return true;
    },
    [beat, patch, waitDom]
  );

  const advance = useCallback(async (entryId: string): Promise<string> => {
    const r = await fetch(`/api/pipeline/${entryId}`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ action: "accept" }) });
    const p = await r.json();
    if (!r.ok) throw new Error(p.error ?? "advance failed");
    notifyDataChanged(); // open board/queue re-fetches live
    return p.entry?.stage as string;
  }, []);

  const advanceTo = useCallback(
    async (entryId: string, stage: string): Promise<string> => {
      let st = "";
      for (let i = 0; i < 4; i++) {
        st = await advance(entryId);
        if (st === stage) break;
      }
      return st;
    },
    [advance]
  );

  // ---- The walk --------------------------------------------------------------

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
      await beat(o.readMs ?? 1600);
      if (o.action) await o.action();
      notifyDataChanged(); // reflect this phase's mutations in any open view
      await beat(o.settleMs ?? 1000);
      await gate();
    },
    [beat, gate, log, nav, patch]
  );

  const run = useCallback(async () => {
    let jobId = "";
    let targetId = "";
    let targetLabel = "";
    let offerToken = "";
    try {
      log("Resetting prior simulation runs…");
      await fetch("/api/sim/reset", { method: "POST" });

      await step({
        id: "design",
        tab: "library",
        target: '[data-sim="jd-builder"]',
        title: "Designing the job description",
        caption: `Filling the JD builder for "${SIM_TITLE}" — the role spec drives matching, sourcing and the offer band.`,
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
        caption: "The JD becomes a structured, matchable job; the seeded candidate pool is ranked against it — survivors land at ‘Sourced’.",
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
        caption: "Each sourced candidate is scored archetype-aware and advanced to ‘AI-matched’ — the automated middle of the funnel.",
        action: async () => {
          const sourced = (await getEntries()).filter((e) => e.jobId === jobId && e.stage === "Sourced");
          for (const e of sourced) await advance(e.id);
          const top = (await getEntries())
            .filter((e) => e.jobId === jobId && e.stage === "AI-matched")
            .sort((a, b) => (b.matchScore ?? 0) - (a.matchScore ?? 0))[0];
          if (!top) throw new Error("No AI-matched candidate to walk (sourcing returned none).");
          targetId = top.id;
          targetLabel = top.candidateLabel;
          patch({ targetLabel });
          log(`Auto-matched ${sourced.length} candidates · following ${targetLabel} (match ${top.matchScore}) to Hired`);
        },
      });

      // SCREEN — a real click on the recruiter's decision card.
      await step({
        id: "screen",
        tab: "decisions",
        target: '[data-sim="decisions"]',
        title: "Screening decision",
        caption: "AI recommends; a human decides. Advancing the candidate from the Decisions queue.",
        action: async () => {
          await advance(targetId); // AI-matched → Screening
          await fetch("/api/sim/screen-draft", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ entryId: targetId }) });
          nav({ tab: "decisions" });
          await beat(600);
          const clicked = await clickEl(`[data-sim-entry="${targetId}"] [data-sim-click="accept"]`, {
            title: "Advance past screening",
            caption: `Recruiter clicks ‘Advance’ on ${targetLabel} — early-career is never auto-rejected.`,
          });
          if (!clicked) {
            log("(decision card not visible — advancing via API)");
            await advance(targetId);
          }
          await waitEntry(targetId, (e) => e.stage !== "Screening");
          log("→ screening cleared");
        },
        readMs: 1500,
      });

      // INTERVIEW — a real click on the recruiter's ‘Confirm’ in the schedule.
      await step({
        id: "interview",
        tab: "schedule",
        target: '[data-sim="schedule"]',
        title: "Interview",
        caption: "Recruiter confirms the interview slot on the shared calendar; the candidate clears it and reaches the offer stage.",
        action: async () => {
          await beat(400); // let the schedule load the calendar card (the screening accept set it)
          const clicked = await clickEl(`[data-sim-entry="${targetId}"] [data-sim-click="confirm"]`, {
            title: "Confirm the interview",
            caption: `Recruiter confirms ${targetLabel}'s interview slot.`,
          });
          if (!clicked) {
            log("(schedule card not visible — confirming via API)");
            await fetch(`/api/pipeline/${targetId}`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ action: "approve_event", detail: "Tue 14:00" }) });
            notifyDataChanged();
          }
          await waitEntry(targetId, (e) => e.approvalKind !== "calendar");
          const st = await advanceTo(targetId, "Offer");
          log(`→ ${st}`);
        },
        readMs: 1500,
      });

      // OFFER — a real click on the recruiter's ‘Send offer’ card.
      await step({
        id: "offer",
        tab: "decisions",
        target: '[data-sim="decisions"]',
        title: "Extending the offer",
        caption: "A deterministic offer is drafted at the band midpoint; the recruiter sends it.",
        action: async () => {
          await fetch("/api/sim/offer-draft", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ entryId: targetId }) });
          nav({ tab: "decisions" });
          await beat(600);
          const clicked = await clickEl(`[data-sim-entry="${targetId}"] [data-sim-click="accept"]`, {
            title: "Send offer",
            caption: `Recruiter clicks ‘Send offer’ — a secure accept/decline link goes to ${targetLabel}.`,
          });
          if (!clicked) {
            log("(offer card not visible — extending via API)");
            await fetch(`/api/pipeline/${targetId}`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ action: "accept" }) });
          }
          await waitEntry(targetId, (e) => e.approvalKind !== "offer_review");
          const { token } = await fetch(`/api/sim/offer-link?entryId=${targetId}`).then((r) => r.json());
          if (!token) throw new Error("offer token not found after extend");
          offerToken = token;
          log("Offer sent · secure link generated");
        },
        settleMs: 1200,
      });

      // HIRED — the candidate opens their real offer page and clicks Accept.
      await step({
        id: "hired",
        tab: "pipeline",
        target: '[data-sim="pipeline-board"]',
        title: "Candidate accepts",
        caption: `${targetLabel} opens the secure link and accepts — they move to Hired and onboarding begins.`,
        action: async () => {
          patch({ offerUrl: `/offer/${offerToken}` });
          await beat(1400); // let the candidate page load + the viewer see it
          const doc = await waitDom(() => {
            const ifr = document.querySelector("iframe[data-sim-offer]") as HTMLIFrameElement | null;
            const d = ifr?.contentDocument ?? null;
            return d && d.querySelector('[data-sim-click="offer-accept"]') ? d : null;
          });
          const clicked = doc
            ? await clickEl('[data-sim-click="offer-accept"]', { title: "Accept offer", caption: "The candidate accepts the offer.", doc })
            : false;
          if (!clicked) {
            log("(offer page not reachable — accepting via API)");
            await fetch(`/api/offer/${offerToken}`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ response: "accept" }) });
          }
          await beat(1600); // show the ‘accepted’ confirmation
          patch({ offerUrl: null });
          log("Accepted · moved to Hired · onboarding comm queued");
        },
        readMs: 1200,
        settleMs: 1400,
      });

      patch({ done: true, running: false, status: "Done — candidate hired 🎉", spotlight: null, offerUrl: null });
    } catch (e) {
      if (e instanceof SimStop) {
        patch({ running: false, status: "Stopped", spotlight: null, offerUrl: null });
        log("Simulation stopped.");
        return;
      }
      const msg = e instanceof Error ? e.message : "Simulation failed.";
      patch({ running: false, error: msg, status: `Failed: ${msg}`, spotlight: null, offerUrl: null });
      log(`Error: ${msg}`);
    }
  }, [advance, advanceTo, beat, clickEl, getEntries, log, nav, patch, step, waitDom, waitEntry]);

  const start = useCallback(() => {
    ctrl.current = { stop: false, paused: false, wake: null };
    setState((s) => ({
      ...s,
      running: true,
      paused: false,
      awaitingNext: false,
      explainOpen: true,
      phase: null,
      spotlight: null,
      offerUrl: null,
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
      offerUrl: null,
      status: "Reset",
      log: [],
      targetLabel: null,
      error: null,
      done: false,
    }));
  }, []);

  const toggleStep = useCallback(() => {
    stepRef.current = !stepRef.current;
    patch({ stepMode: stepRef.current });
    if (!stepRef.current) ctrl.current.wake?.();
  }, [patch]);

  const openExplain = useCallback(() => patch({ explainOpen: true }), [patch]);
  const closeExplain = useCallback(() => patch({ explainOpen: false }), [patch]);

  const value = useMemo<SimCtx>(
    () => ({ ...state, start, pause, resume, stop, reset, toggleStep, next, openExplain, closeExplain }),
    [state, start, pause, resume, stop, reset, toggleStep, next, openExplain, closeExplain]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
