// Process-authenticity score for dev-case submissions (idea-ce28da40). Every
// recruiter now fears take-homes are ghost-written by an LLM. kp uniquely already
// captures the git PROCESS trace (commit cadence, the bursty flag, whether the
// mandated DECISIONS log was kept) and the reflection's read-before-write / how
// they iterated — but only ever CHECKED that the decisions log EXISTS. This
// promotes those scattered signals into one first-class authenticity score: a
// single bulk commit + no decisions log + no incremental cadence reads as
// likely paste-from-LLM. Surfaced beside transferScore and used to GATE
// auto-promotion (a suspect submission is held for the live ownership-verifying
// interview the followups were minted for, never auto-advanced on score alone).
//
// Pure + import-free so the contract is unit-testable; runEvaluateSubmission
// feeds it the processTrace + reflection it already assembles.

export type AuthenticityBand = "authentic" | "mixed" | "suspect";

export type AuthenticityInput = {
  commitCount: number;
  // From processTrace.cadence — all work in one short burst (no incremental rhythm).
  bursty: boolean | null;
  spanHours: number | null;
  decisionsLogPresent: boolean;
  // From the reflection (may be absent on older bundles / deterministic fallback).
  readBeforeWrite?: number | null; // 0..1
  iterationPattern?: string | null; // exploratory|linear|big-bang|test-driven|unclear
  // True when the work was done in the in-product Live Work Surface — every edit
  // was WATCHED, so there is no git history BY DESIGN. The strongest authorship
  // proof the product has must not be penalized for lacking commits it can't have.
  observed?: boolean;
  // Observed sessions only: a single large bulk paste (>= PASTE_BULK_CHARS) landed in
  // the watched editor with no incremental build-up — the in-product paste-from-LLM
  // tell. Computed by the caller from the observed event stream.
  observedBulkPaste?: boolean;
  // Observed sessions only (LLM-era controls #1): the tamper-evidence verdict on the
  // event log itself — true when the server-side hash chain failed to recompute or
  // client timestamps contradicted their server receive window (backdating). A trace
  // that was manipulated after the fact proves nothing, so this is decisive.
  integrityCompromised?: boolean;
};

// ── The reasons are FINDINGS, not copy ───────────────────────────────────────
//
// Each penalty below used to push an English sentence onto `reasons`, and the reviewer
// panel joined them into the tooltip of an otherwise-translated badge — so a Czech,
// German or French interviewer read "Single bulk commit — no incremental history." in
// English, inside a frame that was localized around it. That is the same
// `{ kind, params }` contract this repo already uses for a CalibrationRationale and a
// GithubFinding (docs/architecture/localization.md → "analysis output that is data, not
// copy"): the engine decides WHICH penalties fired and with what numbers, and the
// surface writes the sentence in the reader's language.
//
// Literal array + derived union + the runtime guard the panel needs for a persisted
// bundle, the shape this repo uses for every closed vocabulary.
export const AUTHENTICITY_REASON_KINDS = [
  "singleBulkCommit",
  "fewCommits",
  "noCommitHistory",
  "bulkPaste",
  "integrityFailed",
  "noDecisionsLog",
  "bursty",
  "bigBang",
  "unreadableIteration",
  "lowReadBeforeWrite",
] as const;
export type AuthenticityReasonKind = (typeof AUTHENTICITY_REASON_KINDS)[number];
export type AuthenticityReason = { kind: AuthenticityReasonKind; params?: Record<string, number> };

/** Is this a reason kind THIS build knows? Bundles are persisted, so a panel can be
 *  handed a kind minted by an older or newer evaluation run; the caller falls back to
 *  showing nothing for it rather than rendering a raw key at an interviewer. */
export function isAuthenticityReasonKind(v: unknown): v is AuthenticityReasonKind {
  return AUTHENTICITY_REASON_KINDS.includes(v as AuthenticityReasonKind);
}

export type Authenticity = {
  score: number; // 0..100 — higher = more evidence of genuine incremental authorship
  band: AuthenticityBand;
  reasons: AuthenticityReason[]; // the penalties that fired, candidate-neutral and interviewer-facing
};

// BELOW this an authenticity score is "suspect" — the auto-promote gate holds it for
// human verification rather than advancing on transfer score alone. The bands are
// half-open ([0,40) suspect, [40,70) mixed, [70,100] authentic), so a score of exactly
// 40 is MIXED and still auto-advances; the wording used to read "at/below", which
// contradicted the comparison below at the one score where the two disagree.
export const SUSPECT_THRESHOLD = 40;
const MIXED_THRESHOLD = 70;

// A single observed paste of at least this many characters with no incremental
// build-up reads as paste-from-LLM. Large enough not to fire on a small snippet or a
// moved import line; small enough to catch a pasted function/solution. The penalty
// (below) is decisive on its own so a clean-looking bulk paste lands in "suspect"
// and is held for the ownership-verifying interview rather than auto-advancing.
export const PASTE_BULK_CHARS = 600;

export function scoreAuthenticity(input: AuthenticityInput): Authenticity {
  const reasons: AuthenticityReason[] = [];
  let score = 100;

  // A single bulk commit is the strongest paste-from-LLM tell. commitCount === 0
  // means we couldn't read a git history at all (not necessarily a paste), so we
  // don't apply the single-commit penalty — but the missing cadence still costs.
  // EXCEPT for an OBSERVED live-session submission: it has no git history by design
  // (the work was watched edit-by-edit), so the missing-commit penalty is waived —
  // penalizing watched work for lacking commits would defeat the whole point of the
  // Live Work Surface (it scored the cleanest submissions as half-suspect).
  if (input.commitCount === 1 && !input.observed) {
    score -= 40;
    reasons.push({ kind: "singleBulkCommit" });
  } else if (input.commitCount >= 2 && input.commitCount <= 3) {
    score -= 12;
    reasons.push({ kind: "fewCommits", params: { n: input.commitCount } });
  } else if (input.commitCount === 0 && !input.observed) {
    score -= 15;
    reasons.push({ kind: "noCommitHistory" });
  }

  // Observed sessions waive the commit-history penalties (no git by design), which
  // previously let a candidate paste a whole LLM solution into the watched editor and
  // still score "authentic". A single large bulk paste with no incremental build-up is
  // the in-product paste-from-LLM tell — penalize it decisively so it lands "suspect"
  // and is HELD for the ownership-verifying interview rather than auto-advancing.
  if (input.observed && input.observedBulkPaste) {
    score -= 65;
    reasons.push({ kind: "bulkPaste", params: { chars: PASTE_BULK_CHARS } });
  }

  // A broken hash chain / backdated timestamps mean the observed trace was
  // manipulated after the fact — every process signal above it is untrustworthy,
  // so the penalty is decisive on its own (the submission is held for the live
  // ownership-verifying interview, never auto-advanced).
  if (input.observed && input.integrityCompromised) {
    score -= 70;
    reasons.push({ kind: "integrityFailed" });
  }

  // The forced DECISIONS.md authorship artifact (case-design contract) is absent.
  if (!input.decisionsLogPresent) {
    score -= 25;
    reasons.push({ kind: "noDecisionsLog" });
  }

  // All work landed in one short burst rather than an incremental rhythm.
  if (input.bursty === true) {
    score -= 15;
    reasons.push({ kind: "bursty" });
  }

  if (input.iterationPattern === "big-bang") {
    score -= 15;
    reasons.push({ kind: "bigBang" });
  } else if (input.iterationPattern === "unclear") {
    // ZERO-COST, deliberately. This branch used to subtract 5 — a penalty for the
    // ABSENCE of evidence, on a signal class this repo's own red-team round proved
    // fabricable. It charged the candidate whose tooling simply left no legible trace
    // (an unusual editor, a squashed history, work done outside the watched surface)
    // while the gamer who manufactures a tidy virtuous process pays nothing. With
    // SUSPECT_THRESHOLD gating auto-promotion, those points were real. The note stays
    // in `reasons` so the reviewer still sees that the axis was unreadable — an
    // unreadable signal is something for a human to ask about, not something to score.
    reasons.push({ kind: "unreadableIteration" });
  }

  // Little evidence they read the existing code before generating changes.
  if (input.readBeforeWrite != null && input.readBeforeWrite < 0.3) {
    score -= 15;
    reasons.push({ kind: "lowReadBeforeWrite" });
  }

  score = Math.max(0, Math.min(100, score));
  const band: AuthenticityBand = score < SUSPECT_THRESHOLD ? "suspect" : score < MIXED_THRESHOLD ? "mixed" : "authentic";
  return { score, band, reasons };
}
