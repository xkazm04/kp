// The dev-case promote verdict: advance or hold, with CODED reasons.
//
// One pure rule with three callers, so none of them re-derives a threshold:
//   - promoteSubmission (devcase-run.ts) writes the verdict onto the screening card and
//     the automation trail, inside its IMMEDIATE transaction (computed ABOVE it);
//   - GET /api/devcase/postings attaches it to every evaluated submission as
//     `promotePreview`, at the server's calibrated floor (activePromoteFloor());
//   - the Dev studio's EvalPanel renders that preview BEFORE the Promote click, and
//     folds the promote response AFTER it (foldPromoteResponse).
//
// The shape is the registry's "a hold that blocks auto-advance"
// (recruiting/combining-signals-into-a-hire-decision): a BLOCKER sits above the score
// ladder - suspect process authenticity or thin evaluation evidence forces hold however
// high the score - and the hold carries its reasons visibly. A hold is a human decision
// gate: nothing here, and nothing that renders this, can turn a hold into an advance.
//
// Reasons are CODES (decision-audit-and-traceability: reason-codes-over-prose), resolved
// in the reader's language by the UI. The automation trail keeps its locale-invariant
// English sentence, built from the same verdict by promoteAuditReasons.
//
// An ABSENT score is its own tier (`not_scored`), never a 0: the old path read
// `sub.transferScore ?? Number(transfer.transferScore ?? 0)` and wrote "transfer score 0"
// for a submission nobody had scored.
//
// Import-free on purpose: the client panel and the server share it.

/** Closed vocabulary; the derived union below and the catalog block
 *  `devcase.evalPanel.promoteVerdict.reasons.*` are pinned to it by the tests. */
export const PROMOTE_REASON_CODES = [
  "authenticity_suspect",
  "low_confidence",
  "not_scored",
  "score_below_floor",
  "score_clears_floor",
] as const;
export type PromoteReasonCode = (typeof PROMOTE_REASON_CODES)[number];

export const PROMOTE_RECOMMENDATIONS = ["advance", "hold"] as const;
export type PromoteRecommendation = (typeof PROMOTE_RECOMMENDATIONS)[number];

export type PromoteReason =
  | { code: "authenticity_suspect"; params: { score?: number } }
  | { code: "low_confidence"; params: { confidence: number } }
  | { code: "not_scored" }
  | { code: "score_below_floor"; params: { score: number; floor: number } }
  | { code: "score_clears_floor"; params: { score: number; floor: number } };

export type PromoteVerdict = {
  recommendation: PromoteRecommendation;
  /** Blockers first, then the score reason - the order a reviewer should read them. */
  reasons: PromoteReason[];
};

export type PromoteVerdictInput = {
  /** The work-sample transfer score (0..100), or null when nothing scored it. */
  transferScore: number | null;
  /** The calibrated floor - activePromoteFloor(), never a second hardcoded bar. */
  floor: number;
  authenticityBand?: string | null;
  authenticityScore?: number | null;
  /** The evaluation's PROPAGATED evidence-confidence (0..1); absent = no signal, no penalty. */
  confidence?: number | null;
};

// The evidence-confidence floor for auto-advance advice - mirrors the Python
// confidence scale's LOW_CONFIDENCE (pipeline/jobfit/devcase/models.py): at or
// below this the evaluation rests on thin/deterministic-fallback evidence.
export const LOW_EVAL_CONFIDENCE = 0.4;

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function promoteVerdict(input: PromoteVerdictInput): PromoteVerdict {
  const reasons: PromoteReason[] = [];
  const suspect = input.authenticityBand === "suspect";
  if (suspect) {
    reasons.push({
      code: "authenticity_suspect",
      params: isNum(input.authenticityScore) ? { score: input.authenticityScore } : {},
    });
  }
  const lowConfidence = isNum(input.confidence) && input.confidence <= LOW_EVAL_CONFIDENCE;
  if (lowConfidence) reasons.push({ code: "low_confidence", params: { confidence: input.confidence as number } });

  const score = isNum(input.transferScore) ? input.transferScore : null;
  let clears = false;
  if (score == null) {
    reasons.push({ code: "not_scored" });
  } else if (score >= input.floor) {
    clears = true;
    reasons.push({ code: "score_clears_floor", params: { score, floor: input.floor } });
  } else {
    reasons.push({ code: "score_below_floor", params: { score, floor: input.floor } });
  }
  return { recommendation: clears && !suspect && !lowConfidence ? "advance" : "hold", reasons };
}

/** Read the verdict's inputs off a stored evaluation bundle. The persisted column score
 *  wins; the bundle's own transfer score is the fallback; neither present = null. */
export function promoteVerdictInputOf(
  evaluationBundle: unknown,
  columnTransferScore: number | null | undefined,
  floor: number
): PromoteVerdictInput {
  const bundle = (evaluationBundle && typeof evaluationBundle === "object" ? evaluationBundle : {}) as {
    evaluation?: { confidence?: unknown } | null;
    transfer?: { transferScore?: unknown } | null;
    authenticity?: { band?: unknown; score?: unknown } | null;
  };
  const fromBundle = bundle.transfer?.transferScore;
  const transferScore = isNum(columnTransferScore) ? columnTransferScore : isNum(fromBundle) ? fromBundle : null;
  const band = bundle.authenticity?.band;
  const authScore = bundle.authenticity?.score;
  const confidence = bundle.evaluation?.confidence;
  return {
    transferScore,
    floor,
    authenticityBand: typeof band === "string" ? band : null,
    authenticityScore: isNum(authScore) ? authScore : null,
    confidence: isNum(confidence) ? confidence : null,
  };
}

/** The automation trail's English reason list - locale-invariant on purpose (an audit
 *  row is read by whoever investigates it, in whatever language the log is kept). The
 *  score reason leads, the sentence it has always been. */
export function promoteAuditReasons(verdict: PromoteVerdict, floor: number): string[] {
  const out: string[] = [];
  for (const r of verdict.reasons) {
    if (r.code === "score_clears_floor" || r.code === "score_below_floor") {
      out.unshift(`transfer score ${r.params.score} vs calibrated floor ${r.params.floor}`);
    } else if (r.code === "not_scored") {
      out.unshift(`no transfer score recorded (calibrated floor ${floor})`);
    } else if (r.code === "authenticity_suspect") {
      out.push(
        r.params.score != null
          ? `process authenticity is suspect (${r.params.score}/100)`
          : "process authenticity is suspect"
      );
    } else {
      out.push(`evaluation evidence-confidence is low (${r.params.confidence})`);
    }
  }
  return out;
}

const REASON_CODE_SET: ReadonlySet<string> = new Set(PROMOTE_REASON_CODES);
export const isPromoteReasonCode = (v: unknown): v is PromoteReasonCode =>
  typeof v === "string" && REASON_CODE_SET.has(v);

export type PromoteFold =
  | { state: "promoted"; recommendation: PromoteRecommendation | null }
  | { state: "error"; code: string | null };

/** Fold the promote route's answer into what the panel shows. A non-OK answer is an
 *  error carrying the server's machine CODE (resolved by useErrorMessage), never its
 *  English `error`; an OK answer carries the verdict the promotion actually landed with. */
export function foldPromoteResponse(status: number, body: unknown): PromoteFold {
  const b = (body && typeof body === "object" ? body : {}) as { code?: unknown; recommendation?: unknown };
  if (status < 200 || status >= 300) {
    return { state: "error", code: typeof b.code === "string" && b.code ? b.code : null };
  }
  const rec = b.recommendation;
  return {
    state: "promoted",
    recommendation: rec === "advance" || rec === "hold" ? rec : null,
  };
}

/** Catalog key (under `devcase.evalPanel.promoteVerdict.reasons`) and ICU values for one
 *  reason. Shared by the panel and the catalog test so the arguments a message expects
 *  are exactly the arguments the panel passes. An authenticity reason with no known score
 *  selects the score-less branch rather than inventing a number. */
export function promoteReasonMessage(reason: PromoteReason): {
  key: PromoteReasonCode;
  values: Record<string, string | number>;
} {
  switch (reason.code) {
    case "authenticity_suspect":
      return {
        key: reason.code,
        values: reason.params.score != null ? { known: "yes", score: reason.params.score } : { known: "no", score: 0 },
      };
    case "low_confidence":
      return { key: reason.code, values: { confidence: reason.params.confidence } };
    case "not_scored":
      return { key: reason.code, values: {} };
    default:
      return { key: reason.code, values: { score: reason.params.score, floor: reason.params.floor } };
  }
}
