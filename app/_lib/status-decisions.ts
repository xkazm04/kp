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
  /** For auto_rejected only: the decisive threshold facts the decision actually
   *  saw (Art. 86's "main elements of the decision"). Null for everything else. */
  facts: { score: number; threshold: number } | null;
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

/** The decisive score-vs-threshold pair out of an auto_rejected record's sealed
 *  inputs — the two numbers the screen wave actually compared (screen-wave.ts
 *  seals them as reasonParams). Anything non-numeric/absent → null (never
 *  fabricate a fact), and NO other input key ever crosses (approvedBy names the
 *  operator; group-eval inputs name other candidates). */
export function autoRejectFacts(payloadJson: string): CandidateDecisionView["facts"] {
  let inputs: unknown;
  try {
    inputs = (JSON.parse(payloadJson) as { inputs?: unknown }).inputs;
  } catch {
    return null;
  }
  if (!inputs || typeof inputs !== "object") return null;
  const o = inputs as Record<string, unknown>;
  const score = Number(o.score);
  const threshold = Number(o.threshold);
  if (!Number.isFinite(score) || !Number.isFinite(threshold)) return null;
  return { score, threshold };
}

/** Redact one sealed record for its own subject, or null when the kind is not
 *  candidate-visible. Only the closed CandidateDecisionView fields survive —
 *  rationale (names the approver), payloadJson, hashes, actor string, policy
 *  version and seq all stay server-side. */
export function redactDecisionForCandidate(record: SealedDecisionLike): CandidateDecisionView | null {
  if (!CANDIDATE_VISIBLE_DECISION_KINDS.has(record.kind)) return null;
  return {
    kind: record.kind,
    createdAt: record.createdAt,
    attribution: sealedActorAttribution(record.actor, record.kind),
    reasonCode: record.reasonCode,
    facts: record.kind === "auto_rejected" ? autoRejectFacts(record.payloadJson) : null,
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
