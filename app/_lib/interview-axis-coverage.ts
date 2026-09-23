// What the interview DIRECTOR recorded about each rubric axis — the compare grid's
// answer to "was this candidate asked about it?" (challenge-r07 voice-interview-api/B).
//
// The AI scorecard answers that question only by the model's own say-so: an axis the
// interview never reached is stored as a real 3 carrying "Not assessed…" evidence
// (interview-scorecard.ts, NOT_ASSESSED_RATING). A DIRECTED call (ADR 0010) keeps a
// better record: every agenda block names the rubric competency it gathers evidence
// for, and the event ledger says which blocks were begun and which were covered (a
// topic_covered is accepted only on a quote verified against the candidate's own
// turns). This module reads that record — through deriveDirectorState, the director's
// one derivation, never a second reading of the events — into one state per axis:
//
//   covered      a block for the axis was covered on verified evidence
//   asked        a block was begun but never covered
//   not_reached  the axis had a scored block and no attempt ever began it
//   not_planned  a rubric axis the agenda carried no scored block for
//
// plus how many kit must-asks the call ENDED owing. Counts and states only — no quote,
// question text or block title leaves this module, so the compare door adds no
// verbatim candidate words.
//
// Server-side (it value-imports the director). The browser imports the TYPES only.

import { deriveDirectorState, type DirectorEvent } from "./voice/director";
import type { InterviewAgenda } from "./voice/director-types";

export const AXIS_COVERAGE_STATES = ["covered", "asked", "not_reached", "not_planned"] as const;
export type AxisCoverageState = (typeof AXIS_COVERAGE_STATES)[number];

export type AxisCoverage = {
  /** Rubric axis (the rubric's spelling; a kit competency outside the rubric keeps its
   *  own) → what the director recorded. */
  byAxis: Record<string, AxisCoverageState>;
  /** Kit must-asks the call ended without asking. `null` when the record holds no
   *  accepted end_interview: the `must_ask_unasked` rows are written only there
   *  (voice/director.ts), so a dropped call concluded nothing — unknown, not 0. */
  mustAsksUnasked: number | null;
};

/** The slice of an interview_events row this reads (store rows pass straight in). */
export type CoverageEvent = DirectorEvent;

const RANK: Record<"covered" | "asked" | "not_reached", number> = { covered: 3, asked: 2, not_reached: 1 };

/** Per-axis coverage of one session, or `null` for an UNDIRECTED session (no stored
 *  agenda: the lab, an undirected provider, a human-only row) — never an
 *  all-`not_reached` map, which would accuse a call that simply was not directed. */
export function axisCoverage(input: {
  agenda: InterviewAgenda | null;
  events: readonly CoverageEvent[];
  rubricAxes: readonly string[];
}): AxisCoverage | null {
  const { agenda, events, rubricAxes } = input;
  if (!agenda || !Array.isArray(agenda.blocks)) return null;

  // Covered/begun sets are session-wide (every attempt), so the attempt and clock the
  // derivation asks for only have to be consistent, not "now".
  let lastAttempt = 1;
  let lastMs = 0;
  for (const e of events) {
    if (Number.isInteger(e.attempt) && e.attempt > lastAttempt) lastAttempt = e.attempt;
    const t = Date.parse(e.createdAt);
    if (Number.isFinite(t) && t > lastMs) lastMs = t;
  }
  const state = deriveDirectorState({ agenda, events, currentAttempt: lastAttempt, attemptStartedAtMs: null, nowMs: lastMs });
  const covered = new Set(state.coveredBlockIds);
  const begun = new Set(state.begunBlockIds);

  // Rubric spelling wins; lookups are case-insensitive, the same join the grid uses.
  const byAxis: Record<string, AxisCoverageState> = {};
  const keyOf = new Map<string, string>();
  for (const axis of rubricAxes) {
    if (typeof axis !== "string" || !axis || keyOf.has(axis.toLowerCase())) continue;
    keyOf.set(axis.toLowerCase(), axis);
  }
  for (const b of agenda.blocks) {
    if (!b || !b.scored || typeof b.competency !== "string" || !b.competency) continue;
    const lower = b.competency.toLowerCase();
    const key = keyOf.get(lower) ?? b.competency;
    if (!keyOf.has(lower)) keyOf.set(lower, key);
    const here: "covered" | "asked" | "not_reached" = covered.has(b.id) ? "covered" : begun.has(b.id) ? "asked" : "not_reached";
    const prev = byAxis[key];
    // Several blocks may feed one axis: the best record among them stands.
    if (prev === undefined || prev === "not_planned" || RANK[here] > RANK[prev]) byAxis[key] = here;
  }
  for (const axis of keyOf.values()) if (!(axis in byAxis)) byAxis[axis] = "not_planned";

  let ended = false;
  let owed = 0;
  for (const e of events) {
    if (e.kind === "end_requested" && e.payload?.refused !== true) ended = true;
    else if (e.kind === "must_ask_unasked") owed += 1;
  }
  return { byAxis, mustAsksUnasked: ended || owed > 0 ? owed : null };
}
