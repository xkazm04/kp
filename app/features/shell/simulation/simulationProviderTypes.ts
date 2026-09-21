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

/** The simulated role the design chapter hands to the JD builder.
 *
 *  It used to travel in the ADDRESS BAR — `?jdTitle=&jdCompany=&jdSeniority=
 *  &jdFamily=&jdNeed=`, a 252-character URL whose longest field was a prose
 *  paragraph. That is a URL carrying CONTENT rather than state: unreadable,
 *  meaningless to anyone who sees it, and bookmarkable into a stale fixture.
 *  The tour is one component handing data to another inside the same React tree
 *  and the same provider, so it hands it across in state instead.
 *
 *  The `?jd*` deep link is untouched and still works (`jdsBuilderLogic.ts`
 *  reads it): a human linking in from outside genuinely has no other channel.
 *  This is only the SIMULATION's transport.
 *
 *  Field names are the builder's own (`GeneratePrefill` in
 *  app/features/library/jds/jdsLibrary.ts) so `JdsIntakeTab` can seed the panel
 *  from it directly; declared here rather than imported so the shell keeps no
 *  dependency on the library feature. */
export type JdBuilderHandoff = {
  title: string;
  company: string;
  seniority: string;
  roleFamily: string;
  need: string;
};

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
  /** The JD fixture the current chapter is handing to the builder, or null.
   *  Set by the design chapter and nulled by the next one — see JdBuilderHandoff
   *  for why this is state rather than five query params. */
  jdHandoff: JdBuilderHandoff | null;
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
//
// This is now the FALLBACK bound only. advanceTo measures the board it is actually
// walking (`getBoard().axis`, the workspace's own composed columns) and uses this
// shipped depth just when the payload carries no axis at all: a workspace may
// compose up to PIPELINE_STAGES_MAX columns, and a bound frozen at the shipped
// depth refused targets that were genuinely reachable on a deeper board.
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
  jdHandoff: null,
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

// The transient run surface, cleared together whenever a run ends (done/stop/fail)
// so no spotlight/frame/modal survives into the next state. Spread into a patch().
// `jdHandoff` is not an overlay but is exactly as transient — a run that fails
// DURING the design chapter must not leave the builder prefilling itself from a
// fixture no run is walking any more.
export const CLEAR_OVERLAYS: Pick<SimState, "spotlight" | "frame" | "groupEval" | "screenWave" | "jdHandoff"> = {
  spotlight: null,
  frame: null,
  groupEval: null,
  screenWave: null,
  jdHandoff: null,
};

export type StepOpts = {
  id: SimPhaseId;
  tab: string;
  target: string | null;
  title: string;
  caption: string;
  /** The JD fixture this chapter hands to the builder (design only). Absent means
   *  "nothing to hand over", and step() nulls the state accordingly — so the
   *  handoff lives for exactly the chapter that declares it, the way the `jd*`
   *  params it replaced were cleared by the chapter after it. */
  jdHandoff?: JdBuilderHandoff;
  action?: () => Promise<void>;
  readMs?: number;
  settleMs?: number;
};
