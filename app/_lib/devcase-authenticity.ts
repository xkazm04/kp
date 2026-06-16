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
};

export type Authenticity = {
  score: number; // 0..100 — higher = more evidence of genuine incremental authorship
  band: AuthenticityBand;
  reasons: string[]; // the penalties that fired, candidate-neutral and interviewer-facing
};

// At/below this an authenticity score is "suspect" — the auto-promote gate holds
// it for human verification rather than advancing on transfer score alone.
export const SUSPECT_THRESHOLD = 40;
const MIXED_THRESHOLD = 70;

export function scoreAuthenticity(input: AuthenticityInput): Authenticity {
  const reasons: string[] = [];
  let score = 100;

  // A single bulk commit is the strongest paste-from-LLM tell. commitCount === 0
  // means we couldn't read a git history at all (not necessarily a paste), so we
  // don't apply the single-commit penalty — but the missing cadence still costs.
  if (input.commitCount === 1) {
    score -= 40;
    reasons.push("Single bulk commit — no incremental history.");
  } else if (input.commitCount >= 2 && input.commitCount <= 3) {
    score -= 12;
    reasons.push("Very few commits — thin development trail.");
  } else if (input.commitCount === 0) {
    score -= 15;
    reasons.push("No readable commit history.");
  }

  // The forced DECISIONS.md authorship artifact (case-design contract) is absent.
  if (!input.decisionsLogPresent) {
    score -= 25;
    reasons.push("Mandated DECISIONS log is missing.");
  }

  // All work landed in one short burst rather than an incremental rhythm.
  if (input.bursty === true) {
    score -= 15;
    reasons.push("Work landed in a single burst, not incrementally.");
  }

  if (input.iterationPattern === "big-bang") {
    score -= 15;
    reasons.push("Big-bang iteration pattern — no visible build-up.");
  } else if (input.iterationPattern === "unclear") {
    score -= 5;
    reasons.push("Iteration pattern couldn't be read from the trace.");
  }

  // Little evidence they read the existing code before generating changes.
  if (input.readBeforeWrite != null && input.readBeforeWrite < 0.3) {
    score -= 15;
    reasons.push("Little evidence of reading before writing.");
  }

  score = Math.max(0, Math.min(100, score));
  const band: AuthenticityBand = score < SUSPECT_THRESHOLD ? "suspect" : score < MIXED_THRESHOLD ? "mixed" : "authentic";
  return { score, band, reasons };
}
