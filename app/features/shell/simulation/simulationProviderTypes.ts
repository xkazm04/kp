// Shared types + constants for SimulationProvider.tsx, split out so the provider
// stays under the 200-line file cap. Verbatim — same shapes, same values.
import type { GroupEvalPayload } from "@/app/features/hiring/decisions/GroupEvalModal";
import { STAGES as PIPELINE_STAGES } from "@/app/features/shared/pipelineTypes";
import type { ScreenDecision } from "@/app/_lib/screen-wave";
import type { SimPhaseId } from "./constants";

// `error` is the explicit unavailable/timed-out state: set when the evaluation
// can't be produced in time, so the reused modal shows an honest message instead
// of a blank "no evaluation yet" comparison during the climactic Offer step.
export type GroupEval = { roleTitle: string; payload: GroupEvalPayload | null; loading: boolean; error: string | null };
// Single-sourced from the canonical ScreenDecision (screen-wave.ts) — the wire
// shape /api/decisions/screen-wave returns. The old local copy dropped DEC4's
// reasonCode/reasonParams (the locale-renderable rationale mirror); importing the
// source carries them through so SimDecisionWave can localize like the real modal.
export type ScreenWave = { decisions: ScreenDecision[]; rejected: number; kept: number; cohort: number };

export type Spotlight = { selector: string | null; title: string; caption: string };
export type LogLine = { at: number; text: string };

export type SimState = {
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

export type SimCtx = SimState & {
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
  /** Standalone one-off coachmark (the Getting-started "show me" affordance):
   *  lights the SimSpotlight on a target WITHOUT running the simulation. No-op
   *  while a real run is live — the engine owns the spotlight then. Pass null
   *  to clear. */
  coachmark: (c: { selector: string; title: string; caption: string } | null) => void;
};

// Slow is the demo baseline — every beat runs at this factor.
export const SLOW_FACTOR = 1.8;
// advance() steps an entry exactly one PIPELINE stage per call, so reaching a target
// from any earlier stage takes at most (stages − 1) advances. Derived from the
// canonical 5-stage list — NOT a literal — so the 7→5 stage consolidation (and any
// future reshaping) can't silently invalidate the bound the way the old hardcoded
// `4` did. (The board's STAGES mirror db.ts PIPELINE_STAGES; both are 5 stages.)
export const MAX_STAGE_ADVANCES = PIPELINE_STAGES.length - 1;
export class SimStop extends Error {}
export const JSON_HEADERS = { "Content-Type": "application/json" };
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// The fully-cleared baseline SimState: nothing running, no overlays, idle status.
// Single source for the three places that need an everything-cleared shape — the
// initial useState, start(), and reset() — so adding a SimState field can't leave a
// stale value behind in one of them. start/reset spread this and override only the
// fields that differ (and preserve the user's stepMode / explain-drawer state).
export const IDLE_STATE: SimState = {
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
  // Empty, not "Idle": this is a module constant with no translator in scope, so
  // the idle wording is resolved at the render boundary (SimControlDockSimFace
  // falls back to `simulation.status.idle`). Every other status the demo shows is
  // written here by a component that DOES have one.
  status: "",
  log: [],
  targetLabel: null,
  error: null,
  done: false,
};

// The transient overlays, cleared together whenever a run ends (done/stop/fail) so
// no spotlight/frame/modal survives into the next state. Spread into a patch().
export const CLEAR_OVERLAYS: Pick<SimState, "spotlight" | "frame" | "groupEval" | "screenWave"> = {
  spotlight: null,
  frame: null,
  groupEval: null,
  screenWave: null,
};

export type StepOpts = {
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
