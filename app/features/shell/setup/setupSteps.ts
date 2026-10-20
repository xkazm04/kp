// First-run onboarding — shared step model + state. This is the SimBar "phases"
// idea (constants.ts SIM_PHASES) retargeted from a demo chronology to a
// user-completes-it setup journey: Welcome → Company → Team → Pipeline →
// Candi → Hand-off. Copy lives in the `setup` i18n namespace (messages/*.json), not here
// — steps carry ids only, so the catalogs stay the single source of wording.
//
// Step 4 used to be "First role" — the inputs of a real backgrounded JD build.
// It is gone: authoring a job description is a Library job with its own ledger,
// retry and engine caveats, and asking for it inside a modal made the wizard the
// second-best place to do it; the Library's own JD builder is where it lives now.
// What replaced it is the one shape decision the whole
// workspace hangs off and that nothing else asks about at first run: the board's
// columns.
//
// THE INTENT FORK (2026-09-16, spark candidate-jobseeker). The Welcome step asks
// ONE question before anything else: hiring, or looking for a job? A seeker has no
// company, no team, no hiring board and no Candi — so those four steps declare
// themselves irrelevant for `intent === "seek"` and the wizard runs Welcome →
// Hand-off, then finish() routes to /me instead of the workspace. Branching is a
// DECLARED PREDICATE on the step (`relevant`), and `relevantSteps()` is the one
// authority the rail, the counter, the gates, the ceiling and the finish fold all
// derive from — indices are positions in the relevant sequence, identity is the id.
// The hire path is byte-for-byte what it was (setupSteps.test.ts pins the sequence).
//
// THE SEAT (2026-09-23). The '/' gate fires per user and a redeemed invite lands on
// '/', so an invited teammate meets this wizard too. A step whose answers need a
// capability declares it (`requires`), and `relevantSteps()` asks the seat as well as
// the intent: an invited recruiter walks Welcome → Pipeline → Candi → Hand-off,
// because the org name/currency/brand (org:manage, owner-only) and the invites
// (members:manage) are writes the server would refuse them. An UNKNOWN seat (null —
// the read is in flight or failed) is today's full run: setupSeat.ts fails open.

// bug-ui-scan-2026-07-09 (organizations-members-invites #4): source the role +
// language vocabularies from the REAL identity model (auth/roles) and the shared
// Organization presenter (member-ui), not the retired sub_organization/mock
// prototype fixture. Onboarding speaks the server enum natively.
import type { AppLanguage } from "@/app/features/shared/memberUi";
import type { MemberRole } from "@/app/_lib/auth/roles";
import { APP_CURRENCY } from "@/app/_lib/format";
import type { OrgCurrency } from "@/app/_lib/org-settings";
import type { PipelineStagesRule } from "@/app/_lib/decision-config-schema";
// The PROBE module, never companion-brain.ts: that one spawns Python and opens
// better-sqlite3, and this file is imported by a client component. Same
// split-by-audience the dock's proposal card keeps.
import type { CompanionBrainChoice, CompanionBrainStatus } from "@/app/_lib/companion-brain-probe";
import { axisProblems, type AxisDraft } from "@/app/features/shared/pipelineAxisDraft";
import type { Capability } from "@/app/_lib/auth/roles";
import { seatAllows, type SetupSeat } from "./setupSeat";
import type { SetupFinishReceipt } from "./setupFinishOutcome";

export type SetupStepId = "welcome" | "company" | "team" | "pipeline" | "companion" | "handoff";

/** What brought the operator here. `null` until the Welcome step is answered. */
export const SETUP_INTENTS = ["hire", "seek"] as const;
export type SetupIntent = (typeof SETUP_INTENTS)[number];
export function isSetupIntent(v: unknown): v is SetupIntent {
  return typeof v === "string" && (SETUP_INTENTS as readonly string[]).includes(v);
}

export type SetupStep = {
  id: SetupStepId;
  /** Whether the step belongs in THIS run. Absent = always. */
  relevant?: (state: SetupState) => boolean;
  /** The capability this step's answers are WRITTEN with — the one its finish
   *  door gates on. A seat without it is not asked (see setupSeat.ts). Absent =
   *  the step writes nothing an org-level gate refuses. */
  requires?: Capability;
};

const hiringOnly = (state: SetupState): boolean => state.intent !== "seek";

export const SETUP_STEPS: SetupStep[] = [
  { id: "welcome" },
  // org name / currency / brand: setOrgName, setOrgCurrency, PUT /api/brand.
  { id: "company", relevant: hiringOnly, requires: "org:manage" },
  // POST /api/org/invites.
  { id: "team", relevant: hiringOnly, requires: "members:manage" },
  // POST /api/pipeline/stage-migration.
  { id: "pipeline", relevant: hiringOnly, requires: "pipeline:write" },
  { id: "companion", relevant: hiringOnly },
  { id: "handoff" },
];

/** The steps this run walks, in order — THE authority every index in the wizard is
 *  a position in. Derived from intent x seat: a hire (or undecided) run is the full
 *  journey for an owner or an unknown seat, minus every step whose `requires` the
 *  seat does not hold; a seek run is Welcome → Hand-off. */
export function relevantSteps(state: SetupState): SetupStep[] {
  return SETUP_STEPS.filter((s) => (!s.relevant || s.relevant(state)) && (!s.requires || seatAllows(state.seat, s.requires)));
}

export type SetupInvite = { email: string; role: MemberRole };

/**
 * The board's columns, as the wizard holds them.
 *
 * `stored` is the axis the server had when the step loaded — the baseline the
 * dirty check compares against, so finishing writes NOTHING when the operator
 * accepted the default. `counts` is per-stage occupancy: zero everywhere on a
 * genuinely fresh workspace, but the wizard also opens over a populated one
 * (Settings → "Preview onboarding", `?onboarding=1`), and there a removal the
 * server would refuse must not be offered.
 */
export type SetupPipeline = {
  stored: PipelineStagesRule;
  draft: AxisDraft;
  counts: Record<string, number>;
};

/** Whether the axis read has landed. `failed` is a real state, not a spinner
 *  that never ends: the step says so and lets the operator past — the board keeps
 *  whatever it already had. */
export type SetupPipelineLoad = "loading" | "ready" | "failed";

/** Whether the brain probe has landed. Same three-state shape and the same
 *  contract as the axis read: a failed probe SAYS SO and lets the operator past,
 *  because a machine we could not look at is not a reason to block first run. */
export type SetupBrainLoad = "loading" | "ready" | "failed";

/** Whether a step's REQUIRED inputs are satisfied — the single gate behind the
 *  footer's Continue AND the rail's forward navigation, so the stepper can't
 *  bypass what the button enforces. `welcome` requires the INTENT (the fork
 *  everything after it hangs off) and `company` an org name; `team` and
 *  `pipeline` are optional — `team` invites nobody by default and `pipeline`
 *  ships a working five-column board, so accepting either unchanged is a
 *  legitimate answer. The pipeline gate is therefore a VALIDITY check, not a
 *  completeness one: an axis the server would reject can't be carried to the
 *  hand-off, but an untouched one is fine.
 *
 *  `companion` is deliberately absent too, and for a stronger reason than the
 *  others: it asks for CONSENT to keep a memory on the operator's own machine,
 *  and a consent question that blocks the door is not a question. Skipping it is
 *  a real answer — the dock still works, memoryless — so the step is always
 *  satisfied and never gates Continue. */
export function stepSatisfied(id: SetupStepId, state: SetupState): boolean {
  if (id === "welcome") return state.intent !== null;
  if (id === "company") return state.orgName.trim().length > 0;
  if (id === "pipeline") {
    if (state.pipelineLoad !== "ready" || !state.pipeline) return true;
    return axisProblems(state.pipeline.draft).length === 0;
  }
  return true;
}

/**
 * The highest step a click may open — the high-water mark, CAPPED by the current
 * step when its required input is unsatisfied.
 *
 * Having reached step N proves the steps before it were satisfied AT THE TIME; it
 * does not prove they still are. An operator who typed the org name, pressed
 * Continue, came back and cleared the field sat on a disabled Continue button
 * while the rail — reading the raw high-water mark — still offered Team, Pipeline
 * and Done: finishing that way writes NO org name (setOrgName is skipped for an
 * empty one) and the workspace silently keeps the seed default as its identity on
 * every generated JD, offer and candidate mail. Capping the ceiling at the current
 * step closes goTo and the rail together — they both read this one number — and
 * retyping the name restores it. Going BACK is never capped, so nobody is
 * stranded.
 */
export function reachedCeiling(maxVisited: number, stepIndex: number, canAdvance: boolean): number {
  return canAdvance ? maxVisited : Math.min(maxVisited, stepIndex);
}

export type SetupState = {
  /** The fork: hiring, or looking for a job. Answered on Welcome; null until then. */
  intent: SetupIntent | null;
  orgName: string;
  language: AppLanguage;
  /** The salary currency the org writes its bands in (a label, never FX). */
  currency: OrgCurrency;
  /** Brand accent hex, or null = keep the product default (coral). */
  accentColor: string | null;
  /** https:// logo URL ("" = none). */
  logoUrl: string;
  invites: SetupInvite[];
  pipeline: SetupPipeline | null;
  pipelineLoad: SetupPipelineLoad;
  /** What this machine already holds for Candi, read WITHOUT creating any of it
   *  (GET /api/companion/brain). Null until the probe lands or fails. */
  brain: CompanionBrainStatus | null;
  brainLoad: SetupBrainLoad;
  /** What the operator answered about Candi's memory. `null` is "skip for now",
   *  and it is the default: onboarding never blocks on the companion, and a skip
   *  stamps NOTHING brain-related. Written by finish(), like every other answer
   *  in this wizard — which is also what keeps the Settings walkthrough honest,
   *  since preview mode's finish() persists nothing at all. */
  companionChoice: CompanionBrainChoice;
  /** WHO is answering — the caller's capabilities, read once from GET
   *  /api/me/onboarding. Null until it lands (or when it fails): an unknown seat is
   *  the owner's full run, never a smaller one. Server truth, so it is not part of
   *  the saved draft. */
  seat: SetupSeat;
};

export const INITIAL_SETUP: SetupState = {
  intent: null,
  orgName: "",
  language: "en",
  currency: APP_CURRENCY,
  accentColor: null,
  logoUrl: "",
  invites: [],
  pipeline: null,
  pipelineLoad: "loading",
  brain: null,
  brainLoad: "loading",
  companionChoice: null,
  seat: null,
};

// Shared controller — the onboarding host owns this and hands the SAME object to
// whichever variant is active, so a step's edits survive a variant switch.
export type OnboardingCtrl = {
  /** "live" = the real first run (persists + stamps); "preview" = the Settings
   *  walkthrough (persists NOTHING — the wizard shows a ribbon saying so). */
  mode: "live" | "preview";
  /** The steps THIS run walks (relevantSteps(state)); every index below is a
   *  position in it. */
  steps: SetupStep[];
  stepIndex: number;
  /** Highest step legitimately reached (via Continue / Skip) — the rail may
   *  navigate freely up to here; beyond it only one step ahead when the current
   *  step's required inputs are satisfied (see stepSatisfied). */
  maxVisited: number;
  goTo: (i: number) => void;
  next: () => void;
  back: () => void;
  state: SetupState;
  update: (patch: Partial<SetupState>) => void;
  addInvite: (invite: SetupInvite) => void;
  removeInvite: (index: number) => void;
  /** Replace the board draft (the pipeline step's only writer). No-op before the
   *  stored axis has landed — there is nothing to diff against yet. */
  setPipelineDraft: (draft: AxisDraft) => void;
  /** The operator asked to leave (close control, Escape). In PREVIEW this closes
   *  straight away — nothing is at stake in a walkthrough that writes nothing. In
   *  LIVE it raises `leaving` instead, because leaving is irreversible: the skip
   *  stamp closes the '/' gate for good. */
  onClose: () => void;
  /** Live mode only: the leave confirmation is showing, and the wizard is rendering
   *  it INSTEAD of the step (see SetupLeaveConfirm.tsx for why it replaces rather
   *  than stacks). */
  leaving: boolean;
  /** Confirm the departure — exactly what `onClose` used to do: stamp "skipped",
   *  drop the draft, close. */
  confirmLeave: () => void;
  /** Back to the step the operator was on, untouched. */
  cancelLeave: () => void;
  /** Complete — PERSISTS the setup (org name, language, brand, invites, and the
   *  board columns when they were changed), then closes — or, when that left the
   *  operator something to act on (an invite link to share, a part that did not
   *  land), stays open on `receipt`. `after` runs once the run has closed (the
   *  tour tile's sim.start), never while the writes are still in flight. */
  finish: (after?: () => void) => void;
  /** Live mode only: the finish receipt the wizard renders INSTEAD of the steps
   *  (SetupFinishReceipt.tsx). Null while there is none. */
  receipt: SetupFinishReceipt | null;
  /** A Retry of the failed parts is in flight. */
  retrying: boolean;
  /** Re-run only the failed, retryable parts (finishRemainder). */
  retryFinish: () => void;
  /** The receipt's Done: stamp the run completed, clear the draft, close, then run
   *  whatever finish() deferred. */
  closeReceipt: () => void;
  /** Done will also start the guided demo (the tour tile deferred it). */
  receiptStartsTour: boolean;
  /** True when the active step's required input is satisfied (gates Next). */
  canAdvance: boolean;
  isLast: boolean;
};
