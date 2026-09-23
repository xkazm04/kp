// Canonical pipeline / funnel stage axis + the archetype-fairness predicate.
//
// Kept in a pure, DB-free module (no better-sqlite3 import) so the fairness metric
// is unit-testable in isolation and so the stage order has one single source. db.ts
// re-exports these, so existing `import { PIPELINE_STAGES } from "./db/pipeline";` call sites
// keep working unchanged.

// Consolidated 5-stage model. "Accepted" = CV received (inbound or proactively
// sourced), waiting for screening; "Screened" = run through the first wave of
// evaluation (matching + AI screening). Legacy Sourced→Accepted and
// AI-matched/Screening→Screened are remapped by migratePipelineStages() on boot.
export const PIPELINE_STAGES = ["Accepted", "Screened", "Interview", "Offer", "Hired"] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

// Accepted is now a real first stage IN the canonical progression, so the funnel
// axis is just the pipeline stages — no separate prefix.
export const FUNNEL_STAGES = PIPELINE_STAGES;
export type FunnelStage = (typeof FUNNEL_STAGES)[number];

// ---- Stage ROLES: what a stage MEANS, independent of what it is called -------
//
// The board's five columns are about to become workspace-editable (Settings →
// Hiring composes them). That is only survivable if nothing derives meaning from
// a stage's NAME, because today almost everything does: the fairness metric is
// literally `indexOf(stage) >= indexOf("Interview")`, the move menu excludes the
// string "Hired", org benchmarks index off "Interview". Rename or reorder a stage
// under those and they quietly answer a different question.
//
// A role is the stable half. `isPastScreening` becomes "after the last screening
// role", the move menu excludes "the terminal role", benchmarks index the first
// interview role — all of which keep working when a workspace renames Accepted to
// "New applicants" or splits Interview into three rounds.
//
// `scoring` is the automated pass that turns a conversation into a comparable
// number — the step between an AI interview and a human one in the shape most
// teams actually run. It is a column of its own rather than a property of the
// interview because it is a distinct thing the product DOES (and a distinct thing
// a human can be asked to ratify), and because a candidate genuinely waits there.
//
// `homework` is the work-sample / case step: the product GENERATES an assignment
// for the candidate standing there, sends it, and evaluates what comes back. It is
// its own role rather than a `custom` column because real functionality binds to
// it (the devcase module runs on entry, and the AI interview that follows grounds
// its questions in the evaluated case), and because a candidate genuinely waits
// there while the machine works.
//
// It sits BEFORE the screening gate — the gate is "did they get a real look",
// which the first interview column answers, and a case precedes that conversation.
// But it is NOT a screening column: nothing triages a CV there, so
// `screeningStageIds` / `isScreeningStage` exclude it and the manual "Screen with
// AI" action is not offered on it. Those two helpers therefore mean "pre-gate
// columns that actually screen", which is a narrower set than "pre-gate columns";
// `hasAdvancedPastScreening` stays purely ordinal and is unaffected.
//
// `custom` is the escape hatch for a stage a workspace invents that maps to none
// of the product's semantics; it participates in ordering and nothing else.
export type StageRole = "entry" | "screening" | "homework" | "interview" | "scoring" | "offer" | "terminal" | "custom";

/** One column on the board: a stable `id` (what is STORED, never shown), a
 *  freely-editable `label` (what is SHOWN), and the `role` that carries meaning.
 *
 *  `id` is deliberately the stage's current canonical NAME rather than a fresh
 *  slug: the whole point of separating id from label is that renaming touches no
 *  rows, and minting new ids now would force a data migration across
 *  `pipeline_entries.stage`, both `pipeline_events` stage columns, the analytics
 *  history and the ATS field map for zero behavioural gain. Ids stay as they are;
 *  labels become editable when the axis becomes per-workspace data. */
/** The AI actions a recruiter can run on ONE candidate from the candidate modal — a
 *  closed vocabulary (literal array + derived union + guard). WHICH of them a column
 *  offers is resolved in stage-ai-actions.ts: the stage's own `actions` when the
 *  workspace set them in Settings → Hiring, else the product default by role. */
export const STAGE_AI_ACTIONS = ["screen", "prep", "scorecard", "offer", "outreach", "rejection", "rematch"] as const;
export type StageAiAction = (typeof STAGE_AI_ACTIONS)[number];

export function isStageAiAction(value: unknown): value is StageAiAction {
  return typeof value === "string" && (STAGE_AI_ACTIONS as readonly string[]).includes(value);
}

export type StageDef = {
  id: string;
  label: string;
  role: StageRole;
  /** The AI actions this column offers, when the workspace customised them. Absent =
   *  the product default for the role; an empty list is a real answer (nothing runs). */
  actions?: readonly StageAiAction[];
  /** The team's aging cadence for this column, in whole days (1..365), when the
   *  workspace set one. Absent = the default for the ROLE (aging-policy.ts). Team data
   *  on the axis, so the board, the sidebar badge and the automation pass all age on
   *  the same number; never present on the terminal column (a hire has no clock). */
  slaDays?: number;
};

/** The role each canonical stage plays. Exhaustive over PipelineStage, so adding a
 *  stage to the axis without deciding what it MEANS is a compile error. */
export const STAGE_ROLE: Record<PipelineStage, StageRole> = {
  Accepted: "entry",
  Screened: "screening",
  Interview: "interview",
  Offer: "offer",
  Hired: "terminal",
};

/** The out-of-the-box axis — the ONE literal both the board and the Settings →
 *  Hiring composer read, so the composer can never offer a station the board
 *  does not render. A workspace's own axis (later phase) starts as a copy. */
export const DEFAULT_STAGE_AXIS: readonly StageDef[] = PIPELINE_STAGES.map((id) => ({
  id,
  label: id,
  role: STAGE_ROLE[id],
}));

/** Position of `id` on `axis`, or -1. The one place ordering is read. */
export function stageIndex(id: string, axis: readonly StageDef[] = DEFAULT_STAGE_AXIS): number {
  return axis.findIndex((s) => s.id === id);
}

/** Every stage id carrying `role`, in axis order. */
export function stagesWithRole(role: StageRole, axis: readonly StageDef[] = DEFAULT_STAGE_AXIS): string[] {
  return axis.filter((s) => s.role === role).map((s) => s.id);
}

/** The single stage a role that must be unique resolves to (entry / terminal /
 *  offer), or null when the axis carries none. */
export function stageWithRole(role: StageRole, axis: readonly StageDef[] = DEFAULT_STAGE_AXIS): string | null {
  return axis.find((s) => s.role === role)?.id ?? null;
}

/** The role a stage id plays on `axis`, or null for an id the axis does not
 *  declare (a retired column, a legacy row). Null is the honest answer: an
 *  off-axis stage has no meaning to resolve, and guessing one would let a rule
 *  fire on a candidate nobody has classified yet. */
export function roleOf(id: string, axis: readonly StageDef[] = DEFAULT_STAGE_AXIS): StageRole | null {
  return axis.find((s) => s.id === id)?.role ?? null;
}

/** Does `id` play `role` on this axis? The replacement for every `stage ===
 *  "Hired"` / `=== "Offer"` in the codebase: those read a NAME to ask a question
 *  about MEANING, which stops being true the moment a workspace renames a column.
 *
 *  Reads false for an off-axis id — see roleOf. A candidate standing on a retired
 *  column is not "at the terminal stage" just because it used to be called Hired. */
export function stageHasRole(id: string, role: StageRole, axis: readonly StageDef[] = DEFAULT_STAGE_AXIS): boolean {
  return roleOf(id, axis) === role;
}

/** The index a candidate must REACH to count as past the screening gate: the first
 *  stage where real evaluation happens. Normally the first `interview` stage;
 *  an axis with no interview round falls back to `offer`, then `terminal`, and
 *  finally to "nothing is past the gate" (axis.length) rather than crashing or
 *  silently declaring everyone advanced.
 *
 *  Expressed as "the first stage of a role" rather than "after the last screening
 *  stage" on purpose: a workspace may add several screening-ish stages, or none,
 *  and the question the fairness metric asks is always "did they get a real look",
 *  not "how many pre-stages were there". */
/** Where an ALREADY-SCREENED candidate belongs: the last stage before the
 *  screening gate — i.e. "evaluated, waiting on the interview decision". Falls
 *  back to the entry stage, then the first column, so this always names a real
 *  place to put somebody.
 *
 *  Used by the paths that file a candidate who has already been assessed (a
 *  rematch redirect, an ATS import carrying a screened status) rather than
 *  hardcoding "Screened", which is only that stage's name on the default axis. */
export function screenedLandingStage(axis: readonly StageDef[] = DEFAULT_STAGE_AXIS): string {
  const gate = screeningGateIndex(axis);
  const before = axis.slice(0, gate);
  return before[before.length - 1]?.id ?? axis[0]?.id ?? "";
}

export function screeningGateIndex(axis: readonly StageDef[] = DEFAULT_STAGE_AXIS): number {
  for (const role of ["interview", "offer", "terminal"] as const) {
    const i = axis.findIndex((s) => s.role === role);
    if (i >= 0) return i;
  }
  return axis.length;
}

/** True when an entry at `stage` has advanced PAST the screening gate — i.e. has
 *  reached the first real-evaluation stage or beyond. This is the headline
 *  archetype-fairness metric ("{pct}% advanced past screening"): screening is the
 *  gate that most often filters out non-traditional candidates, so the equity
 *  story is whether they CLEARED it (got a real interview), not merely whether
 *  they reached Screened. A candidate sitting AT Screened has NOT advanced past
 *  it. Mirrors the byJob "reached interview" threshold so the two funnel metrics
 *  stay consistent. Single source for both the computation and its label.
 *
 *  Reads the gate from ROLES (screeningGateIndex), not from the literal string
 *  "Interview": a workspace that renames or splits its interview stage must not
 *  silently change what this metric measures. On the default axis the answer is
 *  byte-identical to the old `indexOf(stage) >= indexOf("Interview")`. */
export function hasAdvancedPastScreening(stage: string, axis: readonly StageDef[] = DEFAULT_STAGE_AXIS): boolean {
  const i = stageIndex(stage, axis);
  return i >= 0 && i >= screeningGateIndex(axis);
}

// The pre-interview screening stages — the funnel positions where a manual
// "Screen with AI" run is meaningful, exactly the stages BEFORE the screening
// gate. "Accepted" (CV received) screens a fresh applicant INTO "Screened";
// "Screened" (matched + AI-screened) screens them on toward "Interview". Defined
// here, off the canonical axis, so the drawer's action gate and
// runAutomationTask's screen handler read ONE set instead of each hardcoding
// stage literals. In exact lockstep with hasAdvancedPastScreening BY
// CONSTRUCTION now — both read screeningGateIndex, so "screening stage" and "not
// yet past screening" cannot drift apart (the pipeline-screening test still pins
// the pair).
export const SCREENING_STAGES = ["Accepted", "Screened"] as const;
export type ScreeningStage = (typeof SCREENING_STAGES)[number];

/** The screening stages of an axis: everything before the screening gate, MINUS
 *  the homework columns. A case step is pre-gate but nothing triages a CV there —
 *  a "Screen with AI" run at a homework column would advance a candidate past the
 *  assignment the column exists to give them. See the StageRole comment. */
export function screeningStageIds(axis: readonly StageDef[] = DEFAULT_STAGE_AXIS): string[] {
  return axis
    .slice(0, screeningGateIndex(axis))
    .filter((s) => s.role !== "homework")
    .map((s) => s.id);
}

export function isScreeningStage(stage: string, axis: readonly StageDef[] = DEFAULT_STAGE_AXIS): stage is ScreeningStage {
  const i = stageIndex(stage, axis);
  return i >= 0 && i < screeningGateIndex(axis) && axis[i].role !== "homework";
}

// The pipeline effect of a manual AI screen run at `stage`, given the screen
// `route` ∈ {advance, hold} (the {advance,hold} subset of the verdict taxonomy —
// see SCREEN_ROUTES; a weak/early-career verdict is already coerced to "hold" by
// the fairness gate in screen_candidate, so a screen NEVER auto-rejects).
//   - advance:       advance the entry ONE stage (Accepted→Screened, Screened→Interview).
//   - holdForReview: set a screening_review approval + log a screening_hold so a
//                    human resolves it in the Decisions queue.
//   - applied:       the AutomationResult.applied label the drawer surfaces.
export type ScreenStageOutcome = { advance: boolean; holdForReview: boolean; applied: string };

/** Decide what a manual AI screen does at a given stage. Pure, so the
 *  Accepted-stage triage contract is unit-tested in isolation; runAutomationTask
 *  applies the effects.
 *
 *  Accepted is the funnel entry: screening a fresh applicant ALWAYS moves them
 *  into Screened — the same fair, archetype-neutral, never-reject Accepted→Screened
 *  move the policy pass makes once a candidate is scored. The screen's confidence
 *  only decides how they land: a clean "advance" lands them in Screened ready for
 *  the interview gate; a cautious "hold" lands them in Screened flagged for human
 *  review. Either way the screening_review ends up on a Screened entry, so the
 *  existing Decisions→Interview machinery (calendar queue, interview-prep) is
 *  reused unchanged. From Screened a clean advance moves to Interview; otherwise it
 *  holds in place for review. A non-screening stage is advisory only — the verdict
 *  is informational and nothing moves. */
export function screenStageOutcome(stage: string, route: string): ScreenStageOutcome {
  if (!isScreeningStage(stage)) return { advance: false, holdForReview: false, applied: "advisory" };
  const cleared = route === "advance";
  if (stage === "Accepted") {
    return { advance: true, holdForReview: !cleared, applied: cleared ? "advanced" : "held_for_review" };
  }
  return { advance: cleared, holdForReview: !cleared, applied: cleared ? "advanced" : "held_for_review" };
}
