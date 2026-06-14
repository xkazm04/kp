"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { buildUrl, clearedTabScopedParams } from "@/app/features/tabs";
import { jdJobId } from "@/app/_lib/jd-limits";
import { notifyDataChanged } from "@/app/features/live-refresh";
import type { GroupEvalPayload } from "@/app/features/sub_decisions/GroupEvalModal";
import { SIM_COMPANY, SIM_JD_MARKDOWN, SIM_ROLE, SIM_SALARY, SIM_SCREEN_POLICY, SIM_TITLE, type SimPhaseId } from "./constants";
import { STAGES as PIPELINE_STAGES } from "@/app/features/sub_pipeline/PipelineTypes";
import type { PipelineEntryView } from "@/app/_lib/db";
import type { ScreenDecision } from "@/app/_lib/screen-wave";

// `error` is the explicit unavailable/timed-out state: set when the evaluation
// can't be produced in time, so the reused modal shows an honest message instead
// of a blank "no evaluation yet" comparison during the climactic Offer step.
type GroupEval = { roleTitle: string; payload: GroupEvalPayload | null; loading: boolean; error: string | null };
// Single-sourced from the canonical ScreenDecision (screen-wave.ts) — the wire
// shape /api/decisions/screen-wave returns. The old local copy dropped DEC4's
// reasonCode/reasonParams (the locale-renderable rationale mirror); importing the
// source carries them through so SimDecisionWave can localize like the real modal.
type ScreenWave = { decisions: ScreenDecision[]; rejected: number; kept: number; cohort: number };

type Spotlight = { selector: string | null; title: string; caption: string };
type LogLine = { at: number; text: string };

type SimState = {
  running: boolean;
  paused: boolean;
  stepMode: boolean;
  awaitingNext: boolean;
  explainOpen: boolean;
  phase: SimPhaseId | null;
  spotlight: Spotlight | null;
  frame: { url: string; title: string } | null;
  groupEval: GroupEval | null;
  screenWave: ScreenWave | null;
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
  closeGroupEval: () => void;
  closeScreenWave: () => void;
  closeFrame: () => void;
};

const Ctx = createContext<SimCtx | null>(null);
export const useSimulation = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error("useSimulation must be used within SimulationProvider");
  return c;
};

// Slow is the demo baseline — every beat runs at this factor.
const SLOW_FACTOR = 1.8;
// advance() steps an entry exactly one PIPELINE stage per call, so reaching a target
// from any earlier stage takes at most (stages − 1) advances. Derived from the
// canonical 5-stage list — NOT a literal — so the 7→5 stage consolidation (and any
// future reshaping) can't silently invalidate the bound the way the old hardcoded
// `4` did. (The board's STAGES mirror db.ts PIPELINE_STAGES; both are 5 stages.)
const MAX_STAGE_ADVANCES = PIPELINE_STAGES.length - 1;
class SimStop extends Error {}
const JSON_HEADERS = { "Content-Type": "application/json" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// The fully-cleared baseline SimState: nothing running, no overlays, idle status.
// Single source for the three places that need an everything-cleared shape — the
// initial useState, start(), and reset() — so adding a SimState field can't leave a
// stale value behind in one of them. start/reset spread this and override only the
// fields that differ (and preserve the user's stepMode / explain-drawer state).
const IDLE_STATE: SimState = {
  running: false,
  paused: false,
  stepMode: true, // step-through is the default for demos
  awaitingNext: false,
  explainOpen: false,
  phase: null,
  spotlight: null,
  frame: null,
  groupEval: null,
  screenWave: null,
  status: "Idle",
  log: [],
  targetLabel: null,
  error: null,
  done: false,
};

// The transient overlays, cleared together whenever a run ends (done/stop/fail) so
// no spotlight/frame/modal survives into the next state. Spread into a patch().
const CLEAR_OVERLAYS: Pick<SimState, "spotlight" | "frame" | "groupEval" | "screenWave"> = {
  spotlight: null,
  frame: null,
  groupEval: null,
  screenWave: null,
};

export function SimulationProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const searchParams = useSearchParams();
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

  // ---- Observation + real-click engine ---------------------------------------

  const getEntries = useCallback(async (): Promise<PipelineEntryView[]> => {
    // Throw on a non-OK response instead of letting `?? []` coerce a transient 500 into an
    // empty board — which read as "intake returned none" and silently halted the sim beat.
    // A throw surfaces the failure to the sim run's error handling.
    const r = await fetch("/api/pipeline");
    if (!r.ok) throw new Error(`pipeline fetch failed (${r.status})`);
    const p = await r.json();
    return (p.entries as PipelineEntryView[]) ?? [];
  }, []);

  // The sim walk repeatedly re-fetches the whole board and selects the cohort for
  // the role under demo. Co-locate that selection so the jobId scope and the stage
  // strings live in one place: `entriesFor` is the job-scoped (optionally
  // stage-scoped) cohort; `topScreened` is the highest-matchScore Screened entry
  // (the candidate the walk follows).
  const entriesFor = useCallback(
    async (jobId: string, stage?: string): Promise<PipelineEntryView[]> =>
      (await getEntries()).filter((e) => e.jobId === jobId && (stage === undefined || e.stage === stage)),
    [getEntries]
  );

  const topScreened = useCallback(
    async (jobId: string): Promise<PipelineEntryView | undefined> =>
      (await entriesFor(jobId, "Screened")).sort((a, b) => (b.matchScore ?? 0) - (a.matchScore ?? 0))[0],
    [entriesFor]
  );

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
  // FAILURE POLICY (shared with advanceTo): a timeout means an expected server
  // transition never happened, so the next step's precondition is broken — THROW a
  // clear, labelled message that halts the demo (surfaced as "Failed: …" by run's
  // catch), rather than returning a silent false and walking on stale state. `label`
  // names what we were waiting for so the halt message is legible per call site.
  const waitEntry = useCallback(
    async (id: string, pred: (e: PipelineEntryView) => boolean, label: string, timeout = 9000): Promise<void> => {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        if (ctrl.current.stop) throw new SimStop();
        const e = (await getEntries()).find((x) => x.id === id);
        if (e && pred(e)) return;
        await sleep(250);
      }
      throw new Error(`Timed out after ${Math.round(timeout / 1000)}s waiting for ${label}.`);
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

  // Advance an entry until it reaches `stage`, bounded by the real pipeline depth.
  // FAILURE POLICY (shared with waitEntry): if the target isn't reached within the
  // bound — the entry stalled or overshot — THROW so the demo halts with a clear
  // message instead of silently returning the wrong stage and breaking a later step
  // cryptically. Callers that are deliberately best-effort (the cohort match) opt
  // out by catching this explicitly.
  const advanceTo = useCallback(
    async (entryId: string, stage: string): Promise<string> => {
      let st = "";
      for (let i = 0; i < MAX_STAGE_ADVANCES; i++) {
        st = await advance(entryId);
        if (st === stage) return st;
      }
      throw new Error(`Could not advance entry ${entryId} to "${stage}" within ${MAX_STAGE_ADVANCES} steps (stalled at "${st || "unknown"}").`);
    },
    [advance]
  );

  // Run + show a group evaluation for a role (keyless: deterministic ranking when
  // no LLM). Starts the existing group_eval task, polls the saved evaluation, and
  // surfaces the comparison modal.
  const runGroupEval = useCallback(
    async (jobId: string, roleTitle: string) => {
      const candidates = (await entriesFor(jobId))
        .map((e) => ({ entryId: e.id, candidateId: e.candidateId, label: e.candidateLabel, matchScore: e.matchScore }));
      patch({ groupEval: { roleTitle, payload: null, loading: true, error: null } });
      try {
        await fetch("/api/tasks", {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({ kind: "group_eval", params: { roleKey: jobId, roleTitle, jobId, candidates } }),
        });
        const TIMEOUT_MS = 25_000;
        const deadline = Date.now() + TIMEOUT_MS;
        let payload: GroupEvalPayload | null = null;
        while (Date.now() < deadline) {
          if (ctrl.current.stop) throw new SimStop();
          const ev = await fetch(`/api/decisions/group-eval?role=${encodeURIComponent(jobId)}`).then((r) => r.json()).catch(() => null);
          if (ev?.evaluation?.payload) {
            payload = ev.evaluation.payload as GroupEvalPayload;
            break;
          }
          await sleep(400);
        }
        if (payload) {
          patch({ groupEval: { roleTitle, payload, loading: false, error: null } });
        } else {
          // Timed out waiting for the evaluation to be written. Surface it explicitly
          // (the modal renders this message) rather than dropping to a blank/"run one"
          // comparison during the climactic Offer step.
          const error = `The group evaluation didn't finish within ${Math.round(
            TIMEOUT_MS / 1000
          )}s. The candidates are still in the pipeline — the comparison just couldn't be generated in time.`;
          patch({ groupEval: { roleTitle, payload: null, loading: false, error } });
          log("⚠︎ Group evaluation timed out — showing an unavailable notice.");
        }
      } catch (e) {
        if (e instanceof SimStop) throw e;
        // Same honest-failure treatment as the timeout: show why, don't blank out.
        patch({
          groupEval: { roleTitle, payload: null, loading: false, error: "The group evaluation couldn't be generated." },
          screenWave: null,
        });
      }
    },
    [entriesFor, log, patch]
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
        tab: "jobs",
        target: '[data-sim="job-drafts"]',
        title: "Source into Pipeline",
        caption: "The JD is saved as a draft. Sourcing it from the Jobs tab takes it live and pulls the candidate pool into the pipeline.",
        // Leaving the JD builder: clear the prefill (and any other tab-scoped
        // param) from the canonical allowlist rather than re-listing jd* keys.
        navExtra: clearedTabScopedParams(),
        action: async () => {
          // Save as a DRAFT (no sourcing yet).
          const save = await fetch("/api/jds/save", {
            method: "POST",
            headers: JSON_HEADERS,
            body: JSON.stringify({ title: SIM_TITLE, body: SIM_JD_MARKDOWN, role: SIM_ROLE, salary: SIM_SALARY, company: SIM_COMPANY }),
          }).then((r) => r.json());
          jobId = save.jobId ?? jdJobId(save.slug);
          log(`Saved as draft · ${jobId}`);
          notifyDataChanged(); // the Jobs tab picks up the new draft
          await beat(900);

          // Source into Pipeline — a real click on the draft's button (sources the pool).
          const clicked = await clickEl(`[data-sim-entry="${jobId}"] [data-sim-click="publish"]`, {
            title: "Source into Pipeline",
            caption: "This takes the JD live and sources the candidate pool into the pipeline.",
          });
          if (!clicked) {
            log("(draft not visible — sourcing via API)");
            await fetch(`/api/jobs/${jobId}/publish`, { method: "POST" });
          }

          // Wait for the sourced entries to land.
          let sourced = 0;
          const deadline = Date.now() + 12_000;
          while (Date.now() < deadline) {
            if (ctrl.current.stop) throw new SimStop();
            sourced = (await entriesFor(jobId, "Accepted")).length;
            if (sourced > 0) break;
            await sleep(400);
          }
          log(`Live · sourced ${sourced} candidates → Accepted`);
          notifyDataChanged();
        },
      });

      await step({
        id: "match",
        tab: "channels",
        target: '[data-sim="channel-inbound"]',
        title: "Intake & match",
        caption: "Candidates enter via channels: an application arrives on the careers page (‘Accepted’) alongside the proactively-sourced pool; all intake is then scored and matched.",
        action: async () => {
          // An inbound application arrives via the careers-page channel → Accepted.
          await beat(700);
          const inbound = await fetch("/api/sim/inbound", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ jobId }) }).then((r) => r.json());
          if (inbound?.label) log(`📥 ${inbound.label} applied via the careers page → Accepted`);
          notifyDataChanged();
          await beat(1400);

          // Match all intake (Accepted) → Screened (first-wave evaluation: match + AI screen).
          const intake = await entriesFor(jobId, "Accepted");
          // Best-effort cohort advance: this is the ONE site that deliberately opts
          // out of advanceTo's throw-on-failure policy — a stray un-advanceable stub
          // shouldn't abort the whole demo. Log each straggler and continue; the
          // `if (!top)` guard below still HALTS if the cohort produced nobody Screened.
          for (const e of intake) {
            try {
              await advanceTo(e.id, "Screened");
            } catch (err) {
              if (err instanceof SimStop) throw err;
              log(`⚠︎ ${e.candidateLabel} stuck before Screened — skipping (${err instanceof Error ? err.message : "advance failed"})`);
            }
          }
          const top = await topScreened(jobId);
          if (!top) throw new Error("No Screened candidate to walk (intake returned none).");
          targetId = top.id;
          targetLabel = top.candidateLabel;
          patch({ targetLabel });
          log(`Matched ${intake.length} candidates → Screened · following ${targetLabel} (match ${top.matchScore}) to Hired`);
        },
      });

      // SCREEN — the first AUTOMATED decision wave: rank the matched cohort,
      // auto-reject the weakest below threshold (audited, with rationale),
      // early-career never rejected; the survivor proceeds toward interview.
      await step({
        id: "screen",
        tab: "analytics",
        target: '#main',
        title: "Screening · automated wave",
        caption: "The first automated decision: score the matched candidates, auto-reject the weakest below threshold (each with a rationale), and pass the rest.",
        action: async () => {
          const wave = await fetch("/api/decisions/screen-wave", {
            method: "POST",
            headers: JSON_HEADERS,
            // Override thresholds are single-sourced in SIM_SCREEN_POLICY
            // (constants.ts), coupled to its inboundScoreFloor by an invariant (the
            // scripted applicant must outscore the reject ceiling, or it gets
            // auto-rejected mid-demo). constants.test.ts pins that invariant.
            body: JSON.stringify({ jobId, override: SIM_SCREEN_POLICY.screenWaveOverride }),
          }).then((r) => r.json());
          patch({ screenWave: { decisions: wave.decisions ?? [], rejected: wave.rejected ?? 0, kept: wave.kept ?? 0, cohort: wave.cohort ?? 0 } });
          notifyDataChanged();
          await beat(3400); // let the viewer read the audit
          patch({ screenWave: null });
          log(`Screening wave · ${wave.rejected ?? 0} auto-rejected (with rationale), ${wave.kept ?? 0} advanced · early-career protected`);

          // The survivor proceeds toward the interview (this sets the calendar gate).
          await advance(targetId); // Screened → Interview
          await fetch("/api/sim/screen-draft", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ entryId: targetId }) });
          await fetch(`/api/pipeline/${targetId}`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ action: "accept" }) });
          await waitEntry(targetId, (e) => e.stage === "Interview" || e.approvalKind === "calendar", "screening to open the interview / calendar gate");
          notifyDataChanged();
          log(`${targetLabel} passed screening → Interview`);
        },
        readMs: 1800,
      });

      // INTERVIEW — automate the round (candidate self-schedules), or assign a slot
      // manually. The driver takes the automate path; manual Confirm is the fallback.
      await step({
        id: "interview",
        tab: "schedule",
        target: '[data-sim="schedule"]',
        title: "Interview",
        caption: `Automating the interview round — ${targetLabel} self-schedules (vs. assigning a slot manually).`,
        action: async () => {
          let scheduled = false;
          try {
            // AUTOMATE: mint a self-scheduling link; the candidate picks a slot.
            const inv = await fetch("/api/schedule/invite", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ entryId: targetId }) }).then((r) => r.json());
            if (inv?.token) {
              patch({ frame: { url: `/schedule/${inv.token}`, title: "Candidate self-schedules" } });
              await beat(2400); // let the viewer watch the candidate's slot picker
              const slots = await fetch(`/api/schedule/${inv.token}`).then((r) => r.json()).then((p) => p.slots ?? []);
              const slot = slots[0];
              if (slot) {
                // Confirming fires approve_event on the entry + sends a confirmation.
                await fetch(`/api/schedule/${inv.token}`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ slot: slot.label, slotAt: slot.value }) });
                log(`${targetLabel} self-scheduled · ${slot.label}`);
                scheduled = true;
                notifyDataChanged();
              }
              await beat(800);
              patch({ frame: null });
            }
          } catch {
            patch({ frame: null });
          }
          if (!scheduled) {
            // MANUAL fallback: the recruiter confirms a slot on the shared calendar.
            const clicked = await clickEl(`[data-sim-entry="${targetId}"] [data-sim-click="confirm"]`, {
              title: "Confirm the interview",
              caption: `Recruiter confirms ${targetLabel}'s interview slot.`,
            });
            if (!clicked) {
              log("(schedule card not visible — confirming via API)");
              await fetch(`/api/pipeline/${targetId}`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ action: "approve_event", detail: "Tue 14:00" }) });
              notifyDataChanged();
            }
          }
          await waitEntry(targetId, (e) => e.approvalKind !== "calendar", "the interview slot to be confirmed");
          const st = await advanceTo(targetId, "Offer");
          log(`→ ${st}`);
        },
        readMs: 1500,
      });

      // OFFER — group-evaluate the role's field, then a real click on ‘Send offer’.
      await step({
        id: "offer",
        tab: "decisions",
        target: '[data-sim="decisions"]',
        title: "Extending the offer",
        caption: `Comparing the role's candidates, then sending the offer to ${targetLabel}.`,
        action: async () => {
          // Group evaluation: compare the field for the role before committing.
          await runGroupEval(jobId, SIM_TITLE);
          await beat(2600); // let the viewer read the comparison
          patch({ groupEval: null, screenWave: null });

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
          await waitEntry(targetId, (e) => e.approvalKind !== "offer_review", "the offer to be extended");
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
          patch({ frame: { url: `/offer/${offerToken}`, title: "Candidate's view" } });
          await beat(1400); // let the candidate page load + the viewer see it
          const doc = await waitDom(() => {
            const ifr = document.querySelector("iframe[data-sim-frame]") as HTMLIFrameElement | null;
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
          patch({ frame: null });
          log("Accepted · moved to Hired · onboarding comm queued");
        },
        readMs: 1200,
        settleMs: 1400,
      });

      patch({ done: true, running: false, status: "Done — candidate hired 🎉", ...CLEAR_OVERLAYS });
    } catch (e) {
      if (e instanceof SimStop) {
        patch({ running: false, status: "Stopped", ...CLEAR_OVERLAYS });
        log("Simulation stopped.");
        return;
      }
      const msg = e instanceof Error ? e.message : "Simulation failed.";
      patch({ running: false, error: msg, status: `Failed: ${msg}`, ...CLEAR_OVERLAYS });
      log(`Error: ${msg}`);
    }
  }, [advance, advanceTo, beat, clickEl, entriesFor, topScreened, log, nav, patch, runGroupEval, step, waitDom, waitEntry]);

  const start = useCallback(() => {
    ctrl.current = { stop: false, paused: false, wake: null };
    // Everything cleared to IDLE, then the run-starting overrides. stepMode is
    // preserved — it mirrors stepRef.current, the engine's source of truth.
    setState((s) => ({ ...IDLE_STATE, stepMode: s.stepMode, running: true, explainOpen: true, status: "Starting…" }));
    runPromiseRef.current = run();
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
    // Wait for the in-flight run to settle BEFORE deleting. The stop flag is only honored at
    // await checkpoints, so a mutation already in flight (e.g. /api/sim/inbound, which CREATES
    // SIM rows) would otherwise complete AFTER this delete and re-orphan the rows it removed.
    // Awaiting the run promise guarantees that mutation finished, so the delete runs last.
    await runPromiseRef.current?.catch(() => undefined);
    runPromiseRef.current = null;
    await fetch("/api/sim/reset", { method: "POST" }).catch(() => undefined);
    // Everything cleared to IDLE; keep the user's stepMode + explain-drawer state.
    setState((s) => ({ ...IDLE_STATE, stepMode: s.stepMode, explainOpen: s.explainOpen, status: "Reset" }));
  }, []);

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

  const value = useMemo<SimCtx>(
    () => ({ ...state, start, pause, resume, stop, reset, toggleStep, next, openExplain, closeExplain, closeGroupEval, closeScreenWave, closeFrame }),
    [state, start, pause, resume, stop, reset, toggleStep, next, openExplain, closeExplain, closeGroupEval, closeScreenWave, closeFrame]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
