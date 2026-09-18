// The interview SIMULATOR's contract (spark interview-uat-tranche).
//
// WHAT IT IS. A development instrument that drives the REAL directed interviewer — the
// same brief composition, the same agenda, the same pure director policy and the same
// tool results production returns — against simulated candidates, in text, on a
// throwaway database, with a SIMULATED clock. It is the /uat "LC" (conversation) level:
// cheaper than a browser run and parallelisable, but exercising the actual instrument
// rather than a paraphrase of it (registry: conversational-assessment-validation —
// "separate the policy from the medium"; "every variant must be exercisable outside
// the application").
//
// WHAT IT IS NOT. A voice test. A text stand-in plays the interviewer, so defects that
// live only in the speech channel (recognition, turn-taking, latency, barge-in) stay
// the voice smoke's job. It never touches the operator's database or bills a minute.
//
// Why the engine lives under app/_lib rather than scripts/: the unit-test runner only
// collects app/**, packages/**, edge/** and i18n/**, and a simulator whose own logic
// is untested is not an instrument anyone should trust. The CLI entry sits in scripts/.

import type { DirectorToolName } from "../voice/director-types";

/** Which grounding a simulated interview is built from — one per branch of the real
 *  agenda builder, plus the kit rehearsal path. */
export const SIM_FIXTURES = ["kit", "prep", "debrief", "student", "rehearsal"] as const;
export type SimFixture = (typeof SIM_FIXTURES)[number];

/** One situation the interviewer must survive: a candidate behaviour, played by a
 *  model under a persona prompt, against one fixture. `provokes` names the reliability
 *  invariants this situation is DESIGNED to test, so a run can tell "passed" from "was
 *  never provoked" (registry: a reliability verdict has four states, not two). */
export type SimSituation = {
  id: string;
  title: string;
  /** The behaviour axis (e.g. "terse", "asks_score", "withdraws_consent"). */
  behaviour: string;
  /** "en" | "cs" | "de" | "fr" — the language the candidate speaks. */
  language: string;
  fixture: SimFixture;
  /** The simulated candidate's system prompt. Never shown to the interviewer. */
  persona: string;
  /** An optional scripted first candidate line, so a provocation happens on cue. */
  firstMessage?: string;
  /** Invariant ids this situation exists to provoke. */
  provokes: string[];
  /** The invariant ids the scripted `firstMessage` ITSELF provokes (a subset of
   *  `provokes`) — set only where the first line really is the provocation. It is the
   *  keyless stimulus source for WP-2's verdicts (detectors.ts `keylessStimulus`): most
   *  first lines are a greeting and the behaviour comes later, which only a judge can find. */
  firstMessageProvokes?: string[];
  /** What a good interviewer does here, in one line — the judge reads it. */
  handles: string;
};

/** One line of a simulated conversation. `director` turns are the stage directions the
 *  harness injected; `tool` carries a tool call the interviewer made and the result the
 *  REAL director returned for it. */
export type SimTurn = {
  seq: number;
  role: "interviewer" | "candidate" | "director" | "system";
  text: string;
  /** Simulated milliseconds since the call started, on the simulated clock. */
  simAtMs: number;
  tool?: { name: DirectorToolName | string; args: unknown; result: string };
};

export type SimEndReason = "end_interview" | "director_end" | "hard_stop" | "max_turns" | "error";

/** Everything one simulated interview produced — enough to re-judge it offline. */
export type SimConversation = {
  runId: string;
  situationId: string;
  fixture: SimFixture;
  /** The instrument that was under test, recorded so a later diff can say what changed
   *  (registry: prompt-change-regression-baseline records the instrument text). */
  instrument: { briefSha: string; agendaBlockIds: string[]; directorVersion: string };
  turns: SimTurn[];
  endedBy: SimEndReason;
  simElapsedMs: number;
  /** Model calls this conversation spent (both sides), for cost control. */
  calls: number;
  error?: string;
};

/** A reliability invariant's verdict. `not_provoked`: the situation never created the
 *  condition, so the invariant says nothing. `not_evaluable`: the transcript cannot
 *  support a verdict (it ended early, a turn was lost). Neither may be reported as a
 *  pass. */
export const SIM_VERDICT_STATES = ["pass", "fail", "not_provoked", "not_evaluable"] as const;
export type SimVerdictState = (typeof SIM_VERDICT_STATES)[number];

/** The text model the simulator talks to. One interface for both sides and for the
 *  judge; a scripted fake implements it for keyless tests. */
export interface SimLlm {
  readonly id: string;
  complete(opts: {
    system: string;
    /** Alternating turns from this speaker's point of view. */
    messages: { role: "user" | "assistant"; content: string }[];
    maxTokens?: number;
  }): Promise<string>;
}

// ---- the tool line protocol ------------------------------------------------------------

/** How the text stand-in interviewer calls a director tool: one line of its own,
 *  `<<tool {"name":"begin_topic","args":{"block_id":"b1"}}>>`, anywhere in its reply.
 *  The harness strips these lines before the candidate sees the reply, applies each
 *  through the REAL `applyDirectorTool`, and answers with a system line carrying the
 *  exact result string production returns. Production providers use native function
 *  calling; the protocol exists only because the text CLI has none. */
export const SIM_TOOL_LINE = /^<<tool\s+(\{.*\})>>\s*$/gm;
export const SIM_TOOL_LINE_EXAMPLE = '<<tool {"name":"begin_topic","args":{"block_id":"b1"}}>>';
