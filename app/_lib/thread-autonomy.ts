// Per-role thread autonomy over the board — the read that scores goal 14b80beb
// ("one role runs end to end without a human step") itself rather than the delivery
// proxy scripts/kpi/role-run-anchors.mjs reports. Idea 42a4ecec; ADR-0011 §Consequences.
//
// PURE and DB-free on purpose, like role-run-stages.ts and decision-attribution.ts: the
// projection and the attribution rule are the two things worth unit-pinning, and the
// store read (db/thread-autonomy.ts) is a thin grouping shell around them.
//
// THE LADDER is ROLE_RUN_STAGES (JD -> sourced -> screened -> case -> interview ->
// scorecard -> offer), not a parallel vocabulary. A pipeline event is projected onto it
// two ways, in this order:
//   1. by KIND, for the kinds whose rung is intrinsic (`scored` is screening whatever
//      the board calls its columns);
//   2. by the ROLE of the stage the event moved the entry to (`toStage`), resolved on
//      the workspace's axis — so renaming "Screened" never moves an event off its rung.
// An event neither rule places stays OFF the ladder and is counted in `unplacedEvents`;
// it is never guessed onto a rung.
//
// `role_spec` (the JD) is not witnessed by any pipeline event — a board has no event for
// "a JD existed" — so this read never reports it as reached. The role-run ledger's
// role_spec artifact is where that fact lives (role-run-metrics.ts).
//
// ATTRIBUTION: the event's own actor prefix first ("auto:*" / "human:*", via
// parseEventActor), then decisionAttribution(kind) for rows with no usable actor.
// "unknown" stays unknown: it never makes a rung autonomous, and it is reported.
//
// A "human" here is whatever the shared attribution map calls human — a recruiter's
// click AND a candidate's own act (an application, an offer reply). That is the one
// meaning the decision log and the analytics rollup already share; this module does
// not narrow it.

import { decisionAttribution, parseEventActor } from "./decision-attribution.ts";
import { DEFAULT_STAGE_AXIS, roleOf, type StageDef, type StageRole } from "./pipeline-stages.ts";
import { ROLE_RUN_STAGES, roleRunStageIndex, type RoleRunStageKind } from "./role-run-stages.ts";

export type ThreadEvent = {
  kind: string;
  /** pipeline_events.actor — "auto:<engine>" / "human:<who>" / null for a legacy row. */
  actor?: string | null;
  /** The stage the event moved the entry to, when it moved one. */
  toStage?: string | null;
  createdAt: string;
};

export type EventAttribution = "auto" | "human" | "unknown";

/** Kinds whose rung does not depend on how a workspace named its columns. Deliberately
 *  short: a kind that can happen at several rungs (`rejected`, `advanced`, `moved`) is
 *  absent and falls through to the stage the event landed on. */
const KIND_RUNG: Readonly<Record<string, RoleRunStageKind>> = {
  applied: "slate",
  re_applied: "slate",
  added: "slate",
  matched: "slate",
  observed_minted: "slate",
  outreach_sent: "slate",
  scored: "screen",
  screening_hold: "screen",
  auto_rejected: "screen",
  ko_declined: "screen",
  screen_wave_holdout: "screen",
  screen_wave_recruiter_spared: "screen",
  interview_invite_sent: "interview",
  schedule_invite_sent: "interview",
  interview_scheduled: "interview",
  interview_reminder_sent: "interview",
  interview_prep_generated: "interview",
  interview_scorecard: "scorecard",
  offer_drafted: "offer_draft",
  offer_sent: "offer_draft",
  offer_accepted: "offer_draft",
  offer_declined: "offer_draft",
  offer_expired: "offer_draft",
};

/** The board's stage ROLE -> the ladder rung it stands for. `terminal` (Hired) sits on the
 *  top rung: reaching it presupposes an offer. `custom` has no meaning to project. */
const ROLE_RUNG: Readonly<Record<StageRole, RoleRunStageKind | null>> = {
  entry: "slate",
  screening: "screen",
  homework: "case_assignment",
  interview: "interview",
  scoring: "scorecard",
  offer: "offer_draft",
  terminal: "offer_draft",
  custom: null,
};

/** The rung an event stands on, or null when neither rule places it. */
export function eventRung(event: Pick<ThreadEvent, "kind" | "toStage">, axis: readonly StageDef[] = DEFAULT_STAGE_AXIS): RoleRunStageKind | null {
  const byKind = KIND_RUNG[event.kind];
  if (byKind) return byKind;
  if (!event.toStage) return null;
  const role = roleOf(event.toStage, axis);
  return role ? ROLE_RUNG[role] : null;
}

/** Who acted: the actor prefix first, the kind's attribution only when the row has none. */
export function eventAttribution(event: Pick<ThreadEvent, "kind" | "actor">): EventAttribution {
  const actor = parseEventActor(event.actor).kind;
  return actor !== "unknown" ? actor : decisionAttribution(event.kind);
}

export type ThreadAutonomy = {
  /** Distinct ladder rungs at least one event stands on. */
  stagesReached: number;
  /** Reached rungs where every event is machine-attributed — none human, none unknown. */
  stagesAutonomous: number;
  /** The lowest rung with a human event, or null when no placed event is human. */
  firstHumanStage: RoleRunStageKind | null;
  /** The kind of the earliest human event on that rung. */
  firstHumanKind: string | null;
  /** Events whose attribution could not be determined. Never counted as autonomous. */
  unknownEvents: number;
  /** Events neither projection rule could place on the ladder. */
  unplacedEvents: number;
};

export const EMPTY_THREAD_AUTONOMY: Readonly<ThreadAutonomy> = Object.freeze({
  stagesReached: 0,
  stagesAutonomous: 0,
  firstHumanStage: null,
  firstHumanKind: null,
  unknownEvents: 0,
  unplacedEvents: 0,
});

/** Score ONE job's thread from its pipeline events. Order of `events` does not matter. */
export function threadAutonomy(events: readonly ThreadEvent[], axis: readonly StageDef[] = DEFAULT_STAGE_AXIS): ThreadAutonomy {
  type Rung = { events: number; clean: boolean; firstHuman: ThreadEvent | null };
  const rungs = new Map<RoleRunStageKind, Rung>();
  let unknownEvents = 0;
  let unplacedEvents = 0;

  for (const event of events) {
    const attribution = eventAttribution(event);
    if (attribution === "unknown") unknownEvents += 1;
    const stage = eventRung(event, axis);
    if (!stage) {
      unplacedEvents += 1;
      continue;
    }
    const rung = rungs.get(stage) ?? { events: 0, clean: true, firstHuman: null };
    rung.events += 1;
    if (attribution !== "auto") rung.clean = false;
    if (attribution === "human" && (!rung.firstHuman || event.createdAt < rung.firstHuman.createdAt)) rung.firstHuman = event;
    rungs.set(stage, rung);
  }

  const firstHumanRung = ROLE_RUN_STAGES.find((stage) => rungs.get(stage)?.firstHuman) ?? null;
  return {
    stagesReached: rungs.size,
    stagesAutonomous: [...rungs.values()].filter((r) => r.clean).length,
    firstHumanStage: firstHumanRung,
    firstHumanKind: firstHumanRung ? (rungs.get(firstHumanRung)?.firstHuman?.kind ?? null) : null,
    unknownEvents,
    unplacedEvents,
  };
}

/** 1-based position of a rung on the ladder, for a reader that wants "stage 3". */
export function ladderPosition(stage: RoleRunStageKind): number {
  return roleRunStageIndex(stage) + 1;
}
