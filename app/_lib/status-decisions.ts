// EU AI-Act Art. 86 — the candidate-facing, REDACTED view of their own sealed
// decision history (docs/features/compliance/ai-act-conformity.md, formerly gap G11/G9).
// The operator dossier
// (/api/decisions/records) exposes the full sealed record: rationale text (which
// names the approving operator), payload snapshots, chain hashes, policy
// versions. None of that may cross the public token boundary — a candidate is
// owed an EXPLANATION of decisions about them, not the audit chain's internals
// or anyone else's data.
//
// Pure + browser-safe (no DB, no next imports): the token route feeds it sealed
// rows, the tests feed it literals. Consent gating (consentWithholdsPii) is
// applied HERE so the withholding rule is unit-pinned, not route-local.
import { consentWithholdsPii, type ConsentSnapshot } from "./consent";
import { decisionAttribution } from "./decision-attribution";

/** The decisive facts behind ONE decision — Art. 86's "main elements of the
 *  decision", in the shape the decision itself has.
 *
 *  A CLOSED DISCRIMINATED UNION, not an open bag. Every variant is a shape some
 *  extractor below produces out of a sealed payload, and the extractor is the only
 *  way a fact is ever built: no caller may hand-assemble one, so "what may cross
 *  the token boundary" stays a question with one answer per kind. Adding a kind's
 *  reasons means adding a variant AND its extractor AND its candidate copy — the
 *  three things `factsCoverage()` counts.
 *
 *  `type` is the discriminant, deliberately NOT named `kind`: the view already has
 *  a `kind` (the sealed record kind), and two fields with one name on one object
 *  is how a redaction bug gets written. */
export type CandidateDecisionFacts =
  /** A number the decision compared against a cutoff — the screen wave's
   *  score-vs-threshold pair. */
  | { type: "threshold"; score: number; threshold: number }
  /** A rubric verdict: WHICH competencies were assessed and what each scored.
   *  `competency` is the CANONICAL rubric key the scorecard stored, so the page
   *  localizes it through `rubricLabel` rather than shipping English. */
  | { type: "rubric"; dimensions: { competency: string; rating: number; ratingMax: number }[] };

/** What one sealed record is allowed to look like on the candidate's own wire.
 *  Exactly these fields — the shape is closed on purpose (leak tests pin it). */
export type CandidateDecisionView = {
  /** The sealed record kind (allowlisted below); the UI localizes it. */
  kind: string;
  createdAt: string;
  /** Who decided — derived from the sealed actor, never guessed (three-state so
   *  an unknown writer is never misattributed to the machine OR a human). */
  attribution: "automated" | "human" | "unknown";
  /** Structured reason code (e.g. "reject") for candidate-appropriate copy. */
  reasonCode: string;
  /** The decisive facts this kind's extractor could recover, or null when the kind
   *  has no extractor yet or the sealed payload did not actually carry them.
   *  NEVER fabricated: absent facts read as absent. */
  facts: CandidateDecisionFacts | null;
};

// The minimal sealed-record shape this module reads (structural, so the server
// store type satisfies it without this pure module importing the store).
export type SealedDecisionLike = {
  kind: string;
  actor: string;
  reasonCode: string;
  createdAt: string;
  payloadJson: string;
};

/** Sealed kinds a candidate may SEE. An allowlist, not a denylist: a future kind
 *  ships hidden-by-default and is exposed only once it has candidate-appropriate
 *  copy. Notably EXCLUDED: `screen_wave_holdout` (an internal calibration marker —
 *  the candidate was spared at random; not a decision that produced an effect on
 *  them) and the `policy:*`-ref policy seals (never entry-keyed anyway). */
export const CANDIDATE_VISIBLE_DECISION_KINDS: ReadonlySet<string> = new Set([
  "auto_rejected",
  "rejected",
  "advanced",
  "auto_advanced",
  "reinstated",
  "interview_scheduled",
  "interview_cancelled",
  "interview_no_show",
  "interview_proposal_declined",
  "ai_scorecard",
  "human_scorecard",
  "group_eval_lead",
  "group_eval_advisory",
  "offer_terms",
]);

/** Sealed-actor attribution. The record's own actor prefix ("auto:…"/"human:…")
 *  is authoritative — it is what was sealed. Only when a legacy/foreign actor
 *  carries no prefix do we fall back to the shared kind map
 *  (decision-attribution.ts), and an unmapped kind stays "unknown" rather than
 *  defaulting either way — misattributing accountability is the one failure
 *  mode this surface must never have. */
export function sealedActorAttribution(actor: string, kind: string): CandidateDecisionView["attribution"] {
  if (actor.startsWith("auto:")) return "automated";
  if (actor.startsWith("human:")) return "human";
  const byKind = decisionAttribution(kind);
  return byKind === "auto" ? "automated" : byKind === "human" ? "human" : "unknown";
}

/** The sealed record's `inputs` object, or null when the payload is absent,
 *  unparseable or not an object. Every extractor starts here, so a corrupt
 *  payload is one shape of "no facts" rather than a throw on a public route. */
function sealedInputs(payloadJson: string): Record<string, unknown> | null {
  let inputs: unknown;
  try {
    inputs = (JSON.parse(payloadJson) as { inputs?: unknown }).inputs;
  } catch {
    return null;
  }
  if (!inputs || typeof inputs !== "object") return null;
  return inputs as Record<string, unknown>;
}

/** The decisive score-vs-threshold pair out of an auto_rejected record's sealed
 *  inputs — the two numbers the screen wave actually compared (screen-wave.ts
 *  seals them as reasonParams). Anything non-numeric/absent → null (never
 *  fabricate a fact), and NO other input key ever crosses (approvedBy names the
 *  operator; group-eval inputs name other candidates). */
export function autoRejectFacts(payloadJson: string): CandidateDecisionFacts | null {
  const o = sealedInputs(payloadJson);
  if (!o) return null;
  const score = Number(o.score);
  const threshold = Number(o.threshold);
  if (!Number.isFinite(score) || !Number.isFinite(threshold)) return null;
  return { type: "threshold", score, threshold };
}

/** The rating scale a sealed rubric dimension is read on. Mirrors format.ts's
 *  RATING_MAX, restated here rather than imported because this module is the
 *  browser-safe redaction pipe and format.ts is not on its dependency budget;
 *  `status-decisions.test.ts` pins the two together so they cannot drift. */
export const CANDIDATE_RUBRIC_RATING_MAX = 5;

/** The most dimensions one rubric verdict may put on the wire. The fixed rubric is
 *  well under this; the ceiling exists because the ratings list originates in an
 *  LLM synthesis, and an unbounded list is an unbounded public response. */
export const MAX_CANDIDATE_RUBRIC_DIMENSIONS = 12;

/** Longest canonical competency key that may cross. Anything longer is not a
 *  rubric axis — it is free text that reached the `competency` field — and is
 *  dropped rather than truncated, because a half-sentence reads as a verdict. */
const MAX_COMPETENCY_LEN = 60;

/** The rubric verdict out of an `ai_scorecard` record's sealed inputs: which
 *  competencies the AI interviewer actually assessed and what each one scored.
 *
 *  What crosses is deliberately the SMALLEST thing that answers "on what was I
 *  judged" — the canonical competency key and its rating. What does NOT cross, and
 *  the reason for each:
 *   - `evidence`, the verbatim transcript quote the model picked out. It is the
 *     candidate's own words, so it is not a privacy leak, but it is a MODEL's
 *     selection presented as the decisive line, and a mis-transcribed quote
 *     (voice ASR — see ScorecardEntities) reads as something they did not say.
 *   - `summary` and `recommendation` prose: rationale-register text, the same
 *     material `rationale` is withheld for.
 *   - anything not in `dimensions` at all: the seal site writes that key and
 *     nothing else is read here, so a future input added to the seal cannot
 *     silently start crossing.
 *
 *  A NOT-ASSESSED axis is not a verdict and must never render as one. That filter
 *  lives at the SEAL (sealableRubricDimensions) and cannot be repeated here: what
 *  marks an axis unassessed is its placeholder EVIDENCE, and evidence is
 *  deliberately never sealed — so a stored `rating: 3` is indistinguishable from an
 *  observed middling score, and dropping every 3 would delete real verdicts. The
 *  one-sided filter is safe because the seal is also the only writer: a record from
 *  before this existed carries no `dimensions` at all and reads as no facts.
 *
 *  Everything that CAN be re-checked from the payload alone is re-checked, because
 *  records outlive the code that sealed them. Null when nothing survives: a
 *  scorecard that assessed nothing has no facts, not an empty verdict. */
export function aiScorecardFacts(payloadJson: string): CandidateDecisionFacts | null {
  const o = sealedInputs(payloadJson);
  if (!o || !Array.isArray(o.dimensions)) return null;
  const dimensions: { competency: string; rating: number; ratingMax: number }[] = [];
  for (const raw of o.dimensions) {
    if (dimensions.length >= MAX_CANDIDATE_RUBRIC_DIMENSIONS) break;
    if (!raw || typeof raw !== "object") continue;
    const d = raw as Record<string, unknown>;
    const competency = typeof d.competency === "string" ? d.competency.trim() : "";
    if (!competency || competency.length > MAX_COMPETENCY_LEN) continue;
    const rating = Number(d.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > CANDIDATE_RUBRIC_RATING_MAX) continue;
    dimensions.push({ competency, rating, ratingMax: CANDIDATE_RUBRIC_RATING_MAX });
  }
  return dimensions.length > 0 ? { type: "rubric", dimensions } : null;
}

/** THE COVERAGE REGISTRY: sealed kind → the one extractor allowed to build its
 *  facts. A kind absent from this map crosses with `facts: null` — visible, but
 *  with no decisive element behind it, which is the state every kind but
 *  `auto_rejected` was in when this map was introduced.
 *
 *  This is a map rather than a switch precisely so the coverage is COUNTABLE:
 *  `factsCoverage()` reads it, and the test asserts the ratio, so "one more kind
 *  explains itself" is a number that moves rather than a claim in a commit body. */
const FACT_EXTRACTORS: ReadonlyMap<string, (payloadJson: string) => CandidateDecisionFacts | null> = new Map([
  ["auto_rejected", autoRejectFacts],
  ["ai_scorecard", aiScorecardFacts],
]);

/** The sealed kinds that are an AI VERDICT ABOUT A PERSON — the subset Art. 86's
 *  explanation duty bites hardest on, and the denominator worth moving. The other
 *  visible kinds are scheduling events and human calls, which a reason code
 *  already explains on its own. */
export const AI_VERDICT_DECISION_KINDS: ReadonlySet<string> = new Set([
  "auto_rejected",
  "auto_advanced",
  "ai_scorecard",
  "group_eval_lead",
  "group_eval_advisory",
]);

/** How much of the candidate-visible surface can actually show a decisive fact.
 *  Two denominators because they answer different questions: `visible` is the whole
 *  Art. 86 surface, `aiVerdict` is the part where a machine judged the person. */
export function factsCoverage(): {
  withFacts: number;
  visible: number;
  aiVerdictWithFacts: number;
  aiVerdict: number;
} {
  const kinds = [...FACT_EXTRACTORS.keys()].filter((k) => CANDIDATE_VISIBLE_DECISION_KINDS.has(k));
  return {
    withFacts: kinds.length,
    visible: CANDIDATE_VISIBLE_DECISION_KINDS.size,
    aiVerdictWithFacts: kinds.filter((k) => AI_VERDICT_DECISION_KINDS.has(k)).length,
    aiVerdict: AI_VERDICT_DECISION_KINDS.size,
  };
}

/** Redact one sealed record for its own subject, or null when the kind is not
 *  candidate-visible. Only the closed CandidateDecisionView fields survive —
 *  rationale (names the approver), payloadJson, hashes, actor string, policy
 *  version and seq all stay server-side. */
export function redactDecisionForCandidate(record: SealedDecisionLike): CandidateDecisionView | null {
  if (!CANDIDATE_VISIBLE_DECISION_KINDS.has(record.kind)) return null;
  const extract = FACT_EXTRACTORS.get(record.kind);
  return {
    kind: record.kind,
    createdAt: record.createdAt,
    attribution: sealedActorAttribution(record.actor, record.kind),
    reasonCode: record.reasonCode,
    facts: extract ? extract(record.payloadJson) : null,
  };
}

/** The candidate's whole redacted decision history, consent-gated: an entry
 *  whose consent has EXPIRED or that is already ANONYMIZED gets NOTHING — the
 *  same read-time PII rule every other boundary applies (consent.ts). The
 *  caller must already have scoped `records` to THIS entry's candidateRef
 *  (listDecisionRecords({ candidateRef })); this function never re-checks refs
 *  because it deliberately has no idea what an entry id is. */
export function candidateDecisionHistory(
  consent: ConsentSnapshot,
  records: readonly SealedDecisionLike[],
  nowMs: number = Date.now()
): CandidateDecisionView[] {
  if (consentWithholdsPii(consent, nowMs)) return [];
  const out: CandidateDecisionView[] = [];
  for (const r of records) {
    const view = redactDecisionForCandidate(r);
    if (view) out.push(view);
  }
  return out;
}
