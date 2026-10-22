// ADR 0027 S3 - THE EVIDENCE LADDER. One channel-neutral, read-only account of how a
// candidate works with AI, assembled from the three rungs the ADR names:
//
//   WATCHED   in the case       - the verification acts a Live Work Surface session
//                                 recorded (C1) and whether its timeline was witnessed (C2);
//   DEFENDED  in the debrief    - the interviewer's recorded findings, one per follow-up (C3/C4);
//   QUOTED    in the interview  - the "Working with AI tools" BARS axis (S1), as rated.
//
// DESCRIPTIVE ONLY. There is no aggregate, no blended number and no level across rungs,
// and nothing here feeds the match total: the tiger verdict (cluster A) rejected a folded
// score as buzzword risk. Each rung says what it saw and why, or that it has nothing yet,
// and a person decides. Pure: the caller hands in what the surfaces already load.

import { OPTIONAL_AXES } from "../interview-rubric";

export const LADDER_RUNGS = ["watched", "defended", "quoted"] as const;
export type LadderRung = (typeof LADDER_RUNGS)[number];

/** Every reasons line the ladder can say, each a key under `evidenceLadder.reasons`. */
export const LADDER_REASON_KEYS = [
  "watchedActs",
  "watchedTest",
  "watchedAssistant",
  "watchedStakeholder",
  "watchedPlanted",
  "witness_witnessed",
  "witness_neutral",
  "witness_unwitnessed",
  "defendedSupported",
  "defendedRevised",
  "defendedNotEvidenced",
  "defendedNotAsked",
  "defendedHeld",
  "defendedCleared",
  "quotedRatings",
  "quotedNoEvidence",
] as const;
export type LadderReasonKey = (typeof LADDER_REASON_KEYS)[number];

/** A reasons line: a catalog key plus its ICU values. */
export type LadderReason = { key: LadderReasonKey; values?: Record<string, string | number> };

/** Why a rung has nothing to show. Each one is a different fact, said plainly:
 *  no_case       no work sample is attached to this candidate;
 *  not_evaluated a work sample exists but has not been evaluated;
 *  not_watched   a repository submission, so nothing was watched live;
 *  no_followups  the evaluation minted no debrief questions;
 *  not_recorded  the debrief has not been recorded;
 *  not_rated     no interviewer has rated the axis. */
export const EMPTY_CAUSES = ["no_case", "not_evaluated", "not_watched", "no_followups", "not_recorded", "not_rated"] as const;
export type EmptyCause = (typeof EMPTY_CAUSES)[number];

export type EmptyRung = { rung: LadderRung; state: "empty"; cause: EmptyCause };

/** Verification acts by channel, the same four `evaluate.verification_acts` counts. No
 *  channel is weighted above another; planted defects count once however many were caught. */
export type WatchedChannels = {
  editedTest: boolean;
  assistantAsks: number;
  stakeholderAsks: number;
  plantedCaught: number;
  plantedGraded: number;
};
export type WitnessKind = "witnessed" | "neutral" | "unwitnessed" | "unknown";
export type WatchedRung = {
  rung: "watched";
  state: "evidence";
  acts: number;
  channels: WatchedChannels;
  witness: WitnessKind;
  reasons: LadderReason[];
};

export type DebriefTally = { supported: number; revised: number; notEvidenced: number; notAsked: number; total: number };
export type DebriefQuote = { followupIndex: number; kind: "revised" | "not_evidenced"; quote: string };
export type DefendedRung = {
  rung: "defended";
  state: "evidence";
  tally: DebriefTally;
  quotes: DebriefQuote[];
  /** Was the submission held for authorship, and has a person cleared it. */
  hold: "none" | "held" | "cleared";
  reasons: LadderReason[];
};

export type QuotedRating = { rating: number; evidence: string | null; by: "human" | "ai"; author: string | null; savedAt: string | null };
export type QuotedRung = { rung: "quoted"; state: "evidence"; ratings: QuotedRating[]; reasons: LadderReason[] };

export type EvidenceLadder = {
  watched: WatchedRung | EmptyRung;
  defended: DefendedRung | EmptyRung;
  quoted: QuotedRung | EmptyRung;
};

/** The S1 competency, read from the same rubric file the scorer and the scorecard use. */
export const AI_TOOLS_COMPETENCY: string = OPTIONAL_AXES.dev_case?.[0]?.competency ?? "Working with AI tools";

const CAUGHT = new Set(["addressed", "flagged"]);
const GRADED = new Set(["addressed", "flagged", "propagated"]);
const WITNESS: readonly WitnessKind[] = ["witnessed", "neutral", "unwitnessed", "unknown"];

function rec(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
function count(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

/** The WATCHED rung from a persisted evaluation bundle. `submission` says whether a work
 *  sample is attached at all; `bundle` is its evaluation (null until evaluated). */
export function watchedRung(submission: boolean, bundle: unknown): WatchedRung | EmptyRung {
  if (!submission) return { rung: "watched", state: "empty", cause: "no_case" };
  const b = rec(bundle);
  if (!b) return { rung: "watched", state: "empty", cause: "not_evaluated" };
  // `tooling.signals` is written only for a watched (Live Work Surface) session; a repo
  // submission has none, and that absence means "not watched", never "did not verify".
  const signals = rec(rec(b.tooling)?.signals);
  if (!signals) return { rung: "watched", state: "empty", cause: "not_watched" };
  const checks = rec(b.observedChecks);
  const prompts = rec(checks?.promptSignals);
  const canaries = Array.isArray(checks?.canaryOutcomes) ? (checks.canaryOutcomes as unknown[]) : [];
  const statuses = canaries.map((c) => rec(c)?.status).filter((s): s is string => typeof s === "string");
  const channels: WatchedChannels = {
    editedTest: signals.editedTest === true,
    assistantAsks: count(prompts?.verificationAsks),
    stakeholderAsks: count(prompts?.stakeholderVerificationAsks),
    plantedCaught: statuses.filter((s) => CAUGHT.has(s)).length,
    plantedGraded: statuses.filter((s) => GRADED.has(s)).length,
  };
  const acts =
    (channels.editedTest ? 1 : 0) + channels.assistantAsks + channels.stakeholderAsks + (channels.plantedCaught > 0 ? 1 : 0);
  const rawWitness = rec(rec(b.integrity)?.witness)?.verdict;
  const witness: WitnessKind = WITNESS.includes(rawWitness as WitnessKind) ? (rawWitness as WitnessKind) : "unknown";

  const reasons: LadderReason[] = [{ key: "watchedActs", values: { count: acts } }];
  if (channels.editedTest) reasons.push({ key: "watchedTest" });
  if (channels.assistantAsks) reasons.push({ key: "watchedAssistant", values: { count: channels.assistantAsks } });
  if (channels.stakeholderAsks) reasons.push({ key: "watchedStakeholder", values: { count: channels.stakeholderAsks } });
  if (channels.plantedGraded) {
    reasons.push({ key: "watchedPlanted", values: { caught: channels.plantedCaught, graded: channels.plantedGraded } });
  }
  if (witness !== "unknown") reasons.push({ key: `witness_${witness}` as const });
  return { rung: "watched", state: "evidence", acts, channels, witness, reasons };
}

/** The debrief readout GET /api/interview-prep/scorecard?debrief=<submission> answers. */
export type DebriefReadoutInput = {
  findings?: unknown;
  recorded?: unknown;
  total?: unknown;
  held?: unknown;
  clearedBy?: unknown;
};

/** The DEFENDED rung. `submission` as above; `debrief` null until it was read. */
export function defendedRung(submission: boolean, evaluated: boolean, debrief: DebriefReadoutInput | null): DefendedRung | EmptyRung {
  if (!submission) return { rung: "defended", state: "empty", cause: "no_case" };
  if (!evaluated) return { rung: "defended", state: "empty", cause: "not_evaluated" };
  const total = count(debrief?.total);
  if (!debrief || total === 0) return { rung: "defended", state: "empty", cause: "no_followups" };
  if (debrief.recorded !== true) return { rung: "defended", state: "empty", cause: "not_recorded" };
  const findings = (Array.isArray(debrief.findings) ? debrief.findings : []).map(rec).filter((f) => f !== null);
  const tally: DebriefTally = { supported: 0, revised: 0, notEvidenced: 0, notAsked: 0, total };
  const quotes: DebriefQuote[] = [];
  for (const f of findings) {
    const kind = f.kind;
    if (kind === "supported") tally.supported += 1;
    else if (kind === "revised") tally.revised += 1;
    else if (kind === "not_evidenced") tally.notEvidenced += 1;
    else tally.notAsked += 1;
    if ((kind === "revised" || kind === "not_evidenced") && typeof f.quote === "string" && f.quote.trim()) {
      quotes.push({ followupIndex: count(f.followupIndex), kind, quote: f.quote.trim() });
    }
  }
  const hold = typeof debrief.clearedBy === "string" && debrief.clearedBy ? "cleared" : debrief.held === true ? "held" : "none";
  const reasons: LadderReason[] = [{ key: "defendedSupported", values: { supported: tally.supported, total } }];
  if (tally.revised) reasons.push({ key: "defendedRevised", values: { count: tally.revised } });
  if (tally.notEvidenced) reasons.push({ key: "defendedNotEvidenced", values: { count: tally.notEvidenced } });
  if (tally.notAsked) reasons.push({ key: "defendedNotAsked", values: { count: tally.notAsked } });
  if (hold !== "none") reasons.push({ key: hold === "cleared" ? "defendedCleared" : "defendedHeld" });
  return { rung: "defended", state: "evidence", tally, quotes, hold, reasons };
}

type RatingLike = { competency?: unknown; rating?: unknown; evidence?: unknown };
type ScorecardLike = { ratings?: unknown; authorLabel?: unknown; savedAt?: unknown };

function aiToolsRating(ratings: unknown): { rating: number; evidence: string | null } | null {
  if (!Array.isArray(ratings)) return null;
  const hit = (ratings as RatingLike[]).find((r) => rec(r) && r.competency === AI_TOOLS_COMPETENCY);
  if (!hit || typeof hit.rating !== "number" || !Number.isFinite(hit.rating)) return null;
  const evidence = typeof hit.evidence === "string" && hit.evidence.trim() ? hit.evidence.trim() : null;
  return { rating: hit.rating, evidence };
}

/** The QUOTED rung from the interview scorecards the candidate bundle carries: every
 *  human record, then the AI interview's own scorecard. Each rating is shown as given,
 *  side by side; they are never averaged. */
export function quotedRung(humanScorecards: readonly ScorecardLike[], aiInterview: ScorecardLike | null): QuotedRung | EmptyRung {
  const ratings: QuotedRating[] = [];
  for (const card of humanScorecards) {
    const r = aiToolsRating(card.ratings);
    if (!r) continue;
    ratings.push({
      ...r,
      by: "human",
      author: typeof card.authorLabel === "string" && card.authorLabel ? card.authorLabel : null,
      savedAt: typeof card.savedAt === "string" ? card.savedAt : null,
    });
  }
  const ai = aiInterview ? aiToolsRating(aiInterview.ratings) : null;
  if (ai) ratings.push({ ...ai, by: "ai", author: null, savedAt: null });
  if (ratings.length === 0) return { rung: "quoted", state: "empty", cause: "not_rated" };
  const reasons: LadderReason[] = [{ key: "quotedRatings", values: { count: ratings.length } }];
  if (ratings.some((r) => r.evidence === null)) reasons.push({ key: "quotedNoEvidence" });
  return { rung: "quoted", state: "evidence", ratings, reasons };
}

export type LadderInput = {
  /** Is a work sample attached to this candidate (an assignment or its submission). */
  submission: boolean;
  /** The submission's persisted evaluation bundle, or null when not yet evaluated. */
  evaluation: unknown;
  debrief: DebriefReadoutInput | null;
  humanScorecards: readonly ScorecardLike[];
  aiInterview: ScorecardLike | null;
};

export function evidenceLadder(input: LadderInput): EvidenceLadder {
  return {
    watched: watchedRung(input.submission, input.evaluation),
    defended: defendedRung(input.submission, rec(input.evaluation) !== null, input.debrief),
    quoted: quotedRung(input.humanScorecards, input.aiInterview),
  };
}
